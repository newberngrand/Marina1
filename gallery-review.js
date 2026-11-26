/* Gallery Review (admins): photos and videos sent from the Gallery page by members,
   cruisers and staff. Approving copies the file from private storage to the public
   Gallery and adds it to the end of the Photos or Videos list; rejecting deletes it. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var V = window.VideoUtils;
  var sb = null, items = [];
  var CLASS = { certificated: 'Slip owner', ltc: 'Long-term cruiser', stc: 'Transient', employee: 'Staff' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function size(n) { return !n ? '' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function when(iso) {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function who(x) {
    var c = x.member_class && x.member_class !== 'certificated' ? CLASS[x.member_class] || x.member_class : '';
    return c ? c + ' login' : x.slip ? 'Slip ' + x.slip : 'Member';
  }
  function note(html, bad) { $('grNote').innerHTML = html ? '<p class="' + (bad ? 'member-login-error' : 'member-login-note') + '">' + html + '</p>' : ''; }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (c) {
      sb = c;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) {
        $('grStatus').innerHTML = '<p style="margin:0">Please log in as an admin to review Gallery uploads.</p>' +
          '<div class="portal-actions"><button type="button" class="btn btn-gold" id="grLogin">Log In</button></div>';
        $('grLogin').addEventListener('click', function () { MemberAuth.openLogin(); });
        return;
      }
      return sb.rpc('is_admin').then(function (a) {
        if (!a.data) { $('grStatus').innerHTML = '<p style="margin:0">This page is for marina admins.</p>'; return; }
        $('grStatus').hidden = true;
        $('grBody').hidden = false;
        $('grRefresh').addEventListener('click', function () { note(''); load(); });
        $('grList').addEventListener('click', act);
        load();
      });
    }).catch(function (e) {
      $('grStatus').innerHTML = '<p style="margin:0">Something went wrong loading this page. Please try again.</p>';
    });
  });

  function load() {
    return Promise.all([
      sb.from('gallery_submissions').select('*').eq('status', 'pending').order('created_at'),
      sb.from('gallery_submissions').select('*').neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(25)
    ]).then(function (res) {
      items = res[0].data || [];
      var paths = items.filter(function (x) { return x.storage_path; }).map(function (x) { return x.storage_path; });
      var signed = paths.length ? sb.storage.from('gallery-pending').createSignedUrls(paths, 3600) : Promise.resolve({ data: [] });
      return signed.then(function (s) {
        var urls = {};
        (s.data || []).forEach(function (u) { if (u.signedUrl) urls[u.path] = u.signedUrl; });
        render(urls);
        renderDone(res[1].data || []);
      });
    });
  }

  function preview(x, url) {
    if (x.kind === 'photo') return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt=""></a>' : '<span class="vt-name">Photo</span>';
    if (x.kind === 'video') return url ? '<video src="' + esc(url) + '" controls preload="metadata" playsinline></video>' : '<span class="vt-name">Video</span>';
    var thumb = V.thumbUrl({ provider: x.provider, video_id: x.video_id });
    return '<a href="' + esc(x.link_url) + '" target="_blank" rel="noopener" class="gr-link">' +
      (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '<span class="vt-name">' + esc(V.name(x.provider)) + '</span>') +
      '<span class="video-source">' + esc(V.name(x.provider)) + ' &#8599;</span></a>';
  }

  function render(urls) {
    $('grHead').textContent = items.length ? items.length + ' waiting for review' : 'Waiting for review';
    $('grList').innerHTML = items.length ? items.map(function (x) {
      var what = x.kind === 'photo' ? 'Photo' : x.kind === 'video' ? 'Video file' : V.name(x.provider) + ' link';
      return '<div class="portal-card gr-card" data-id="' + x.id + '">' +
        '<div class="gr-preview">' + preview(x, urls[x.storage_path]) + '</div>' +
        '<div class="gr-info">' +
          '<div class="note"><strong>' + esc(what) + '</strong> from <strong>' + esc(who(x)) + '</strong> &middot; ' + esc(when(x.created_at)) +
            (x.file_name ? '<br>' + esc(x.file_name) + (x.size_bytes ? ' (' + size(x.size_bytes) + ')' : '') : '') + '</div>' +
          '<label class="gs-field">Description<input type="text" data-f="caption" maxlength="400" value="' + esc(x.caption) + '"></label>' +
          '<label class="gs-field">Taken by<input type="text" data-f="credit" maxlength="120" value="' + esc(x.credit) + '" placeholder="(optional)"></label>' +
          '<div class="portal-actions">' +
            '<button type="button" class="btn btn-gold" data-act="approve">Approve &amp; Publish</button>' +
            '<button type="button" class="btn btn-outline" data-act="reject">Reject</button>' +
          '</div>' +
        '</div></div>';
    }).join('') : '<div class="portal-card"><p style="margin:0">Nothing is waiting for review. New uploads from the Gallery page will show here.</p></div>';
  }

  function renderDone(rows) {
    $('grDone').innerHTML = rows.length ? '<ul class="gr-done-list">' + rows.map(function (x) {
      var name = x.caption || x.file_name || x.link_url || 'Untitled';
      return '<li><span class="gs-status gs-' + x.status + '">' + (x.status === 'approved' ? 'Published' : 'Rejected') + '</span> ' +
        esc(name) + ' <span class="note">&middot; ' + esc(who(x)) + ' &middot; reviewed ' + esc(when(x.reviewed_at)) +
        (x.review_note ? ' &middot; ' + esc(x.review_note) : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="note">Nothing reviewed yet.</p>';
  }

  function act(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var card = b.closest('.gr-card'), id = card.getAttribute('data-id');
    var x = items.filter(function (i) { return i.id === id; })[0];
    if (!x) return;
    var caption = card.querySelector('[data-f=caption]').value.trim(), credit = card.querySelector('[data-f=credit]').value.trim();
    var buttons = card.querySelectorAll('button');
    function busy(on, label) {
      buttons.forEach(function (k) { k.disabled = on; });
      if (label) b.textContent = label;
    }
    if (b.getAttribute('data-act') === 'reject') {
      var why = prompt('Reject this upload? It will be deleted and not shown on the Gallery.\n\nReason (optional, for your records):', '');
      if (why === null) return;
      busy(true, 'Rejecting…');
      sb.rpc('gallery_submission_reject', { p_id: id, p_note: why }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        if (x.storage_path) return sb.storage.from('gallery-pending').remove([x.storage_path]);
      }).then(function () { note('Rejected and deleted.'); return load(); })
        .catch(function (ex) { busy(false, 'Reject'); note(esc(ex.message), true); });
      return;
    }
    if (!caption && !confirm('Publish without a description?')) return;
    busy(true, 'Publishing…');
    var bucket = x.kind === 'photo' ? 'gallery' : 'gallery-videos';
    var dest = x.storage_path ? 'members/' + new Date().getFullYear() + '/' + x.storage_path.split('/').pop() : null;
    var copied = !x.storage_path ? Promise.resolve() :
      sb.storage.from('gallery-pending').download(x.storage_path).then(function (d) {
        if (d.error) throw new Error('Couldn\'t read the upload: ' + d.error.message);
        return sb.storage.from(bucket).upload(dest, d.data, { contentType: x.mime || d.data.type, upsert: false });
      }).then(function (up) { if (up.error) throw new Error('Couldn\'t copy it to the Gallery: ' + up.error.message); });
    copied.then(function () {
      return sb.rpc('gallery_submission_approve', { p_id: id, p_caption: caption, p_credit: credit, p_public_path: dest });
    }).then(function (r) {
      if (r.error) {
        if (dest) sb.storage.from(bucket).remove([dest]);
        throw new Error(r.error.message);
      }
      if (x.storage_path) return sb.storage.from('gallery-pending').remove([x.storage_path]);
    }).then(function () {
      note('Published to the Gallery ' + (x.kind === 'photo' ? 'Photos' : 'Videos') + ' (at the end; reorder it on the Admin page, Gallery tab).');
      return load();
    }).catch(function (ex) { busy(false, 'Approve & Publish'); note(esc(ex.message), true); });
  }
})();
