/* Marina Chat: one live room for everyone logged in. New and deleted messages arrive
   through Supabase Realtime (with a quiet check every 20 seconds as a backup). Each open
   chat window checks in every 30 seconds so others can see who's here; the Member Portal
   shows the same count. Shared logins (cruisers, staff) give a first name to show. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, me = null, isAdmin = false, myName = '', muted = [];
  var msgs = [], byId = {}, lastId = 0, oldestId = null, loadingOld = false;
  var PAGE = 150, NAME_KEY = 'chatName', READ_KEY = 'chatLastRead';
  var clientId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function dayLabel(d) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((t - x) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function timeLabel(d) { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function showErr(m) { $('chErr').textContent = m || ''; $('chErr').hidden = !m; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    try { clientId = sessionStorage.getItem('chatClient'); } catch (e) {}
    if (!clientId) { clientId = uuid(); try { sessionStorage.setItem('chatClient', clientId); } catch (e) {} }
    MemberAuth.getClient().then(function (c) {
      sb = c;
      return sb.auth.getSession();
    }).then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) {
        $('chStatus').innerHTML = '<p style="margin:0">Marina Chat is for slip owners, cruisers and staff. Please log in to join.</p>' +
          '<div class="portal-actions"><button type="button" class="btn btn-gold" id="chLogin">Log In</button></div>';
        $('chLogin').addEventListener('click', function () { MemberAuth.openLogin(); });
        return;
      }
      me = s.user;
      return sb.from('members').select('slip, owner_name, member_class, is_admin, active').eq('user_id', me.id).eq('active', true).limit(1).then(function (m) {
        var row = m.data && m.data[0];
        if (!row) { $('chStatus').innerHTML = '<p style="margin:0">This login doesn\'t have access to the chat. Please contact the marina office.</p>'; return; }
        me.row = row;
        return sb.rpc('is_admin').then(function (a) {
          isAdmin = !!a.data || !!row.is_admin;
          $('chStatus').hidden = true;
          var shared = !isAdmin && row.member_class && row.member_class !== 'certificated';
          if (shared) {
            $('chRename').hidden = false;
            $('chRename').addEventListener('click', askName);
            $('chNameForm').addEventListener('submit', function (e) {
              e.preventDefault();
              var v = $('chNameInput').value.trim().replace(/\s+/g, ' ');
              if (!v) return;
              store(NAME_KEY, v);
              myName = v;
              $('chNameForm').hidden = true;
              start();
            });
            myName = load(NAME_KEY) || '';
            if (!myName) return askName();
          }
          start();
        });
      });
    }).catch(function () {
      $('chStatus').innerHTML = '<p style="margin:0">Something went wrong loading the chat. Please refresh the page.</p>';
    });
  });

  function kindLabel(c) { return { ltc: 'Long-term cruiser', stc: 'Transient', employee: 'Staff' }[c] || c; }
  function shownName() {
    var r = me.row, shared = !isAdmin && r.member_class && r.member_class !== 'certificated';
    return shared ? myName + ' (' + kindLabel(r.member_class) + ')' : (r.owner_name || 'Slip ' + r.slip) + ' (' + r.slip + ')';
  }
  function askName() {
    $('chNameInput').value = myName;
    $('chNameForm').hidden = false;
    $('chNameInput').focus();
  }

  var started = false;
  function start() {
    $('chMe').textContent = shownName();
    if (started) { beat(); return; }
    started = true;
    $('chApp').hidden = false;
    if (isAdmin) { $('chAdminNote').hidden = false; loadMuted(); }
    wire();
    loadLatest().then(function () { subscribe(); });
    beat(); setInterval(function () { if (document.visibilityState === 'visible') beat(); }, 30000);
    loadOnline(); setInterval(loadOnline, 30000);
    setInterval(poll, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { beat(); loadOnline(); poll(); markRead(); }
    });
    window.addEventListener('pagehide', function () { leave(); });
    $('chText').focus();
  }

  function wire() {
    $('chForm').addEventListener('submit', function (e) { e.preventDefault(); send(); });
    $('chText').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    $('chText').addEventListener('input', grow);
    $('chMore').addEventListener('click', loadOlder);
    $('chJump').addEventListener('click', function () { toBottom(); });
    // Full page: move the chat into its own window and go back to what you were doing.
    $('chPop').addEventListener('click', function () {
      var w = MemberAuth.openChat && MemberAuth.openChat();
      if (!w) { showErr('Your browser blocked the pop-out window. Allow pop-ups for this site, or keep chatting here.'); return; }
      leave();
      setTimeout(function () {
        if (document.referrer && document.referrer.indexOf(location.origin) === 0 && !/chat\.html/.test(document.referrer)) location.href = document.referrer;
        else location.href = 'member-portal.html';
      }, 300);
    });
    window.addEventListener('focus', clearTitle);
    $('chLog').addEventListener('scroll', function () { if (nearBottom()) { $('chJump').hidden = true; markRead(); } });
    $('chList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = +b.getAttribute('data-id'), m = byId[id];
      if (!m) return;
      if (b.getAttribute('data-act') === 'del') {
        if (!confirm('Delete this message for everyone?')) return;
        sb.rpc('chat_delete', { p_id: id }).then(function (r) {
          if (r.error) return showErr(r.error.message);
          m.deleted_at = new Date().toISOString(); render();
        });
      } else if (b.getAttribute('data-act') === 'mute') {
        var on = muted.indexOf(m.slip) < 0;
        if (!confirm((on ? 'Mute' : 'Unmute') + ' the login ' + m.slip + ' (' + m.name + ')?' + (on ? '\n\nIt can still read the chat but can\'t post until you unmute it.' + (m.member_class && m.member_class !== 'certificated' ? ' This is a shared login, so everyone using it is muted.' : '') : ''))) return;
        sb.rpc('chat_mute', { p_slip: m.slip, p_muted: on }).then(function (r) {
          if (r.error) return showErr(r.error.message);
          loadMuted();
        });
      }
    });
  }
  function grow() { var t = $('chText'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }

  function cols() { return 'id, user_id, slip, member_class, name, body, created_at, deleted_at'; }
  function add(rows) {
    var added = 0;
    (rows || []).forEach(function (m) {
      if (byId[m.id]) { byId[m.id].deleted_at = m.deleted_at; byId[m.id].body = m.body; return; }
      byId[m.id] = m; msgs.push(m); added++;
      if (m.id > lastId) lastId = m.id;
      if (oldestId === null || m.id < oldestId) oldestId = m.id;
    });
    msgs.sort(function (a, b) { return a.id - b.id; });
    return added;
  }
  function loadLatest() {
    return sb.from('chat_messages').select(cols()).is('deleted_at', null).order('id', { ascending: false }).limit(PAGE).then(function (r) {
      if (r.error) { showErr('The chat couldn\'t load. Please refresh.'); return; }
      add(r.data);
      $('chMoreWrap').hidden = (r.data || []).length < PAGE;
      render(); toBottom(); markRead();
    });
  }
  function loadOlder() {
    if (loadingOld || oldestId === null) return;
    loadingOld = true;
    var log = $('chLog'), before = log.scrollHeight;
    sb.from('chat_messages').select(cols()).is('deleted_at', null).lt('id', oldestId).order('id', { ascending: false }).limit(PAGE).then(function (r) {
      loadingOld = false;
      add(r.data);
      $('chMoreWrap').hidden = (r.data || []).length < PAGE;
      render();
      log.scrollTop = log.scrollHeight - before;
    });
  }
  // Backup for live updates: anything newer than what we have.
  function poll() {
    if (!sb || document.visibilityState !== 'visible') return;
    sb.from('chat_messages').select(cols()).gt('id', lastId).order('id').limit(200).then(function (r) {
      if (r.error) return;
      var fresh = (r.data || []).filter(function (m) { return !byId[m.id]; });
      if (add(fresh)) arrived(fresh.filter(function (m) { return m.user_id !== me.id; }).length);
    });
  }

  function subscribe() {
    sb.channel('marina-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, function (p) {
        if (!add([p.new])) return;
        arrived(p.new.user_id !== me.id ? 1 : 0);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, function (p) {
        var m = byId[p.new.id];
        if (m) { m.deleted_at = p.new.deleted_at; m.body = p.new.body; render(); }
      })
      .subscribe(function (status) {
        var live = status === 'SUBSCRIBED';
        $('chConn').textContent = live ? 'Live' : 'Reconnecting…';
        document.querySelector('.chat-live').classList.toggle('on', live);
        if (live) poll();
      });
  }
  // While the chat window is in the background, its title counts new messages: "(3) Marina Chat".
  var baseTitle = document.title, unseen = 0;
  function clearTitle() { unseen = 0; document.title = baseTitle; }
  function arrived(n) {
    if (n && (document.visibilityState !== 'visible' || !document.hasFocus())) {
      unseen += n || 1;
      document.title = '(' + unseen + ') ' + baseTitle;
    }
    var stick = nearBottom();
    render();
    if (stick) { toBottom(); markRead(); }
    else $('chJump').hidden = false;
  }

  function nearBottom() { var l = $('chLog'); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; }
  function toBottom() { var l = $('chLog'); l.scrollTop = l.scrollHeight; $('chJump').hidden = true; }
  function markRead() { if (document.visibilityState === 'visible') store(READ_KEY, new Date().toISOString()); }

  function render() {
    var html = '', lastDay = '', lastWho = null, lastAt = 0;
    msgs.forEach(function (m) {
      if (m.deleted_at) return;
      var day = dayLabel(m.created_at);
      if (day !== lastDay) { html += '<div class="chat-day"><span>' + esc(day) + '</span></div>'; lastDay = day; lastWho = null; }
      var at = new Date(m.created_at).getTime();
      var mine = m.user_id === me.id && (m.name === shownName() || !(me.row.member_class && me.row.member_class !== 'certificated' && !isAdmin));
      var cont = lastWho === m.name && at - lastAt < 5 * 60000;
      var tools = '';
      if (mine || isAdmin) tools += '<button type="button" class="chat-tool" data-act="del" data-id="' + m.id + '" title="Delete">Delete</button>';
      if (isAdmin && !mine && m.slip) tools += '<button type="button" class="chat-tool" data-act="mute" data-id="' + m.id + '">' + (muted.indexOf(m.slip) < 0 ? 'Mute login' : 'Unmute') + '</button>';
      html += '<div class="chat-msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + '">' +
        (cont ? '' : '<div class="chat-who"><strong>' + esc(mine ? 'You' : m.name) + '</strong> <span>' + esc(timeLabel(m.created_at)) + '</span></div>') +
        '<div class="chat-bubble" title="' + esc(timeLabel(m.created_at)) + '">' + linkify(m.body) + '</div>' +
        (tools ? '<div class="chat-tools">' + tools + '</div>' : '') + '</div>';
      lastWho = m.name; lastAt = at;
    });
    $('chList').innerHTML = html || '<p class="chat-empty">No messages yet. Say hello!</p>';
  }

  function send() {
    var t = $('chText'), body = t.value.trim();
    if (!body) return;
    showErr('');
    $('chSend').disabled = true;
    sb.rpc('chat_send', { p_body: body, p_name: myName }).then(function (r) {
      $('chSend').disabled = false;
      if (r.error) return showErr(r.error.message);
      t.value = ''; grow(); t.focus();
      poll();
      setTimeout(toBottom, 50);
    });
  }

  function beat() { if (sb) sb.rpc('chat_heartbeat', { p_client: clientId, p_name: myName, p_leaving: false }).then(loadOnline); }
  function leave() {
    // Best effort when the page closes; otherwise the person drops off the list within about a minute.
    try {
      sb.auth.getSession().then(function (r) {
        var tok = r.data.session && r.data.session.access_token;
        if (!tok) return;
        fetch(MemberAuth.config.url + '/rest/v1/rpc/chat_heartbeat', {
          method: 'POST', keepalive: true,
          headers: { apikey: MemberAuth.config.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_client: clientId, p_name: myName, p_leaving: true })
        });
      });
    } catch (e) {}
  }
  function loadOnline() {
    if (!sb) return;
    sb.rpc('chat_online').then(function (r) {
      var d = (r && r.data) || { count: 0, names: [] }, names = (d.names || []).slice().sort();
      $('chCount').textContent = d.count || 0;
      $('chOnline').innerHTML = names.length ? names.map(function (n) {
        return '<li><i></i>' + esc(n === shownName() ? n + ' (you)' : n) + '</li>';
      }).join('') : '<li class="note">No one else right now.</li>';
    });
  }
  function loadMuted() {
    sb.rpc('chat_muted_slips').then(function (r) {
      muted = (r && r.data) || [];
      $('chMuted').textContent = muted.length ? muted.join(', ') : 'none';
      render();
    });
  }
})();
