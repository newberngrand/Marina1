/* Minutes editor: write a set of minutes (minutes-edit.html?draft=ID) or edit a template
   (minutes-edit.html?template=ID or ?template=new). Drafts save automatically every few seconds;
   only one board member edits a draft at a time. */
(function () {
  var D = window.MemberData, T = window.MinutesTools;
  var sb, token = '', mode, id, draft = null, tpl = null, editor = null;
  var editable = false, dirty = false, saving = false, lastSaved = null;
  function $(x) { return document.getElementById(x); }
  function err(m) { $('edError').textContent = m || ''; $('edError').hidden = !m; }
  function stamp(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function setSaved(text) { $('edSaved').textContent = text; }

  document.addEventListener('DOMContentLoaded', function () {
    var q = new URLSearchParams(location.search);
    mode = q.get('template') ? 'template' : 'draft';
    id = q.get('template') || q.get('draft');
    MemberAuth.getClient().then(function (c) { sb = c; return sb.auth.getSession(); }).then(function (r) {
      if (!r.data.session) {
        $('edStatus').innerHTML = '<p style="margin:0">Please log in with your slip.</p><div class="portal-actions"><button type="button" class="btn btn-gold" id="edLogin">Marina Login</button></div>';
        $('edLogin').addEventListener('click', function () { MemberAuth.openLogin('login'); });
        return;
      }
      token = r.data.session.access_token;
      sb.auth.onAuthStateChange(function (e, s) { if (s) token = s.access_token; });
      return Promise.all([sb.rpc('board_status'), sb.rpc('is_admin')]).then(function (res) {
        var board = res[0].data && res[0].data.is_board, admin = res[1].data;
        if (mode === 'draft' ? !board : !(board || admin)) {
          $('edStatus').innerHTML = '<p style="margin:0">This page is for the Board of Directors.</p>';
          return;
        }
        return mode === 'draft' ? openDraft() : openTemplate();
      });
    }).catch(function (e) { $('edStatus').innerHTML = '<p style="margin:0">' + D.esc(e.message || 'Something went wrong.') + '</p>'; });
  });

  /* ---------- editor ---------- */
  function startEditor(html, readOnly) {
    return T.load('tinymce').then(function () {
      return window.tinymce.init({
        selector: '#edBody', license_key: 'gpl',
        base_url: 'https://cdn.jsdelivr.net/npm/tinymce@7.6.0', suffix: '.min',
        height: 700, menubar: 'edit insert format table',
        plugins: 'lists table link searchreplace wordcount',
        toolbar: 'undo redo | blocks | bold italic underline | bullist numlist outdent indent | alignleft aligncenter alignright | table | link | removeformat',
        table_default_attributes: { border: '1' },
        table_default_styles: { 'border-collapse': 'collapse', width: '100%' },
        content_style: 'body{font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#1c2733;max-width:900px;margin:16px auto}' +
          'h1{font-size:1.5em;color:#0e2a4a}h2{font-size:1.25em;color:#0e2a4a}table{border-collapse:collapse;width:100%}' +
          'td,th{border:1px solid #9aa7b5;padding:4px 6px;vertical-align:top}th{background:#eef2f6}',
        branding: false, promotion: false, browser_spellcheck: true, contextmenu: false,
        readonly: !!readOnly,
        setup: function (ed) {
          ed.on('init', function () { ed.setContent(html || ''); ed.undoManager.clear(); });
          ed.on('input change undo redo ExecCommand keyup', function () { if (editable) markDirty(); });
        }
      });
    }).then(function (eds) { editor = eds[0]; });
  }
  function markDirty() { if (!dirty) { dirty = true; setSaved('Unsaved changes…'); } }

  /* ---------- drafts ---------- */
  function openDraft() {
    return sb.from('minutes_drafts').select('*').eq('id', id).maybeSingle().then(function (r) {
      draft = r.data;
      if (!draft) { $('edStatus').innerHTML = '<p style="margin:0">That draft no longer exists. <a href="board.html">Back to the Board page</a></p>'; return; }
      $('edStatus').hidden = true; $('edApp').hidden = false;
      $('edTitle').value = draft.title; $('edDate').value = draft.meeting_date;
      document.title = draft.title + ' | Minutes Editor';
      if (draft.status === 'returned') {
        $('edReturned').innerHTML = '<strong>Sent back for changes</strong>' + (draft.returned_by ? ' by slip ' + D.esc(draft.returned_by) : '') +
          (draft.return_note ? ': &ldquo;' + D.esc(draft.return_note) + '&rdquo;' : '.') + ' Make the changes, then submit again.';
        $('edReturned').hidden = false;
      }
      if (draft.status === 'submitted') {
        $('edLocked').innerHTML = 'These minutes were submitted for board approval, so they can&rsquo;t be edited here. ' +
          'If they need changes, a board member can choose <strong>Needs changes</strong> on the <a href="board.html">Board page</a>.';
        $('edLocked').hidden = false;
        $('edTitle').disabled = $('edDate').disabled = true;
        return startEditor(draft.html, true);
      }
      return sb.rpc('draft_open', { p_id: id }).then(function (o) {
        if (o.error) throw new Error(o.error.message);
        editable = !!(o.data && o.data.editable);
        if (!editable) showLocked(o.data || {});
        $('edTitle').disabled = $('edDate').disabled = !editable;
        $('edSubmit').hidden = $('edPreview').hidden = false;
        $('edHelp').innerHTML = 'Changes save automatically. When the minutes are finished, <strong>Submit for Board Approval</strong> turns them into a PDF ' +
          'and sends them to every board member to review and approve. Members only see them once all board members approve.';
        return startEditor(draft.html, !editable).then(function () {
          setSaved(editable ? 'All changes saved' : '');
          if (editable) startAutosave();
        });
      });
    });
  }

  function showLocked(o) {
    $('edLocked').innerHTML = '<strong>' + D.esc(o.locked_name || ('Slip ' + o.locked_by)) + '</strong> (slip ' + D.esc(o.locked_by || '') +
      ') is editing these minutes right now. You can read them; editing opens when they finish. ' +
      '<button type="button" class="btn-sm" id="edRetry">Try again</button>';
    $('edLocked').hidden = false;
    $('edSubmit').disabled = true;
    $('edRetry').addEventListener('click', function () { location.reload(); });
  }

  function save(force) {
    if (!editable || saving || (!dirty && !force)) return Promise.resolve();
    saving = true;
    var wasDirty = dirty; dirty = false;
    if (wasDirty) setSaved('Saving…');
    return sb.rpc('draft_save', { p_id: id, p_title: $('edTitle').value, p_meeting_date: $('edDate').value || null, p_html: editor.getContent() })
      .then(function (r) {
        saving = false;
        if (r.error) {
          dirty = dirty || wasDirty;
          setSaved('Not saved');
          err(r.error.message + (/editing/.test(r.error.message) ? ' Your latest changes were not saved; copy anything you need, then reload.' : ''));
          if (/editing|submitted/.test(r.error.message)) { editable = false; editor.mode.set('readonly'); }
          return;
        }
        err('');
        lastSaved = r.data;
        if (!dirty) setSaved('All changes saved ' + stamp(r.data));
      });
  }

  function startAutosave() {
    ['edTitle', 'edDate'].forEach(function (f) { $(f).addEventListener('input', markDirty); });
    setInterval(function () { save(false); }, 4000);
    setInterval(function () { save(true); }, 50000);       // keeps the editing lock while the page is open
    window.addEventListener('beforeunload', function (e) {
      if (!editable) return;
      // Last-moment save and release the lock (sent even as the page closes).
      var base = MemberAuth.config.url + '/rest/v1/rpc/', h = { apikey: MemberAuth.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      if (dirty) {
        fetch(base + 'draft_save', { method: 'POST', keepalive: true, headers: h,
          body: JSON.stringify({ p_id: id, p_title: $('edTitle').value, p_meeting_date: $('edDate').value || null, p_html: editor.getContent() }) });
      }
      fetch(base + 'draft_release', { method: 'POST', keepalive: true, headers: h, body: JSON.stringify({ p_id: id }) });
    });
  }

  function pdfName() {
    return ($('edTitle').value || 'Minutes').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) + '.pdf';
  }

  document.addEventListener('click', function (e) {
    if (e.target.id === 'edPreview') {
      var win = window.open('', '_blank');
      T.toPdf(editor.getContent(), { title: $('edTitle').value, meetingDate: $('edDate').value }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        if (win) win.location = url; else window.location = url;
      }).catch(function (ex) { if (win) win.close(); err(ex.message); });
    }
    if (e.target.id === 'edSubmit' && editable) submit();
    if (e.target.id === 'edSaveTpl') saveTemplate();
  });

  function submit() {
    var title = $('edTitle').value.trim(), date = $('edDate').value;
    if (!title || !date) return err('Please fill in the title and meeting date.');
    if (!confirm('Submit "' + title + '" for board approval?\n\nA PDF is made and every board member is asked to review and approve it. ' +
                 'The draft can no longer be edited unless a board member sends it back for changes.')) return;
    var btn = $('edSubmit'); btn.disabled = true; btn.textContent = 'Submitting…';
    var path = 'minutes/' + date.slice(0, 4) + '/' + Date.now() + '-' + pdfName();
    var blobSize = 0;
    save(true).then(function () {
      return T.toPdf(editor.getContent(), { title: title, meetingDate: date });
    }).then(function (blob) {
      blobSize = blob.size;
      return sb.storage.from('marina-docs').upload(path, blob, { contentType: 'application/pdf', upsert: false });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return sb.from('documents').insert({ category: 'minutes', title: title, doc_date: date, storage_path: path,
        file_name: pdfName(), mime_type: 'application/pdf', size_bytes: blobSize, active: true, description: 'Written on the website' }).select('id').single();
    }).then(function (r) {
      if (r.error) { sb.storage.from('marina-docs').remove([path]); throw new Error(r.error.message); }
      return sb.rpc('draft_submitted', { p_id: id, p_document_id: r.data.id });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      editable = false;
      location.href = 'board.html?submitted=1';
    }).catch(function (ex) {
      err('Could not submit: ' + ex.message);
      btn.disabled = false; btn.textContent = 'Submit for Board Approval';
    });
  }

  /* ---------- templates ---------- */
  function openTemplate() {
    var isNew = id === 'new';
    var get = isNew ? Promise.resolve({ data: { name: '', html: '' } }) : sb.from('minutes_templates').select('*').eq('id', id).maybeSingle();
    return get.then(function (r) {
      tpl = r.data;
      if (!tpl) { $('edStatus').innerHTML = '<p style="margin:0">That template no longer exists. <a href="board.html">Back to the Board page</a></p>'; return; }
      $('edStatus').hidden = true; $('edApp').hidden = false;
      $('edTitleWrap').hidden = $('edDateWrap').hidden = true;
      $('edNameWrap').hidden = false; $('edName').value = tpl.name;
      $('edSaveTpl').hidden = false; $('edImportWrap').hidden = false;
      document.title = (tpl.name || 'New template') + ' | Minutes Template';
      $('edHelp').innerHTML = 'Templates are the starting point for new minutes. Write <strong>{{meeting_date}}</strong> where the meeting date should go. ' +
        'In any table whose first column is headed <strong>Board Member</strong>, the board members&rsquo; names are filled in automatically.';
      editable = true;
      window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
      return startEditor(tpl.html, false).then(function () { setSaved(isNew ? 'Not saved yet' : 'Saved'); });
    });
  }

  $('edImport') && $('edImport').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    if (editor.getContent() && !confirm('Replace this template with the contents of ' + f.name + '?')) { this.value = ''; return; }
    T.wordToHtml(f).then(function (html) {
      editor.setContent(html); markDirty();
      if (!$('edName').value.trim()) $('edName').value = f.name.replace(/\.docx$/i, '');
    }).catch(function (ex) { err('Could not read that Word file: ' + ex.message); });
    this.value = '';
  });

  function saveTemplate() {
    var name = $('edName').value.trim();
    if (!name) return err('Please give the template a name.');
    var row = { name: name, html: editor.getContent() };
    var q = id === 'new' ? sb.from('minutes_templates').insert(row).select('id').single()
                         : sb.from('minutes_templates').update(row).eq('id', id).select('id').single();
    q.then(function (r) {
      if (r.error) return err(r.error.message);
      err('');
      if (id === 'new') { id = r.data.id; history.replaceState(null, '', '?template=' + id); }
      dirty = false; setSaved('Saved ' + stamp(new Date()));
    });
  }
})();
