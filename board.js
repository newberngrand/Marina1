/* Board page: board members upload meeting minutes and approve them.
   Minutes stay hidden from members until every board member has opened and approved them;
   the database publishes them automatically after the last approval. */
(function () {
  var D = window.MemberData, sb = null, me = null;
  function $(id) { return document.getElementById(id); }
  function fmtDate(iso) { return iso ? D.fmtWhen(iso) : ''; }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) {
        $('boardStatus').innerHTML = '<p style="margin:0">Please log in with your slip to use the Board page.</p>' +
          '<div class="portal-actions"><button type="button" class="btn btn-gold" id="bdLogin">Marina Login</button></div>';
        $('bdLogin').addEventListener('click', function () { MemberAuth.openLogin('login'); });
        return;
      }
      // Board rights follow the owner: any of a board member's slips (same email) can use this page.
      return sb.rpc('board_status').then(function (m) {
        me = m.data;
        if (!me || !me.is_board) {
          $('boardStatus').innerHTML = '<p style="margin:0">This page is for the Board of Directors.</p>';
          return;
        }
        $('boardStatus').hidden = true;
        $('boardBody').hidden = false;
        MemberAuth.track('view_board');
        loadReview();
        loadPublished();
        setupUpload();
      });
    }).catch(function () {
      $('boardStatus').innerHTML = '<p style="margin:0">Something went wrong loading the Board page. Please try again.</p>';
    });
  });

  /* ---------- review ---------- */
  var list = [];
  function loadReview(note) {
    return sb.rpc('minutes_for_review').then(function (r) {
      list = r.data || [];
      if (r.error) { $('reviewList').innerHTML = '<p class="member-login-error">' + D.esc(r.error.message) + '</p>'; return; }
      var html = note ? '<div class="member-login-note" style="margin-bottom:12px">' + note + '</div>' : '';
      if (!list.length) {
        $('reviewList').innerHTML = html + '<p class="note" style="margin:0">Nothing is waiting for approval. All minutes have been published.</p>';
        return;
      }
      $('reviewList').innerHTML = html + list.map(function (x, i) {
        var pct = x.board_size ? Math.round(x.approved_count * 100 / x.board_size) : 0;
        var who = (x.approved_by || []).map(function (a) { return D.esc(a.name || ('Slip ' + a.slip)); }).join(', ');
        var mine = x.my_approved_at
          ? '<span class="review-done">&#10003; You approved these ' + D.esc(fmtDate(x.my_approved_at)) + '</span>'
          : '<button type="button" class="btn btn-gold" data-approve="' + i + '"' + (x.my_viewed_at ? '' : ' disabled title="Open the minutes first"') + '>Approve</button>';
        return '<div class="review-card' + (x.my_approved_at ? ' done' : '') + '">' +
          '<div class="review-head"><strong>' + D.esc(x.title) + '</strong>' +
            (x.doc_date ? ' <span class="note">&middot; Meeting ' + D.esc(D.fmtDay(x.doc_date)) + '</span>' : '') + '</div>' +
          (x.description ? '<div class="note">' + D.esc(x.description) + '</div>' : '') +
          '<div class="note">Uploaded ' + D.esc(fmtDate(x.created_at)) + (x.submitted_by ? ' by slip ' + D.esc(x.submitted_by) : '') + '</div>' +
          '<div class="review-progress"><div class="vr-bar"><span style="width:' + pct + '%"></span></div>' +
            '<span><strong>' + x.approved_count + ' of ' + x.board_size + '</strong> board members have approved' + (who ? ': ' + who : '') + '</span></div>' +
          '<div class="portal-actions">' +
            '<button type="button" class="btn btn-outline" data-view="' + i + '">' + (x.my_viewed_at ? 'View again' : 'View minutes') + '</button>' + mine +
          '</div>' +
          (!x.my_viewed_at && !x.my_approved_at ? '<p class="note" style="margin:6px 0 0">Approve unlocks after you open the minutes.</p>' : '') +
        '</div>';
      }).join('');
    });
  }

  document.addEventListener('click', function (e) {
    var v = e.target.closest('[data-view]'), a = e.target.closest('[data-approve]');
    if (v) {
      var x = list[+v.getAttribute('data-view')];
      // Record the viewing, then open the file; Approve unlocks on return.
      sb.rpc('minutes_viewed', { p_document_id: x.id }).then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        loadReview();
      });
      D.openDocument(sb, x.storage_path, x.file_name, { id: x.id, title: x.title + ' (board review)', category: 'minutes' });
    }
    if (a && !a.disabled) {
      var y = list[+a.getAttribute('data-approve')];
      if (!confirm('Approve "' + y.title + '"?\n\nWhen every board member has approved, these minutes are published to the Members page.')) return;
      a.disabled = true;
      sb.rpc('minutes_approve', { p_document_id: y.id }).then(function (r) {
        if (r.error) { alert(r.error.message); a.disabled = false; return; }
        var d = r.data || {};
        loadReview(d.published
          ? 'Thank you. That was the final approval: <strong>' + D.esc(y.title) + '</strong> is now published on the Members page.'
          : 'Thank you. Your approval is recorded (' + d.approved + ' of ' + d.board_size + ').');
        if (d.published) loadPublished();
        refreshMenuCount();
      });
    }
  });

  function refreshMenuCount() {
    sb.rpc('board_status').then(function (r) {
      var n = (r.data && r.data.pending) || 0;
      document.querySelectorAll('.board-count').forEach(function (b) { b.textContent = n; b.hidden = !n; });
    });
  }

  /* ---------- recently published ---------- */
  function loadPublished() {
    sb.from('documents').select('id, title, doc_date, published_at, storage_path, file_name')
      .eq('category', 'minutes').eq('approval_status', 'approved').not('published_at', 'is', null)
      .order('published_at', { ascending: false }).limit(8)
      .then(function (r) {
        var rows = r.data || [];
        $('publishedList').innerHTML = rows.length ? '<ul class="doc-list">' + rows.map(function (x) {
          return '<li><strong>' + D.esc(x.title) + '</strong>' + (x.doc_date ? ' <span class="note">&middot; Meeting ' + D.esc(D.fmtDay(x.doc_date)) + '</span>' : '') +
            '<div class="note">Published ' + D.esc(fmtDate(x.published_at)) + '</div></li>';
        }).join('') + '</ul>' : '<p class="note" style="margin:0">No minutes have been published through board review yet.</p>';
      });
  }

  /* ---------- upload ---------- */
  function setupUpload() {
    $('mnFile').addEventListener('change', function () {
      var f = $('mnFile').files[0];
      if (f && !$('mnTitle').value.trim()) $('mnTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
    $('minutesForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('mnError'), done = $('mnDone'), btn = $('mnSave'), f = $('mnFile').files[0];
      err.hidden = true; done.hidden = true;
      var date = $('mnDate').value, title = $('mnTitle').value.trim();
      if (!date || !title || !f) { err.textContent = 'Please fill in the meeting date, title and file.'; err.hidden = false; return; }
      if (f.size > 25 * 1024 * 1024) { err.textContent = 'That file is larger than 25 MB.'; err.hidden = false; return; }
      var safe = f.name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80);
      var path = 'minutes/' + date.slice(0, 4) + '/' + Date.now() + '-' + safe;
      btn.disabled = true; btn.textContent = 'Uploading…';
      sb.storage.from('marina-docs').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
        .then(function (r) {
          if (r.error) throw new Error(/mime/i.test(r.error.message) ? 'That file type is not allowed.' : r.error.message);
          return sb.from('documents').insert({
            category: 'minutes', title: title, description: $('mnDesc').value.trim(), doc_date: date,
            storage_path: path, file_name: f.name, mime_type: f.type || '', size_bytes: f.size, active: true
          });
        })
        .then(function (r) {
          if (r.error) { sb.storage.from('marina-docs').remove([path]); throw new Error(r.error.message); }
          $('minutesForm').reset();
          done.innerHTML = '<strong>' + D.esc(title) + '</strong> is uploaded and waiting for board approval.';
          done.hidden = false;
          loadReview();
          refreshMenuCount();
        })
        .catch(function (ex) { err.textContent = ex.message; err.hidden = false; })
        .then(function () { btn.disabled = false; btn.textContent = 'Upload for Board Review'; });
    });
  }
})();
