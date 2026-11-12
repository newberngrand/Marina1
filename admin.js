/* Admin page: manage current events, marina documents, and view members. */
(function () {
  var D = window.MemberData;
  var sb = null;
  var events = [], docs = [];

  function $(id) { return document.getElementById(id); }
  function showErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) {
        $('adminLoading').textContent = 'Please log in with an admin account.';
        MemberAuth.openLogin('login');
        return;
      }
      return sb.rpc('is_admin').then(function (res) {
        if (!res.data) {
          $('adminLoading').innerHTML = 'This page is for board administrators. <a href="member-portal.html">Go to the Member Portal</a>.';
          return;
        }
        $('adminLoading').hidden = true;
        $('adminApp').hidden = false;
        setupTabs();
        setupEvents();
        setupDocs();
        loadMembers();
      });
    }).catch(function (e) {
      $('adminLoading').textContent = e.message || 'Something went wrong.';
    });
  });

  /* ---------- Tabs ---------- */
  function setupTabs() {
    var tabs = document.querySelectorAll('.admin-tab');
    function show(name) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
      document.querySelectorAll('.admin-panel').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== name;
      });
      try { sessionStorage.setItem('adminTab', name); } catch (e) {}
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.getAttribute('data-tab')); }); });
    var saved = null;
    try { saved = sessionStorage.getItem('adminTab'); } catch (e) {}
    if (saved) show(saved);
  }

  /* ---------- Events ---------- */
  function setupEvents() {
    $('evType').innerHTML = D.EVENT_TYPES.map(function (t) {
      return '<option value="' + t.id + '">' + t.label + '</option>';
    }).join('');
    $('evNew').addEventListener('click', function () { openEventForm(null); });
    $('evCancel').addEventListener('click', function () { $('evForm').hidden = true; });
    $('evForm').addEventListener('submit', saveEvent);
    $('evRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var ev = events.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!ev) return;
      var act = b.getAttribute('data-act');
      if (act === 'edit') openEventForm(ev);
      if (act === 'toggle') sb.from('events').update({ active: !ev.active }).eq('id', ev.id).then(loadEvents);
      if (act === 'delete' && confirm('Delete "' + ev.title + '"? This cannot be undone.\n\nTip: choose Deactivate instead to just hide it from members.')) {
        sb.from('events').delete().eq('id', ev.id).then(loadEvents);
      }
    });
    loadEvents();
  }

  function loadEvents() {
    return sb.from('events').select('*').order('starts_at', { ascending: false, nullsFirst: true }).then(function (r) {
      events = r.data || [];
      if (!events.length) {
        $('evRows').innerHTML = '<tr><td colspan="5">No events yet. Click <strong>+ Add Event</strong> to create one.</td></tr>';
        return;
      }
      $('evRows').innerHTML = events.map(function (ev) {
        return '<tr' + (ev.active ? '' : ' class="row-inactive"') + '>' +
          '<td><a href="event.html?id=' + ev.id + '" target="_blank" rel="noopener"><strong>' + D.esc(ev.title) + '</strong></a>' +
            (ev.summary ? '<div class="note">' + D.esc(ev.summary) + '</div>' : '') + '</td>' +
          '<td><span class="badge badge-' + ev.event_type + '">' + D.eventTypeLabel(ev.event_type) + '</span></td>' +
          '<td>' + (ev.starts_at ? D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) : '<span class="note">No date</span>') + '</td>' +
          '<td>' + (ev.active ? 'Active' : '<span class="inactive">Inactive</span>') + '</td>' +
          '<td class="row-actions">' +
            '<button type="button" class="btn-sm" data-act="edit" data-id="' + ev.id + '">Edit</button>' +
            '<button type="button" class="btn-sm" data-act="toggle" data-id="' + ev.id + '">' + (ev.active ? 'Deactivate' : 'Activate') + '</button>' +
            '<button type="button" class="btn-sm btn-danger" data-act="delete" data-id="' + ev.id + '">Delete</button>' +
          '</td></tr>';
      }).join('');
    });
  }

  function openEventForm(ev) {
    $('evFormTitle').textContent = ev ? 'Edit Event' : 'Add Event';
    $('evId').value = ev ? ev.id : '';
    $('evTitle').value = ev ? ev.title : '';
    $('evType').value = ev ? ev.event_type : 'meeting';
    $('evLocation').value = ev ? ev.location : '';
    $('evStart').value = ev ? D.toLocalInput(ev.starts_at) : '';
    $('evEnd').value = ev ? D.toLocalInput(ev.ends_at) : '';
    $('evSummary').value = ev ? ev.summary : '';
    $('evDetails').value = ev ? ev.details : '';
    $('evActive').checked = ev ? ev.active : true;
    showErr($('evError'), '');
    $('evForm').hidden = false;
    $('evForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('evTitle').focus();
  }

  function saveEvent(e) {
    e.preventDefault();
    var row = {
      title: $('evTitle').value.trim(),
      event_type: $('evType').value,
      location: $('evLocation').value.trim(),
      starts_at: D.fromLocalInput($('evStart').value),
      ends_at: D.fromLocalInput($('evEnd').value),
      summary: $('evSummary').value.trim(),
      details: $('evDetails').value.trim(),
      active: $('evActive').checked
    };
    if (!row.title) return showErr($('evError'), 'Please enter a title.');
    if (row.starts_at && row.ends_at && row.ends_at < row.starts_at) return showErr($('evError'), 'The end time is before the start time.');
    var id = $('evId').value;
    var q = id ? sb.from('events').update(row).eq('id', id) : sb.from('events').insert(row);
    q.then(function (r) {
      if (r.error) return showErr($('evError'), r.error.message);
      $('evForm').hidden = true;
      loadEvents();
    });
  }

  /* ---------- Documents ---------- */
  function setupDocs() {
    $('docCategory').innerHTML = D.DOC_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + '</option>';
    }).join('');
    $('docCategory').addEventListener('change', updateDateLabel);
    $('docNew').addEventListener('click', function () { openDocForm(null); });
    $('docCancel').addEventListener('click', function () { $('docForm').hidden = true; });
    $('docForm').addEventListener('submit', saveDoc);
    $('docFile').addEventListener('change', function () {
      var f = $('docFile').files[0];
      if (f && !$('docTitle').value.trim()) $('docTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
    $('docList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var d = docs.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!d) return;
      var act = b.getAttribute('data-act');
      if (act === 'open') D.openDocument(sb, d.storage_path, d.file_name);
      if (act === 'edit') openDocForm(d);
      if (act === 'toggle') sb.from('documents').update({ active: !d.active }).eq('id', d.id).then(loadDocs);
      if (act === 'delete' && confirm('Delete "' + d.title + '" and its file? This cannot be undone.\n\nTip: choose Hide instead to just remove it from the member page.')) {
        sb.storage.from('marina-docs').remove([d.storage_path]).then(function () {
          return sb.from('documents').delete().eq('id', d.id);
        }).then(loadDocs);
      }
    });
    loadDocs();
  }

  function updateDateLabel() {
    var cat = D.DOC_CATEGORIES.find(function (c) { return c.id === $('docCategory').value; });
    $('docDateLabel').textContent = cat.dateLabel + (cat.id === 'minutes' ? ' (required)' : ' (optional)');
    $('docDate').required = cat.id === 'minutes';
  }

  function openDocForm(d) {
    $('docFormTitle').textContent = d ? 'Edit Document' : 'Upload Document';
    $('docSave').textContent = d ? 'Save Changes' : 'Upload';
    $('docId').value = d ? d.id : '';
    $('docCategory').value = d ? d.category : 'minutes';
    $('docDate').value = d && d.doc_date ? d.doc_date : '';
    $('docTitle').value = d ? d.title : '';
    $('docDesc').value = d ? d.description : '';
    $('docActive').checked = d ? d.active : true;
    $('docFile').value = '';
    $('docFile').required = !d;
    $('docFileWrap').firstChild.textContent = d
      ? 'Replace file (optional; currently ' + d.file_name + ')'
      : 'File (PDF, Word, Excel, PowerPoint or image; up to 25 MB)';
    updateDateLabel();
    showErr($('docError'), '');
    $('docForm').hidden = false;
    $('docForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function safeName(n) {
    return n.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80);
  }

  function saveDoc(e) {
    e.preventDefault();
    var id = $('docId').value;
    var file = $('docFile').files[0];
    var row = {
      category: $('docCategory').value,
      title: $('docTitle').value.trim(),
      description: $('docDesc').value.trim(),
      doc_date: $('docDate').value || null,
      active: $('docActive').checked
    };
    var err = $('docError');
    if (!row.title) return showErr(err, 'Please enter a title.');
    if (row.category === 'minutes' && !row.doc_date) return showErr(err, 'Minutes need a meeting date so they can be filed under the right month.');
    if (!id && !file) return showErr(err, 'Please choose a file to upload.');
    if (file && file.size > 25 * 1024 * 1024) return showErr(err, 'That file is larger than 25 MB.');

    var btn = $('docSave');
    btn.disabled = true;
    var oldPath = null;
    var chain = Promise.resolve();
    if (file) {
      var year = (row.doc_date || new Date().toISOString()).slice(0, 4);
      var path = row.category + '/' + year + '/' + Date.now() + '-' + safeName(file.name);
      showErr(err, '');
      btn.textContent = 'Uploading…';
      chain = sb.storage.from('marina-docs').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
        .then(function (r) {
          if (r.error) throw new Error(r.error.message.indexOf('mime') !== -1 ? 'That file type is not allowed.' : r.error.message);
          row.storage_path = path;
          row.file_name = file.name;
          row.mime_type = file.type || '';
          row.size_bytes = file.size;
          if (id) oldPath = docs.find(function (x) { return x.id === id; }).storage_path;
        });
    }
    chain.then(function () {
      return id ? sb.from('documents').update(row).eq('id', id) : sb.from('documents').insert(row);
    }).then(function (r) {
      if (r.error) {
        if (row.storage_path) sb.storage.from('marina-docs').remove([row.storage_path]);
        throw new Error(r.error.message);
      }
      if (oldPath) sb.storage.from('marina-docs').remove([oldPath]);
      $('docForm').hidden = true;
      return loadDocs();
    }).catch(function (ex) {
      showErr(err, ex.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = id ? 'Save Changes' : 'Upload';
    });
  }

  function docRow(d) {
    return '<tr' + (d.active ? '' : ' class="row-inactive"') + '>' +
      '<td><strong>' + D.esc(d.title) + '</strong>' + (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</td>' +
      '<td>' + (d.doc_date ? D.fmtDay(d.doc_date) : '') + '</td>' +
      '<td class="note">' + D.esc(d.file_name) + '<br>' + D.fileSize(d.size_bytes) + '</td>' +
      '<td>' + (d.active ? 'Visible' : '<span class="inactive">Hidden</span>') + '</td>' +
      '<td class="row-actions">' +
        '<button type="button" class="btn-sm" data-act="open" data-id="' + d.id + '">Open</button>' +
        '<button type="button" class="btn-sm" data-act="edit" data-id="' + d.id + '">Edit</button>' +
        '<button type="button" class="btn-sm" data-act="toggle" data-id="' + d.id + '">' + (d.active ? 'Hide' : 'Show') + '</button>' +
        '<button type="button" class="btn-sm btn-danger" data-act="delete" data-id="' + d.id + '">Delete</button>' +
      '</td></tr>';
  }

  function loadDocs() {
    return sb.from('documents').select('*').order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).then(function (r) {
      docs = r.data || [];
      var head = '<thead><tr><th>Title</th><th>Date</th><th>File</th><th>Status</th><th></th></tr></thead>';
      var html = D.DOC_CATEGORIES.map(function (c) {
        var list = docs.filter(function (d) { return d.category === c.id; });
        var body;
        if (!list.length) {
          body = '<p class="note" style="margin:0">Nothing uploaded yet.</p>';
        } else if (c.id === 'minutes') {
          var months = [], byMonth = {};
          list.forEach(function (d) {
            var k = D.monthKey(d.doc_date);
            if (!byMonth[k]) { byMonth[k] = []; months.push(k); }
            byMonth[k].push(d);
          });
          body = months.map(function (m) {
            return '<h4 class="month-head">' + m + '</h4><div class="admin-table-wrap"><table class="admin-table">' + head + '<tbody>' + byMonth[m].map(docRow).join('') + '</tbody></table></div>';
          }).join('');
        } else {
          body = '<div class="admin-table-wrap"><table class="admin-table">' + head + '<tbody>' + list.map(docRow).join('') + '</tbody></table></div>';
        }
        return '<div class="portal-card"><h3>' + c.label + ' <span class="count">(' + list.length + ')</span></h3>' + body + '</div>';
      }).join('');
      $('docList').innerHTML = html;
    });
  }

  /* ---------- Members ---------- */
  function loadMembers() {
    Promise.all([
      sb.from('members').select('slip, owner_name, email, active, is_admin'),
      sb.from('member_notes').select('slip, note')
    ]).then(function (r) {
      if (r[0].error) return;
      var notes = {};
      (r[1].data || []).forEach(function (n) { notes[n.slip] = n.note; });
      var rows = r[0].data.sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); });
      $('memCount').textContent = rows.length + ' slips on file. To change an owner, email or password, ask your web helper for now; editing here is coming.';
      function draw(f) {
        f = (f || '').toLowerCase();
        $('memRows').innerHTML = rows.filter(function (m) {
          return !f || (m.slip + ' ' + m.owner_name + ' ' + (m.email || '') + ' ' + (notes[m.slip] || '')).toLowerCase().indexOf(f) !== -1;
        }).map(function (m) {
          return '<tr><td><strong>' + D.esc(m.slip) + '</strong></td><td>' + D.esc(m.owner_name) +
            (notes[m.slip] ? '<div class="note">' + D.esc(notes[m.slip]) + '</div>' : '') +
            '</td><td>' + (m.email ? D.esc(m.email) : '<em>none</em>') + '</td>' +
            '<td>' + (m.is_admin ? 'Admin' : (m.active ? 'Active' : '<span class="inactive">Inactive</span>')) + '</td></tr>';
        }).join('');
      }
      draw('');
      $('memSearch').addEventListener('input', function (e) { draw(e.target.value); });
    });
  }
})();
