/* Shared helpers for writing minutes on the website (Board page and the minutes editor):
   loading libraries, tidying imported Word files, filling in templates, and making the PDF. */
(function () {
  var LIBS = {
    tinymce: 'https://cdn.jsdelivr.net/npm/tinymce@7.6.0/tinymce.min.js',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
    pdfmake: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.12/build/pdfmake.min.js',
    pdffonts: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.12/build/vfs_fonts.js',
    html2pdfmake: 'https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.5.13/browser.js'
  };
  var loading = {};
  function load(name) {
    if (!loading[name]) {
      loading[name] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = LIBS[name];
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Could not load ' + name + '. Check your internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return loading[name];
  }

  // Word files come through with every table row marked as a header; keep only the first.
  function cleanImported(html) {
    var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'), root = doc.body.firstChild;
    root.querySelectorAll('a[id]:not([href])').forEach(function (a) { a.replaceWith.apply(a, Array.prototype.slice.call(a.childNodes)); });
    root.querySelectorAll('table').forEach(function (t) {
      var rows = Array.prototype.slice.call(t.querySelectorAll('tr'));
      if (!rows.length) return;
      var thead = doc.createElement('thead'), tbody = doc.createElement('tbody');
      rows.forEach(function (r, i) {
        if (i > 0) r.querySelectorAll('th').forEach(function (th) {
          var td = doc.createElement('td');
          while (th.firstChild) td.appendChild(th.firstChild);
          th.replaceWith(td);
        });
        (i === 0 ? thead : tbody).appendChild(r);
      });
      while (t.firstChild) t.removeChild(t.firstChild);
      t.appendChild(thead); t.appendChild(tbody);
      t.setAttribute('border', '1');
      t.style.borderCollapse = 'collapse';
      t.style.width = '100%';
    });
    return root.innerHTML;
  }

  function wordToHtml(file) {
    return load('mammoth').then(function () { return file.arrayBuffer(); }).then(function (buf) {
      return window.mammoth.convertToHtml({ arrayBuffer: buf });
    }).then(function (r) { return cleanImported(r.value); });
  }

  function cellText(c) { return (c.textContent || '').replace(/\s+/g, ' ').trim(); }

  // Fill a template for a new set of minutes: {{meeting_date}} and the board member names
  // in any vote table whose first column is headed "Board Member".
  function fillTemplate(html, opts) {
    var dateText = opts.meetingDate ? new Date(opts.meetingDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
    html = String(html || '').replace(/\{\{\s*meeting_date\s*\}\}|\{meeting date\}/gi, dateText);
    var names = opts.boardNames || [];
    if (!names.length) return html;
    var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'), root = doc.body.firstChild;
    root.querySelectorAll('table').forEach(function (t) {
      var first = t.querySelector('tr');
      if (!first || !/^board member/i.test(cellText(first.cells[0] || first))) return;
      var rows = Array.prototype.slice.call(t.querySelectorAll('tr')).slice(1);
      var totals = rows.filter(function (r) { return /^totals?$/i.test(cellText(r.cells[0] || r)); })[0];
      var empty = rows.filter(function (r) { return r !== totals && r.cells[0] && !cellText(r.cells[0]); });
      // Enough rows for everyone on the board.
      while (empty.length < names.length && (empty.length || rows.length)) {
        var model = empty[empty.length - 1] || rows[rows.length - 1], copy = model.cloneNode(true);
        Array.prototype.forEach.call(copy.cells, function (c) { c.innerHTML = ''; });
        model.parentNode.insertBefore(copy, totals && totals.parentNode === model.parentNode ? totals : model.nextSibling);
        empty.push(copy);
      }
      names.forEach(function (n, i) { if (empty[i]) empty[i].cells[0].textContent = n; });
    });
    return root.innerHTML;
  }

  // A clean, text-based PDF of the minutes.
  function toPdf(html, opts) {
    return load('pdfmake').then(function () { return load('pdffonts'); }).then(function () { return load('html2pdfmake'); }).then(function () {
      // Paragraphs inside table cells add a lot of height in the PDF; keep just their text (one line each).
      var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'), root = doc.body.firstChild;
      root.querySelectorAll('td p, th p').forEach(function (p) {
        var frag = doc.createDocumentFragment();
        while (p.firstChild) frag.appendChild(p.firstChild);
        if (p.nextElementSibling && p.nextElementSibling.tagName === 'P') frag.appendChild(doc.createElement('br'));
        p.replaceWith(frag);
      });
      root.querySelectorAll('td, th').forEach(function (c) { if (!c.textContent.trim() && !c.querySelector('img')) c.innerHTML = '&nbsp;'; });
      html = root.innerHTML;
      var body = window.htmlToPdfmake(html, {
        defaultStyles: { h1: { fontSize: 16, bold: true, marginBottom: 6, marginTop: 10, color: '#0e2a4a' },
                         h2: { fontSize: 14, bold: true, marginBottom: 5, marginTop: 8, color: '#0e2a4a' },
                         h3: { fontSize: 12, bold: true, marginBottom: 4, marginTop: 6 },
                         p: { margin: [0, 2, 0, 5] }, th: { bold: true, fillColor: '#eef2f6', margin: [2, 3, 2, 3] }, td: { margin: [2, 3, 2, 3] },
                         table: { marginBottom: 8 } },
        tableAutoSize: true
      });
      // Keep small tables (like a motion's vote table) on one page, together with the one or two
      // short lines just above them ("Motion 1:", "Moved by / Seconded by").
      if (Array.isArray(body)) {
        var out = [];
        body.forEach(function (n) {
          if (n && n.table && n.table.body && n.table.body.length <= 14) {
            var lead = [];
            while (lead.length < 3 && out.length) {
              var prev = out[out.length - 1], st = [].concat(prev && prev.style || []);
              var isHead = st.some(function (x) { return /^html-h\d$/.test(x); });
              if (!prev || prev.table || prev.stack || (st.indexOf('html-p') === -1 && !isHead)) break;
              lead.unshift(out.pop());
              if (isHead) break;               // a heading starts the group
            }
            out.push({ stack: lead.concat([n]), unbreakable: true });
          } else out.push(n);
        });
        body = out;
      }
      var def = {
        pageSize: 'LETTER', pageMargins: [50, 70, 50, 60],
        info: { title: opts.title || 'Minutes', author: 'New Bern Grand Marina Yacht Club' },
        header: { margin: [50, 28, 50, 0], columns: [
          { text: 'New Bern Grand Marina Yacht Club', bold: true, color: '#0e2a4a', fontSize: 10 },
          { text: opts.title || '', alignment: 'right', color: '#5c6b7a', fontSize: 9 }] },
        footer: function (page, pages) {
          return { margin: [50, 20, 50, 0], columns: [
            { text: (opts.final ? 'Approved by the Board of Directors' : 'Board review copy') + (opts.meetingDate ? ' · Meeting ' + opts.meetingDate : ''), color: '#8a96a3', fontSize: 8 },
            { text: 'Page ' + page + ' of ' + pages, alignment: 'right', color: '#8a96a3', fontSize: 8 }] };
        },
        content: body,
        defaultStyle: { fontSize: 10.5, lineHeight: 1.2 }
      };
      return new Promise(function (resolve) { window.pdfMake.createPdf(def).getBlob(resolve); });
    });
  }

  // What changed between two versions of the minutes, word by word, as HTML:
  // removed words struck through, added words underlined, long unchanged stretches shortened.
  function htmlText(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html'), root = doc.body.firstChild;
    root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,br,table').forEach(function (el) { el.appendChild(doc.createTextNode('\n')); });
    root.querySelectorAll('td,th').forEach(function (el) { el.appendChild(doc.createTextNode(' | ')); });
    return root.textContent.replace(/[ \t ]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();
  }
  function diffHtml(oldHtml, newHtml) {
    function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    var a = htmlText(oldHtml).split(/(\s+)/).filter(Boolean), b = htmlText(newHtml).split(/(\s+)/).filter(Boolean);
    // Trim the common start and end, then compare what is left.
    var pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    var post = 0; while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
    var A = a.slice(pre, a.length - post), B = b.slice(pre, b.length - post), ops = [];
    if (!A.length && !B.length) return '';
    if (A.length * B.length > 4e6) { ops.push(['-', A.join('')], ['+', B.join('')]); }
    else {
      var n = A.length, m = B.length, L = [];
      for (var i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
      for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      i = 0; j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
        else if (j < m && (i === n || L[i][j + 1] > L[i + 1][j])) { ops.push(['+', B[j]]); j++; }
        else { ops.push(['-', A[i]]); i++; }
      }
    }
    var before = a.slice(Math.max(0, pre - 16), pre).join(''), after = a.slice(a.length - post, a.length - post + 16).join('');
    var out = (pre > 16 ? '&hellip;' : '') + esc(before), run = '', kind = '';
    function flush() {
      if (!run) return;
      if (kind === '=') out += esc(run.length > 160 ? run.slice(0, 70) + ' … ' + run.slice(-70) : run);
      else out += kind === '+' ? '<ins>' + esc(run) + '</ins>' : '<del>' + esc(run) + '</del>';
      run = '';
    }
    ops.forEach(function (o) { if (o[0] !== kind) { flush(); kind = o[0]; } run += o[1]; });
    flush();
    out += esc(after) + (post > 16 ? '&hellip;' : '');
    return out.replace(/\n/g, '<br>');
  }

  window.MinutesTools = { load: load, cleanImported: cleanImported, wordToHtml: wordToHtml, fillTemplate: fillTemplate, toPdf: toPdf, diffHtml: diffHtml };
})();
