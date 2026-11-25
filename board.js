/* Board page: board members read, approve and suggest changes to meeting minutes, write minutes,
   and upload minutes written elsewhere. Minutes stay hidden from members until every board member
   has approved them; then they are published (minutes written here get their PDF at that point). */
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
        var justSubmitted = /[?&]submitted=1/.test(location.search);
        loadReview(justSubmitted ? 'Your minutes were submitted. Every board member can now review and approve them below.' : '');
        if (justSubmitted) history.replaceState(null, '', location.pathname);
        loadPublished();
        cleanStaleFiles();
        setupBoardDocs();
        setupUpload();
        setupWriting();
      });
    }).catch(function () {
      $('boardStatus').innerHTML = '<p style="margin:0">Something went wrong loading the Board page. Please try again.</p>';
    });
  });

  /* ---------- review ---------- */
  // Minutes written on the website are read right here. Each board member can approve (with an
  // optional suggested change) or just suggest a change; the person editing the minutes works the
  // suggestions in. Approvals stand when the minutes are edited; a member who approved an earlier
  // version sees what changed. After the last approval this browser makes the PDF and publishes it.
  // Minutes uploaded as a file keep the earlier review (open the file, then Approve).
  var list = [], reviews = [], openReader = {};
  var SUG_LABEL = { open: 'Waiting', made: 'Made', not_made: 'Not made' };
  function loadReview(note) {
    return Promise.all([sb.rpc('minutes_review_list'), sb.rpc('minutes_for_review')]).then(function (res) {
      if (res[0].error || res[1].error) {
        $('reviewList').innerHTML = '<p class="member-login-error">' + D.esc((res[0].error || res[1].error).message) + '</p>'; return;
      }
      reviews = res[0].data || [];
      list = (res[1].data || []).filter(function (x) { return !x.draft_id; });
      var html = note ? '<div class="member-login-note" style="margin-bottom:12px">' + note + '</div>' : '';
      if (!reviews.length && !list.length) {
        $('reviewList').innerHTML = html + '<p class="note" style="margin:0">Nothing is waiting for approval. All minutes have been published.</p>';
        return;
      }
      $('reviewList').innerHTML = html + reviews.map(draftCard).join('') + list.map(fileCard).join('');
      reviews.forEach(function (x, i) { if (openReader[x.id]) showReader(i, false); });
      // Fully approved but not yet published (e.g. the browser closed mid-way): publish now.
      reviews.forEach(function (x) { if (x.board_size && x.approved_count >= x.board_size) publishDraft(x); });
    });
  }

  function progress(x) {
    var pct = x.board_size ? Math.round(x.approved_count * 100 / x.board_size) : 0;
    var who = (x.approvals || x.approved_by || []).map(function (a) {
      return D.esc(a.name || ('Slip ' + a.slip)) + (a.changed ? ' <span class="note">(before the latest changes)</span>' : '');
    }).join(', ');
    return '<div class="review-progress"><div class="vr-bar"><span style="width:' + pct + '%"></span></div>' +
      '<span><strong>' + x.approved_count + ' of ' + x.board_size + '</strong> board members have approved' + (who ? ': ' + who : '') + '</span></div>';
  }

  function draftCard(x, i) {
    var stale = x.my_approved_at && x.my_approved_html !== x.html;
    var mine = (x.suggestions || []).filter(function (s) { return s.slip === me.board_slip; });
    var open = (x.suggestions || []).filter(function (s) { return s.status === 'open'; }).length;
    var state = x.my_approved_at
      ? (stale ? '<span class="review-stale">&#9888; Changed since you approved ' + D.esc(fmtDate(x.my_approved_at)) + '</span>'
               : '<span class="review-done">&#10003; You approved these ' + D.esc(fmtDate(x.my_approved_at)) + '</span>')
      : '';
    return '<div class="review-card' + (x.my_approved_at && !stale ? ' done' : '') + '" data-card="' + i + '">' +
      '<div class="review-head"><strong>' + D.esc(x.title) + '</strong> <span class="note">&middot; Meeting ' + D.esc(D.fmtDay(x.meeting_date)) + '</span></div>' +
      '<div class="note">Submitted ' + D.esc(fmtDate(x.submitted_at)) + (x.submitted_by ? ' by slip ' + D.esc(x.submitted_by) : '') +
        ' &middot; last edited ' + D.esc(fmtDate(x.updated_at)) + (x.updated_by ? ' by slip ' + D.esc(x.updated_by) : '') +
        ((x.suggestions || []).length ? ' &middot; ' + x.suggestions.length + ' suggestion' + (x.suggestions.length === 1 ? '' : 's') + (open ? ' (' + open + ' waiting)' : '') : '') + '</div>' +
      progress(x) +
      '<div class="portal-actions">' +
        '<button type="button" class="btn btn-outline" data-read="' + i + '">' + (openReader[x.id] ? 'Hide minutes' : (x.my_viewed_at ? 'Read again' : 'Read the minutes')) + '</button>' + state +
        '<a class="btn-sm" href="minutes-edit.html?draft=' + x.id + '" title="Edit the minutes and work in the suggestions">Edit / see suggestions</a>' +
      '</div>' +
      (mine.length ? '<ul class="sug-mine">' + mine.map(function (s) {
        return '<li><span class="sug-status sug-' + s.status + '">' + SUG_LABEL[s.status] + '</span> ' + D.esc(s.body) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="review-reader" id="rd-' + i + '" hidden></div>' +
    '</div>';
  }

  function fileCard(x, i) {
    var mine = x.my_approved_at
      ? '<span class="review-done">&#10003; You approved these ' + D.esc(fmtDate(x.my_approved_at)) + '</span>'
      : '<button type="button" class="btn btn-gold" data-approve="' + i + '"' + (x.my_viewed_at ? '' : ' disabled title="Open the minutes first"') + '>Approve</button>';
    return '<div class="review-card' + (x.my_approved_at ? ' done' : '') + '">' +
      '<div class="review-head"><strong>' + D.esc(x.title) + '</strong>' +
        (x.doc_date ? ' <span class="note">&middot; Meeting ' + D.esc(D.fmtDay(x.doc_date)) + '</span>' : '') + ' <span class="note">&middot; uploaded file</span></div>' +
      (x.description ? '<div class="note">' + D.esc(x.description) + '</div>' : '') +
      '<div class="note">Uploaded ' + D.esc(fmtDate(x.created_at)) + (x.submitted_by ? ' by slip ' + D.esc(x.submitted_by) : '') + '</div>' +
      progress(x) +
      '<div class="portal-actions">' +
        '<button type="button" class="btn btn-outline" data-view="' + i + '">' + (x.my_viewed_at ? 'View again' : 'View minutes') + '</button>' + mine +
      '</div>' +
      (!x.my_viewed_at && !x.my_approved_at ? '<p class="note" style="margin:6px 0 0">Approve unlocks after you open the minutes.</p>' : '') +
    '</div>';
  }

  // The minutes as a read-only page, with Approve / Suggest a change underneath.
  function showReader(i, record) {
    var x = reviews[i], box = $('rd-' + i); if (!box) return;
    openReader[x.id] = true;
    var stale = x.my_approved_at && x.my_approved_html !== x.html;
    var changes = stale ? MinutesTools.diffHtml(x.my_approved_html || '', x.html) : '';
    box.innerHTML =
      (stale ? '<div class="review-changes"><strong>What changed since you approved</strong> <span class="note">(removed text is struck through, new text is underlined)</span>' +
        '<div class="review-diff">' + (changes || '<span class="note">Only formatting changed.</span>') + '</div></div>' : '') +
      // Laid out like the PDF the members will get: same page width, margins, header, footer and type.
      '<div class="minutes-sheet"><div class="ms-head"><b>New Bern Grand Marina Yacht Club</b><span>' + D.esc(x.title) + '</span></div>' +
        '<div class="minutes-page">' + x.html + '</div>' +
        '<div class="ms-foot"><span>Board review copy &middot; Meeting ' + D.esc(x.meeting_date) + '</span></div></div>' +
      '<div class="review-respond">' +
        '<label>Suggested change <span class="note">(optional with an approval)</span>' +
          '<textarea id="sg-' + i + '" rows="3" maxlength="4000" placeholder="e.g. In Motion 2, the vote was 4-1, not 5-0."></textarea></label>' +
        '<div class="portal-actions">' +
          '<button type="button" class="btn btn-gold" data-approve-draft="' + i + '">' + (x.my_approved_at ? (stale ? 'Approve the changes' : 'Approve again') : 'Approve') + '</button>' +
          '<button type="button" class="btn btn-outline" data-suggest="' + i + '">Suggest a change without approving</button>' +
          '<button type="button" class="btn-sm" data-pdf="' + i + '" title="Shows the PDF as it would be made now; nothing is saved">Preview as PDF</button>' +
        '</div>' +
        '<p class="note" style="margin:4px 0 0">Your approval stands even if the minutes are edited later; you&rsquo;ll be shown what changed.</p>' +
      '</div>';
    box.hidden = false;
    var b = document.querySelector('[data-read="' + i + '"]'); if (b) b.textContent = 'Hide minutes';
    if (record && !x.my_viewed_at) sb.rpc('minutes_read', { p_draft_id: x.id }).then(function (r) { if (!r.error) x.my_viewed_at = new Date().toISOString(); });
  }

  // Make the PDF from the minutes as they stand, file it, and publish it to members.
  var publishing = {};
  function publishDraft(x) {
    if (publishing[x.id]) return publishing[x.id];
    var date = x.meeting_date, name = (x.title || 'Minutes').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) + '.pdf';
    var path = 'minutes/' + date.slice(0, 4) + '/' + Date.now() + '-' + name, size = 0;
    publishing[x.id] = MinutesTools.toPdf(x.html, { title: x.title, meetingDate: date, final: true }).then(function (blob) {
      size = blob.size;
      return sb.storage.from('marina-docs').upload(path, blob, { contentType: 'application/pdf', upsert: false });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return sb.rpc('minutes_publish', { p_draft_id: x.id, p_storage_path: path, p_file_name: name, p_size: size });
    }).then(function (r) {
      if (r.error) { sb.storage.from('marina-docs').remove([path]); throw new Error(r.error.message); }
      if (r.data && r.data.already) sb.storage.from('marina-docs').remove([path]);   // someone else published it first
      delete publishing[x.id];
      loadReview('All board members approved <strong>' + D.esc(x.title) + '</strong>. The PDF was made and it is now published on the Members page.');
      loadPublished(); refreshMenuCount();
    }).catch(function (ex) {
      delete publishing[x.id];
      $('reviewList').insertAdjacentHTML('afterbegin', '<p class="member-login-error">All board members approved ' + D.esc(x.title) +
        ', but publishing it didn&rsquo;t finish: ' + D.esc(ex.message) + ' Reload this page to try again.</p>');
    });
    return publishing[x.id];
  }

  // Early PDFs left over from minutes moved to the new review are removed here.
  function cleanStaleFiles() {
    sb.from('minutes_stale_files').select('storage_path').then(function (r) {
      (r.data || []).forEach(function (f) {
        sb.storage.from('marina-docs').remove([f.storage_path]).then(function (x) {
          if (!x.error) sb.rpc('minutes_stale_file_removed', { p_path: f.storage_path });
        });
      });
    });
  }

  document.addEventListener('click', function (e) {
    var rd = e.target.closest('[data-read]');
    if (rd) {
      var ri = +rd.getAttribute('data-read'), rx = reviews[ri];
      if (openReader[rx.id]) { delete openReader[rx.id]; $('rd-' + ri).hidden = true; rd.textContent = 'Read again'; }
      else showReader(ri, true);
    }
    var ad = e.target.closest('[data-approve-draft]');
    if (ad && !ad.disabled) {
      var ai = +ad.getAttribute('data-approve-draft'), ax = reviews[ai], sug = ($('sg-' + ai).value || '').trim();
      if (!confirm('Approve "' + ax.title + '"' + (sug ? ' with your suggested change' : '') + '?\n\nWhen every board member has approved, a PDF is made and the minutes are published to the Members page.')) return;
      ad.disabled = true;
      var go = ax.my_viewed_at ? Promise.resolve({}) : sb.rpc('minutes_read', { p_draft_id: ax.id });
      go.then(function () { return sb.rpc('minutes_approve_draft', { p_draft_id: ax.id, p_suggestion: sug || null }); }).then(function (r) {
        if (r.error) { alert(r.error.message); ad.disabled = false; return; }
        var d = r.data || {};
        refreshMenuCount();
        if (d.ready) {
          $('reviewList').insertAdjacentHTML('afterbegin', '<div class="member-login-note">That was the final approval. Making the PDF and publishing&hellip;</div>');
          return sb.rpc('minutes_review_list').then(function (l) {
            var fresh = (l.data || []).filter(function (y) { return y.id === ax.id; })[0] || ax;
            return publishDraft(fresh);
          });
        }
        loadReview('Thank you. Your approval is recorded (' + d.approved + ' of ' + d.board_size + ')' + (sug ? ', with your suggested change' : '') + '.');
      });
    }
    var pf = e.target.closest('[data-pdf]');
    if (pf) {   // the PDF as it would be made right now; shown, not saved
      var px = reviews[+pf.getAttribute('data-pdf')], win = window.open('', '_blank');
      MinutesTools.toPdf(px.html, { title: px.title, meetingDate: px.meeting_date }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        if (win) win.location = url; else window.location = url;
      }).catch(function (ex) { if (win) win.close(); alert(ex.message); });
    }
    var sg = e.target.closest('[data-suggest]');
    if (sg && !sg.disabled) {
      var si = +sg.getAttribute('data-suggest'), sx = reviews[si], body = ($('sg-' + si).value || '').trim();
      if (!body) { alert('Please type the change you are suggesting in the box first.'); $('sg-' + si).focus(); return; }
      sg.disabled = true;
      sb.rpc('minutes_suggest', { p_draft_id: sx.id, p_body: body }).then(function (r) {
        if (r.error) { alert(r.error.message); sg.disabled = false; return; }
        loadReview('Thank you. Your suggested change for <strong>' + D.esc(sx.title) + '</strong> was sent to whoever is editing the minutes.');
      });
    }
    // Uploaded files: open the file, then Approve.
    var v = e.target.closest('[data-view]'), a = e.target.closest('[data-approve]');
    if (v) {
      var x = list[+v.getAttribute('data-view')];
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

  /* ---------- write minutes: drafts and templates ---------- */
  var templates = [], drafts = [], boardNames = [];
  function setupWriting() {
    sb.rpc('board_members').then(function (r) { boardNames = (r.data || []).map(function (b) { return b.name; }); });
    loadTemplates();
    loadDrafts();
    $('ndDate').addEventListener('change', function () {
      var t = $('ndTitle');
      if (!t.value.trim() || /^Board Meeting Minutes/.test(t.value)) t.value = 'Board Meeting Minutes – ' + D.fmtDay($('ndDate').value);
    });
    $('newDraftForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var date = $('ndDate').value, title = $('ndTitle').value.trim() || ('Board Meeting Minutes – ' + D.fmtDay(date));
      var t = templates.filter(function (x) { return x.id === $('ndTemplate').value; })[0];
      if (!date) { $('ndError').textContent = 'Please choose the meeting date.'; $('ndError').hidden = false; return; }
      $('ndError').hidden = true;
      var html = MinutesTools.fillTemplate(t ? t.html : '', { meetingDate: date, boardNames: boardNames });
      sb.rpc('board_status').then(function (st) {
        return sb.from('minutes_drafts').insert({ title: title, meeting_date: date, html: html, template_name: t ? t.name : null,
          created_by: (st.data && st.data.board_slip) || null }).select('id').single();
      }).then(function (r) {
        if (r.error) { $('ndError').textContent = r.error.message; $('ndError').hidden = false; return; }
        location.href = 'minutes-edit.html?draft=' + r.data.id;
      });
    });
    $('tplImport').addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f) return;
      $('tplError').hidden = true;
      MinutesTools.wordToHtml(f).then(function (html) {
        return sb.from('minutes_templates').insert({ name: f.name.replace(/\.docx$/i, ''), html: html }).select('id').single();
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        location.href = 'minutes-edit.html?template=' + r.data.id;
      }).catch(function (ex) { $('tplError').textContent = 'Could not import that file: ' + ex.message; $('tplError').hidden = false; });
    });
    document.addEventListener('click', function (e) {
      var dd = e.target.closest('[data-del-draft]'), dt = e.target.closest('[data-del-tpl]');
      if (dd) {
        var d = drafts[+dd.getAttribute('data-del-draft')];
        if (!confirm('Delete the draft "' + d.title + '"? This cannot be undone.')) return;
        sb.from('minutes_drafts').delete().eq('id', d.id).then(function (r) { if (r.error) alert(r.error.message); loadDrafts(); });
      }
      if (dt) {
        var t = templates[+dt.getAttribute('data-del-tpl')];
        if (!confirm('Delete the template "' + t.name + '"? Minutes already started from it are not affected.')) return;
        sb.from('minutes_templates').delete().eq('id', t.id).then(function (r) { if (r.error) alert(r.error.message); loadTemplates(); });
      }
    });
  }

  function loadTemplates() {
    return sb.from('minutes_templates').select('id, name, html, updated_at').order('name').then(function (r) {
      templates = r.data || [];
      $('ndTemplate').innerHTML = templates.map(function (t) { return '<option value="' + t.id + '">' + D.esc(t.name) + '</option>'; }).join('') +
        '<option value="">Blank page</option>';
      $('tplList').innerHTML = templates.length ? '<ul class="doc-list">' + templates.map(function (t, i) {
        return '<li class="tpl-row"><span><strong>' + D.esc(t.name) + '</strong> <span class="note">&middot; updated ' + D.esc(fmtDate(t.updated_at)) + '</span></span>' +
          '<span class="row-actions"><a class="btn-sm" href="minutes-edit.html?template=' + t.id + '">Edit</a>' +
          '<button type="button" class="btn-sm btn-danger" data-del-tpl="' + i + '">Delete</button></span></li>';
      }).join('') + '</ul>' : '<p class="note" style="margin:0">No templates yet.</p>';
    });
  }

  function loadDrafts() {
    return sb.from('minutes_drafts').select('id, title, meeting_date, status, locked_by, locked_at, updated_at, updated_by, return_note')
      .order('meeting_date', { ascending: false }).then(function (r) {
        drafts = r.data || [];
        var live = drafts.filter(function (d) { return d.status === 'draft' || d.status === 'returned'; }),
            sent = drafts.filter(function (d) { return d.status === 'submitted' || d.status === 'published'; });
        function row(d) {
          var i = drafts.indexOf(d);
          var editing = d.locked_by && d.locked_at && (Date.now() - new Date(d.locked_at).getTime() < 120000);
          var status = d.status === 'submitted' ? '<span class="badge badge-board">Under board review</span>'
            : d.status === 'published' ? '<span class="badge badge-public">Approved &amp; published</span>'
            : d.status === 'returned' ? '<span class="badge badge-returned">Needs changes</span>' + (d.return_note ? ' <span class="note">&ldquo;' + D.esc(d.return_note) + '&rdquo;</span>' : '')
            : '<span class="badge badge-private">Draft</span>';
          return '<li class="tpl-row"><span><strong>' + D.esc(d.title) + '</strong> <span class="note">&middot; meeting ' + D.esc(D.fmtDay(d.meeting_date)) + '</span><br>' + status +
            ' <span class="note">' + (editing ? '&#9998; Being edited by slip ' + D.esc(d.locked_by) : 'Last saved ' + D.esc(fmtDate(d.updated_at)) + (d.updated_by ? ' by slip ' + D.esc(d.updated_by) : '')) + '</span></span>' +
            '<span class="row-actions"><a class="btn-sm" href="minutes-edit.html?draft=' + d.id + '">' + (d.status === 'published' ? 'Read' : 'Open') + '</a>' +
            (d.status === 'draft' || d.status === 'returned' ? '<button type="button" class="btn-sm btn-danger" data-del-draft="' + i + '">Delete</button>' : '') + '</span></li>';
        }
        $('draftList').innerHTML = (live.length ? '<ul class="doc-list">' + live.map(row).join('') + '</ul>' : '<p class="note" style="margin:0">No drafts in progress.</p>') +
          (sent.length ? '<details class="doc-year" style="margin-top:10px"><summary>Under review or published (' + sent.length + ')</summary><ul class="doc-list">' + sent.slice(0, 10).map(row).join('') + '</ul></details>' : '');
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

  /* ---------- board-only documents ---------- */
  var boardDocs = [];
  function loadBoardDocs() {
    return sb.from('documents').select('id, title, description, doc_date, storage_path, file_name, size_bytes, created_at')
      .eq('category', 'board').eq('active', true)
      .order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      .then(function (r) {
        boardDocs = r.data || [];
        $('boardDocList').innerHTML = boardDocs.length ? '<ul class="doc-list">' + boardDocs.map(function (d, i) {
          return '<li><button type="button" class="doc-link" data-bdoc="' + i + '">' + D.esc(d.title) + '</button>' +
            (d.doc_date ? ' <span class="note">&middot; ' + D.esc(D.fmtDay(d.doc_date)) + '</span>' : '') +
            (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="note" style="margin:0">No board documents yet.</p>';
      });
  }
  function setupBoardDocs() {
    loadBoardDocs();
    $('boardDocList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bdoc]');
      if (!b) return;
      var d = boardDocs[+b.getAttribute('data-bdoc')];
      D.openDocument(sb, d.storage_path, d.file_name, { id: d.id, title: d.title, category: 'board' });
    });
    $('bdDocFile').addEventListener('change', function () {
      var f = $('bdDocFile').files[0];
      if (f && !$('bdDocTitle').value.trim()) $('bdDocTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
    $('bdDocForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = $('bdDocFile').files[0], err = $('bdDocError'), btn = $('bdDocSave');
      var title = $('bdDocTitle').value.trim();
      err.hidden = true;
      if (!title || !f) { err.textContent = 'Please enter a title and choose a file.'; err.hidden = false; return; }
      if (f.size > 25 * 1024 * 1024) { err.textContent = 'That file is larger than 25 MB.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Uploading…';
      var date = $('bdDocDate').value || null;
      var path = 'board/' + (date || new Date().toISOString()).slice(0, 4) + '/' + Date.now() + '-' +
        f.name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80);
      sb.storage.from('marina-docs').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
        .then(function (r) {
          if (r.error) throw new Error(r.error.message.indexOf('mime') !== -1 ? 'That file type is not allowed.' : r.error.message);
          return sb.from('documents').insert({ category: 'board', title: title, description: $('bdDocDesc').value.trim(), doc_date: date,
            storage_path: path, file_name: f.name, mime_type: f.type || '', size_bytes: f.size, active: true, is_public: false });
        })
        .then(function (r) {
          if (r.error) { sb.storage.from('marina-docs').remove([path]); throw new Error(r.error.message); }
          $('bdDocForm').reset();
          $('bdDocForm').closest('details').open = false;
          return loadBoardDocs();
        })
        .catch(function (ex) { err.textContent = ex.message; err.hidden = false; })
        .then(function () { btn.disabled = false; btn.textContent = 'Upload'; });
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
