/* Shared labels and helpers for the member portal, event page and admin page. */
(function () {
  var TZ = 'America/New_York';

  var EVENT_TYPES = [
    { id: 'meeting', label: 'Meeting' },
    { id: 'vote', label: 'Vote' },
    { id: 'notice', label: 'Notice' },
    { id: 'social', label: 'Social' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'other', label: 'Other' }
  ];

  var DOC_CATEGORIES = [
    { id: 'bylaws', label: 'Bylaws & Amendments', dateLabel: 'Effective date' },
    { id: 'rules', label: 'Rules & Regulations', dateLabel: 'Effective date' },
    { id: 'minutes', label: 'Meeting Minutes', dateLabel: 'Meeting date' },
    { id: 'financials', label: 'Budgets & Financials', dateLabel: 'Date' },
    { id: 'permits', label: 'Permits & Licenses', dateLabel: 'Issue date' },
    { id: 'insurance', label: 'Insurance', dateLabel: 'Effective date' },
    { id: 'forms', label: 'Forms', dateLabel: 'Date' },
    { id: 'other', label: 'Other Documents', dateLabel: 'Date' }
  ];

  function label(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Plain text with line breaks and clickable links, safely escaped.
  function richText(s) {
    return esc(s)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(d) {
    return new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  }
  function fmtWhen(start, end) {
    if (!start) return '';
    var s = fmtDate(start) + ', ' + fmtTime(start);
    if (end) {
      s += (fmtDate(end) === fmtDate(start) ? ' – ' + fmtTime(end) : ' – ' + fmtDate(end) + ', ' + fmtTime(end));
    }
    return s;
  }
  // A plain YYYY-MM-DD (no time zone shift).
  function fmtDay(ymd) {
    if (!ymd) return '';
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function monthKey(ymd) {
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // <input type="datetime-local"> value (Eastern time) <-> ISO timestamp.
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    var hh = parts.hour === '24' ? '00' : parts.hour;
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + hh + ':' + parts.minute;
  }
  function fromLocalInput(v) {
    if (!v) return null;
    // Interpret the typed wall-clock time as Eastern time.
    var guess = new Date(v + ':00Z');
    for (var i = 0; i < 2; i++) {
      var shown = toLocalInput(guess.toISOString());
      var diff = new Date(v + ':00Z') - new Date(shown + ':00Z');
      guess = new Date(guess.getTime() + diff);
    }
    return guess.toISOString();
  }

  function fileSize(n) {
    if (!n) return '';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function openDocument(sb, path, fileName) {
    var win = window.open('', '_blank');
    return sb.storage.from('marina-docs').createSignedUrl(path, 300).then(function (r) {
      if (r.error) { if (win) win.close(); alert('Sorry, that document could not be opened.'); return; }
      if (win) win.location = r.data.signedUrl; else window.location = r.data.signedUrl;
    });
  }

  function ballotChoices(ev) {
    if (ev.ballot_kind === 'yes_no') return ['Yea', 'Nay'];
    if (ev.ballot_kind === 'yes_no_abstain') return ['Yea', 'Nay', 'Abstain'];
    return ev.ballot_options || [];
  }
  // 'upcoming' | 'open' | 'closed'
  function voteState(ev) {
    var now = Date.now();
    if (ev.vote_opens_at && now < new Date(ev.vote_opens_at).getTime()) return 'upcoming';
    if (ev.vote_closes_at && now >= new Date(ev.vote_closes_at).getTime()) return 'closed';
    return 'open';
  }
  function voteWindowText(ev) {
    var st = voteState(ev);
    var close = ev.vote_closes_at ? fmtDate(ev.vote_closes_at) + ' at ' + fmtTime(ev.vote_closes_at) : '';
    if (st === 'upcoming') return 'Voting opens ' + fmtDate(ev.vote_opens_at) + ' at ' + fmtTime(ev.vote_opens_at) + ' and closes ' + close;
    if (st === 'open') return 'Voting is open until ' + close;
    return 'Voting closed ' + close;
  }

  window.MemberData = {
    ballotChoices: ballotChoices, voteState: voteState, voteWindowText: voteWindowText,
    EVENT_TYPES: EVENT_TYPES, DOC_CATEGORIES: DOC_CATEGORIES,
    eventTypeLabel: function (id) { return label(EVENT_TYPES, id); },
    categoryLabel: function (id) { return label(DOC_CATEGORIES, id); },
    esc: esc, richText: richText, fmtWhen: fmtWhen, fmtDay: fmtDay, monthKey: monthKey,
    toLocalInput: toLocalInput, fromLocalInput: fromLocalInput, fileSize: fileSize,
    openDocument: openDocument
  };
})();
