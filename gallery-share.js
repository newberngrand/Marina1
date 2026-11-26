/* Gallery: logged-in members, cruisers and staff can send photos and videos (files or a
   video link). They wait in private storage until an admin approves them on the Gallery
   Review page; nothing shows on the Gallery before that. Admins also get a Review Uploads
   button here with the number waiting. */
(function () {
  var wrap = document.getElementById('galShare');
  if (!wrap || !window.MemberAuth) return;
  var $ = function (id) { return document.getElementById(id); };
  var V = window.VideoUtils;
  var MAX_VIDEO = 50 * 1024 * 1024, MAX_PHOTO = 25 * 1024 * 1024;
  var PHOTO = /^image\/(jpeg|png|webp|gif)$/, VIDEO = /^video\/(mp4|quicktime|webm)$/;
  var sb = null, me = null, picked = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function size(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function kindOf(f) {
    if (PHOTO.test(f.type)) return 'photo';
    if (VIDEO.test(f.type) || (!f.type && /\.(mp4|mov|webm)$/i.test(f.name))) return 'video';
    return '';
  }
  function videoType(f) {
    if (f.type) return f.type;
    return /\.mov$/i.test(f.name) ? 'video/quicktime' : /\.webm$/i.test(f.name) ? 'video/webm' : 'video/mp4';
  }

  // Large phone photos are made smaller (longest side 2400 px) before uploading.
  function shrink(file) {
    return new Promise(function (resolve) {
      if (file.type === 'image/gif') return resolve({ blob: file, type: file.type, ext: 'gif' });
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 2400, w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, max / Math.max(w, h));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
          URL.revokeObjectURL(url);
          return resolve({ blob: file, type: file.type, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), w: w, h: h });
        }
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        c.toBlob(function (b) { resolve({ blob: b || file, type: type, ext: type === 'image/png' ? 'png' : 'jpg', w: c.width, h: c.height }); }, type, 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: file, type: file.type, ext: 'jpg' }); };
      img.src = url;
    });
  }

  if (!MemberAuth.hasSession || !MemberAuth.hasSession()) { $('galShareHint').hidden = false; return; }
  MemberAuth.getClient().then(function (c) {
    sb = c;
    return sb.auth.getSession();
  }).then(function (r) {
    var s = r && r.data && r.data.session;
    if (!s) { $('galShareHint').hidden = false; return; }
    me = s.user;
    return sb.from('members').select('slip, owner_name, active').eq('user_id', me.id).eq('active', true).limit(1).then(function (m) {
      if (!m.data || !m.data.length) { $('galShareHint').hidden = false; return; }
      wrap.hidden = false;
      setup();
      loadMine();
      sb.rpc('gallery_pending_count').then(function (c) {
        if (c.error) return;
        var n = c.data || 0;
        sb.rpc('is_admin').then(function (a) {
          if (!a.data) return;
          var link = $('gsReviewLink'), b = link.querySelector('.board-count');
          b.textContent = n; b.hidden = !n;
          link.title = n ? n + ' upload' + (n > 1 ? 's' : '') + ' waiting for review' : 'No uploads waiting for review';
          link.hidden = false;
        });
      });
    });
  }).catch(function () {});

  function setup() {
    $('gsOpen').addEventListener('click', function () {
      $('gsForm').hidden = false; $('gsDone').hidden = true; $('gsOpen').hidden = true;
      $('gsCaption').focus();
    });
    $('gsCancel').addEventListener('click', closeForm);
    $('gsFiles').addEventListener('change', function () {
      Array.prototype.forEach.call($('gsFiles').files, function (f) { picked.push(f); });
      $('gsFiles').value = '';
      renderPicked();
    });
    $('gsList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm]');
      if (b) { picked.splice(+b.getAttribute('data-rm'), 1); renderPicked(); }
    });
    var t = null;
    $('gsLink').addEventListener('input', function () { clearTimeout(t); t = setTimeout(detect, 300); });
    $('gsForm').addEventListener('submit', send);
  }
  function closeForm() {
    $('gsForm').hidden = true; $('gsOpen').hidden = false; $('gsErr').hidden = true;
    $('gsForm').reset(); picked = []; renderPicked(); $('gsDetected').textContent = '';
  }
  function detect() {
    var raw = $('gsLink').value.trim(), p = raw ? V.parse(raw) : null;
    $('gsDetected').innerHTML = !p ? '' : p.error ? '<span class="inactive">' + esc(p.error) + '</span>' : esc(V.name(p.provider)) + ' video recognized.';
    return p;
  }
  function problem(f) {
    var k = kindOf(f);
    if (!k) return 'not a photo or video we can use (JPG, PNG, WebP, GIF, MP4, MOV or WebM)';
    if (k === 'video' && f.size > MAX_VIDEO) return 'too large (' + size(f.size) + '; videos can be up to 50 MB). Please share it as a YouTube link instead';
    if (k === 'photo' && f.size > MAX_PHOTO) return 'too large (' + size(f.size) + ')';
    return '';
  }
  function renderPicked() {
    $('gsList').innerHTML = picked.map(function (f, i) {
      var bad = problem(f);
      return '<li' + (bad ? ' class="gs-bad"' : '') + '><span>' + (kindOf(f) === 'video' ? '&#127909; ' : '&#128247; ') + esc(f.name) +
        ' <span class="note">(' + size(f.size) + ')</span>' + (bad ? '<br><span class="gs-why">' + esc(bad) + '</span>' : '') + '</span>' +
        '<button type="button" class="btn-sm" data-rm="' + i + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></li>';
    }).join('');
  }
  function showErr(msg) { $('gsErr').textContent = msg; $('gsErr').hidden = false; }

  function send(e) {
    e.preventDefault();
    $('gsErr').hidden = true;
    var link = $('gsLink').value.trim(), parsed = link ? detect() : null;
    if (!picked.length && !link) return showErr('Please choose a photo or video, or paste a video link.');
    var bad = picked.filter(problem);
    if (bad.length) return showErr('Please remove the files marked in red first.');
    if (parsed && parsed.error) return showErr(parsed.error);
    var caption = $('gsCaption').value.trim(), credit = $('gsCredit').value.trim();
    var btn = $('gsSend'), total = picked.length + (parsed ? 1 : 0), sent = 0, failed = [];
    btn.disabled = true;

    picked.reduce(function (chain, f, k) {
      return chain.then(function () {
        btn.textContent = 'Sending ' + (k + 1) + ' of ' + total + '…';
        var kind = kindOf(f);
        var prep = kind === 'photo' ? shrink(f) : Promise.resolve({ blob: f, type: videoType(f), ext: (f.name.split('.').pop() || 'mp4').toLowerCase() });
        return prep.then(function (s) {
          var ext = String(s.ext).replace(/[^a-z0-9]/g, '').slice(0, 5) || (kind === 'photo' ? 'jpg' : 'mp4');
          var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
          return sb.storage.from('gallery-pending').upload(path, s.blob, { contentType: s.type, upsert: false }).then(function (up) {
            if (up.error) throw new Error(up.error.message);
            var cap = caption && picked.length > 1 ? caption + ' (' + (k + 1) + ')' : caption;
            return sb.rpc('gallery_submit', {
              p_kind: kind, p_storage_path: path, p_file_name: f.name, p_mime: s.type, p_size: s.blob.size,
              p_width: s.w || null, p_height: s.h || null, p_link_url: null, p_provider: null, p_video_id: null,
              p_caption: cap, p_credit: credit
            }).then(function (r) {
              if (r.error) { sb.storage.from('gallery-pending').remove([path]); throw new Error(r.error.message); }
              sent++;
            });
          });
        }).catch(function (ex) { failed.push(f.name + ' (' + ex.message + ')'); });
      });
    }, Promise.resolve()).then(function () {
      if (!parsed) return;
      btn.textContent = 'Sending ' + total + ' of ' + total + '…';
      return sb.rpc('gallery_submit', {
        p_kind: 'video_link', p_storage_path: null, p_file_name: '', p_mime: '', p_size: null, p_width: null, p_height: null,
        p_link_url: parsed.url, p_provider: parsed.provider, p_video_id: parsed.id, p_caption: caption, p_credit: credit
      }).then(function (r) { if (r.error) throw new Error(r.error.message); sent++; })
        .catch(function (ex) { failed.push('the video link (' + ex.message + ')'); });
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Send for Review';
      if (failed.length) {
        showErr('Not sent: ' + failed.join('; '));
        picked = picked.filter(function (f) { return failed.some(function (x) { return x.indexOf(f.name + ' (') === 0; }); });
        renderPicked();
        if (!failed.some(function (x) { return x.indexOf('the video link') === 0; })) { $('gsLink').value = ''; $('gsDetected').textContent = ''; }
      }
      if (sent) {
        if (!failed.length) closeForm();
        $('gsDone').innerHTML = '<strong>Thank you!</strong> ' + sent + ' item' + (sent > 1 ? 's were' : ' was') +
          ' sent to the marina for review. ' + (sent > 1 ? 'They' : 'It') + '&rsquo;ll appear on the Gallery once approved.';
        $('gsDone').hidden = false;
      }
      loadMine();
    });
  }

  // The person's own recent uploads and where each one stands.
  var STATUS = { pending: 'Waiting for review', approved: 'On the Gallery', rejected: 'Not used' };
  function loadMine() {
    sb.from('gallery_submissions').select('id, kind, file_name, link_url, caption, status, created_at, review_note')
      .eq('user_id', me.id).order('created_at', { ascending: false }).limit(12).then(function (r) {
        var rows = r.data || [];
        $('gsMine').hidden = !rows.length;
        if (!rows.length) return;
        $('gsMine').innerHTML = '<h4>Sent from this login</h4><ul>' + rows.map(function (x) {
          var name = x.caption || x.file_name || x.link_url || (x.kind === 'photo' ? 'Photo' : 'Video');
          return '<li><span>' + (x.kind === 'photo' ? '&#128247; ' : '&#127909; ') + esc(name) + '</span>' +
            '<span class="gs-status gs-' + x.status + '">' + STATUS[x.status] + '</span></li>';
        }).join('') + '</ul>';
      });
  }
})();
