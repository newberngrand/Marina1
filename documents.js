/* Public Documents page: lists documents the board has marked Public (permits,
   rules, forms...). Files stay in private storage; each click gets a short-lived link.
   Members-only documents never appear here (the database won't return them to visitors). */
(function () {
  var D = window.MemberData;
  function $(id) { return document.getElementById(id); }

  function docLink(d) {
    return '<li><button type="button" class="doc-link" data-path="' + D.esc(d.storage_path) + '" data-name="' + D.esc(d.file_name) +
      '" data-id="' + D.esc(d.id) + '" data-title="' + D.esc(d.title) + '" data-cat="' + D.esc(d.category) + '">' +
      D.esc(d.title) + '</button>' +
      (d.doc_date ? ' <span class="note">&middot; ' + D.fmtDay(d.doc_date) + '</span>' : '') +
      (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</li>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (sb) {
      return sb.from('documents').select('id, category, title, description, doc_date, storage_path, file_name')
        .eq('active', true).eq('is_public', true)
        .order('doc_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .then(function (r) {
          var docs = r.data || [];
          if (r.error || !docs.length) {
            $('publicDocs').innerHTML = '<p class="note" style="margin:0">' +
              (r.error ? 'Documents could not be loaded right now. Please try again later.' : 'No public documents have been posted yet.') + '</p>';
            return;
          }
          $('publicDocs').innerHTML = '<div class="doc-grid">' + D.DOC_CATEGORIES.map(function (c) {
            var list = docs.filter(function (d) { return d.category === c.id; });
            if (!list.length) return '';
            return '<div class="doc-section doc-' + c.id + '">' +
              '<div class="doc-head"><h4>' + c.label + '</h4><span class="doc-count">' + list.length + '</span></div>' +
              '<div class="doc-body"><ul class="doc-list">' + list.map(docLink).join('') + '</ul></div></div>';
          }).join('') + '</div>';
          $('publicDocs').addEventListener('click', function (e) {
            var b = e.target.closest('.doc-link');
            if (b) D.openDocument(sb, b.getAttribute('data-path'), b.getAttribute('data-name'),
              { id: b.getAttribute('data-id'), title: b.getAttribute('data-title'), category: b.getAttribute('data-cat') });
          });
        });
    }).catch(function () {
      $('publicDocs').innerHTML = '<p class="note" style="margin:0">Documents could not be loaded right now. Please try again later.</p>';
    });
  });
})();
