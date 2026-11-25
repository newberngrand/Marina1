/* Request Help: any logged-in member (slip owners, cruisers, employees) sends the office a request.
   Fills in the name and email on file (slip owners) and the phone number from the last request.
   The office is emailed about each new request; admins handle them on the Admin page. */
(function () {
  var D = window.MemberData, sb = null, uid = null, shared = false;
  function $(id) { return document.getElementById(id); }
  var STATUS = { new: 'Sent', open: 'Being handled', done: 'Done' };

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) {
        $('helpStatus').innerHTML = '<p style="margin:0">Please log in with your slip (or your cruiser login) to request help. ' +
          'Or call the marina office at <a href="tel:+12526380318">(252) 638-0318</a>.</p>' +
          '<div class="portal-actions"><button type="button" class="btn btn-gold" id="hpLogin">Marina Login</button></div>';
        $('hpLogin').addEventListener('click', function () { MemberAuth.openLogin('login'); });
        return;
      }
      uid = r.data.session.user.id;
      return sb.rpc('help_defaults').then(function (d) {
        var x = d.data || {};
        $('helpStatus').hidden = true;
        $('helpBody').hidden = false;
        $('hfName').value = x.name || x.last_name || '';
        $('hfEmail').value = x.email || x.last_email || '';
        $('hfPhone').value = x.phone || '';
        // Shared cruiser / staff logins: whoever is using it types their own name and email.
        if (x.member_class && x.member_class !== 'certificated') {
          $('hfName').placeholder = 'Your name'; $('hfEmail').placeholder = 'Your email';
        }
        MemberAuth.track('view_help');
        shared = !!x.shared;   // shared cruiser / transient login: don't list earlier requests (they may be someone else's)
        if (!shared) loadMine();
        (x.name ? $('hfMessage') : $('hfName')).focus();
      });
    }).catch(function () {
      $('helpStatus').innerHTML = '<p style="margin:0">Something went wrong loading this page. Please call the marina office at (252) 638-0318.</p>';
    });

    $('helpForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('hfError'), btn = $('hfSend');
      err.hidden = true;
      var name = $('hfName').value.trim(), email = $('hfEmail').value.trim(), phone = $('hfPhone').value.trim(), msg = $('hfMessage').value.trim();
      var text = $('hfText').checked, call = $('hfCall').checked;
      function fail(m, el) { err.textContent = m; err.hidden = false; if (el) el.focus(); }
      if (!name) return fail('Please enter your name.', $('hfName'));
      if (!msg) return fail('Please tell us what you need help with.', $('hfMessage'));
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('That email address doesn’t look right.', $('hfEmail'));
      if ((text || call) && phone.replace(/\D/g, '').length < 10) return fail('Please enter your phone number (with area code) so we can text or call you.', $('hfPhone'));
      if (!email && !phone) return fail('Please give an email address or a phone number so we can reach you.', $('hfEmail'));
      btn.disabled = true; btn.textContent = 'Sending…';
      sb.rpc('help_request_submit', { p_name: name, p_email: email, p_phone: phone, p_text: text, p_call: call,
                                      p_topic: $('hfTopic').value, p_message: msg }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Send Request';
        if (r.error) return fail(r.error.message);
        var how = [text ? 'text' : '', call ? 'call' : '', email ? 'email' : ''].filter(Boolean);
        $('hfDone').innerHTML = '<strong>Thank you, your request was sent to the marina office.</strong> ' +
          'We’ll get back to you' + (how.length ? ' by ' + how.join(' or ') : '') + ' as soon as we can.';
        $('hfDone').hidden = false;
        $('hfMessage').value = ''; $('hfTopic').value = 'Other';
        $('hfDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!shared) loadMine();
      });
    });
  });

  function loadMine() {
    sb.from('help_requests').select('created_at, topic, message, status, updated_at').eq('user_id', uid)   // admins can read all; show only this login's
      .order('created_at', { ascending: false }).limit(5).then(function (r) {
        var rows = r.data || [];
        $('helpMineCard').hidden = !rows.length;
        $('helpMine').innerHTML = rows.map(function (x) {
          return '<div class="help-mine"><div><strong>' + D.esc(x.topic) + '</strong> <span class="note">&middot; ' + D.esc(D.fmtWhen(x.created_at)) + '</span>' +
            ' <span class="help-status help-' + x.status + '">' + STATUS[x.status] + '</span></div>' +
            '<div class="note">' + D.esc(x.message.length > 160 ? x.message.slice(0, 160) + '…' : x.message) + '</div></div>';
        }).join('');
      });
  }
})();
