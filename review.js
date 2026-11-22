/* Review page: someone invited to review a document opens it from their private
   emailed link (review.html?t=<token>), then approves it, asks for changes, or comments.
   No login is needed; the token is checked by the "review" server function. */
(function () {
  var FN = 'https://afejychfqezorwyqfcsh.supabase.co/functions/v1/review';
  var KEY = 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM';
  var token = (location.search.match(/[?&]t=([0-9a-f-]{36})/i) || [])[1];
  var box = document.getElementById('rvBox'), data = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  }
  function fmtDay(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtWhen(iso) {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function size(n) {
    if (!n) return '';
    return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }
  function call(body) {
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok || b.error) throw new Error(b.error || 'Something went wrong. Please try again.');
        return b;
      });
    });
  }

  var LABELS = { approved: 'Approved', changes: 'Changes requested', comment: 'Comment' };

  function render(note) {
    var d = data, closed = d.status !== 'open';
    document.getElementById('rvTitle').textContent = d.title;
    document.title = d.title + ' | Document Review';
    document.getElementById('rvSub').innerHTML = (d.name ? esc(d.name) + ', you&rsquo;ve' : 'You&rsquo;ve') + ' been asked to review this document.' +
      (d.due_date ? ' Please respond by <strong>' + esc(fmtDay(d.due_date)) + '</strong>.' : '');
    var html = '';
    if (d.message) html += '<div class="review-message">' + linkify(d.message) + '</div>';
    html += '<div class="review-file"><span class="review-file-name">' + esc(d.file_name) + (d.size_bytes ? ' <span class="note">(' + size(d.size_bytes) + ')</span>' : '') + '</span>' +
      (d.url ? '<a class="btn btn-gold" href="' + esc(d.url) + '" target="_blank" rel="noopener">Open the Document</a>' : '<span class="inactive">The file could not be loaded. Please refresh the page.</span>') + '</div>';
    if (d.decision) {
      html += '<div class="member-login-note review-done"><strong>Your response: ' + LABELS[d.decision] + '</strong> <span class="note">&middot; ' + esc(fmtWhen(d.responded_at)) + '</span>' +
        (d.comment ? '<div style="margin-top:6px">' + esc(d.comment).replace(/\n/g, '<br>') + '</div>' : '') + '</div>';
    }
    if (note) html += '<p class="member-login-note">' + esc(note) + '</p>';
    if (closed) {
      html += '<p class="note">This review has been closed' + (d.decision ? '.' : ', so responses can no longer be sent.') + ' Thank you.</p>';
    } else {
      html += '<form id="rvForm" class="member-form review-form"><h3>' + (d.decision ? 'Change your response' : 'Your response') + '</h3>' +
        '<div class="review-choices" role="radiogroup">' +
          choice('approved', 'Approve', 'It looks good to me.') +
          choice('changes', 'Request changes', 'Something should be changed first.') +
          choice('comment', 'Comment only', 'Share thoughts without approving.') +
        '</div>' +
        '<label class="full">Comments <span class="note" id="rvCommentHint">(optional)</span><textarea id="rvComment" rows="5" maxlength="4000">' + esc(d.comment || '') + '</textarea></label>' +
        '<div class="member-login-error" id="rvErr" hidden></div>' +
        '<div class="portal-actions"><button type="submit" class="btn btn-gold" id="rvSend">Send Response</button></div>' +
        '<p class="note" style="margin:0">Your response goes to the marina office. You can come back to this link and change it until the review closes.</p></form>';
    }
    box.innerHTML = html;
    var f = document.getElementById('rvForm');
    if (!f) return;
    function hint() {
      var c = f.querySelector('input[name=decision]:checked');
      document.getElementById('rvCommentHint').textContent = c && c.value !== 'approved' ? '(required)' : '(optional)';
    }
    f.addEventListener('change', hint); hint();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = f.querySelector('input[name=decision]:checked'), err = document.getElementById('rvErr'), btn = document.getElementById('rvSend');
      var comment = document.getElementById('rvComment').value.trim();
      err.hidden = true;
      if (!c) { err.textContent = 'Please choose Approve, Request changes, or Comment only.'; err.hidden = false; return; }
      if (c.value !== 'approved' && !comment) { err.textContent = 'Please add a comment saying what you think should change.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      call({ action: 'respond', token: token, decision: c.value, comment: comment }).then(function (r) {
        data.decision = c.value; data.comment = comment || null; data.responded_at = r.responded_at;
        render('Thank you. Your response was sent.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }).catch(function (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Send Response';
      });
    });
  }
  function choice(v, label, sub) {
    return '<label class="review-choice"><input type="radio" name="decision" value="' + v + '"' + (data.decision === v ? ' checked' : '') + '>' +
      '<span><strong>' + label + '</strong><span class="note">' + sub + '</span></span></label>';
  }

  if (!token) {
    box.innerHTML = '<p style="margin:0">This page opens from the private link in your review email. Please use the button in that email.</p>';
    return;
  }
  call({ action: 'get', token: token }).then(function (d) { data = d; render(''); })
    .catch(function (ex) { box.innerHTML = '<p style="margin:0">' + esc(ex.message) + '</p>'; });
})();
