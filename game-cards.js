/* Nautical playing cards (SVG) and poker hand ranking for the Poker Run.
   Cards are written as rank + suit: 2-9, T, J, Q, K, A + S, H, D, C (e.g. "TH" = 10 of hearts).
   Several decks are in play, so five of a kind is possible and ranks above a straight flush. */
(function () {
  var SUITS = { S: { sym: '\u2660', red: false, name: 'Spades' }, H: { sym: '\u2665', red: true, name: 'Hearts' },
                D: { sym: '\u2666', red: true, name: 'Diamonds' }, C: { sym: '\u2663', red: false, name: 'Clubs' } };
  var RANKS = '23456789TJQKA';
  var NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  var PLURAL = { 2: '2s', 3: '3s', 4: '4s', 5: '5s', 6: '6s', 7: '7s', 8: '8s', 9: '9s', 10: '10s', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
  var NAVY = '#0e2a4a', RED = '#b3261e', GOLD = '#c9a15a', CREAM = '#fbf6ea';

  function rankOf(c) { return RANKS.indexOf(c.charAt(0)) + 2; }
  function suitOf(c) { return c.charAt(1); }
  function rankText(c) { var r = c.charAt(0); return r === 'T' ? '10' : r; }
  function cardName(c) { return NAMES[rankOf(c)] + ' of ' + SUITS[suitOf(c)].name; }

  // Rope border: a thick line with short diagonal dashes over it.
  function rope(x, y, w, h, color) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="none" stroke="' + color + '" stroke-width="3.2"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="none" stroke="' + CREAM + '" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="2.2 2.6"/>';
  }

  // Center art for picture cards and aces.
  function anchor(color) {
    return '<g fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round">' +
      '<circle cx="50" cy="40" r="6"/><line x1="50" y1="46" x2="50" y2="100"/><line x1="36" y1="56" x2="64" y2="56"/>' +
      '<path d="M26 80 Q30 100 50 100 Q70 100 74 80"/><path d="M22 84 L26 78 L31 84"/><path d="M69 84 L74 78 L78 84"/></g>';
  }
  function wheel(color) {
    var s = '<g stroke="' + color + '" stroke-linecap="round" fill="none">';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, c = Math.cos(a), n = Math.sin(a);
      s += '<line x1="' + (50 + 7 * c).toFixed(1) + '" y1="' + (70 + 7 * n).toFixed(1) + '" x2="' + (50 + 31 * c).toFixed(1) + '" y2="' + (70 + 31 * n).toFixed(1) + '" stroke-width="3.2"/>' +
        '<circle cx="' + (50 + 31 * c).toFixed(1) + '" cy="' + (70 + 31 * n).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    }
    return s + '<circle cx="50" cy="70" r="22" stroke-width="4"/><circle cx="50" cy="70" r="6" stroke-width="3"/></g>';
  }
  function lighthouse(color) {
    return '<g stroke="' + color + '" stroke-width="2.6" stroke-linejoin="round">' +
      '<path d="M40 104 L44 54 L56 54 L60 104 Z" fill="' + CREAM + '"/>' +
      '<path d="M42.5 72 L57.5 72 L58.4 82 L41.6 82 Z M41 92 L59 92 L59.8 100 L40.2 100 Z" fill="' + color + '" stroke="none"/>' +
      '<rect x="42" y="42" width="16" height="12" fill="' + GOLD + '"/><path d="M40 42 L50 33 L60 42 Z" fill="' + color + '"/>' +
      '<line x1="36" y1="104" x2="64" y2="104"/></g>' +
      '<g stroke="' + GOLD + '" stroke-width="2" stroke-linecap="round"><line x1="30" y1="44" x2="20" y2="40"/><line x1="30" y1="50" x2="20" y2="54"/>' +
      '<line x1="70" y1="44" x2="80" y2="40"/><line x1="70" y1="50" x2="80" y2="54"/></g>';
  }
  function sailboat(color) {
    return '<g stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round">' +
      '<line x1="50" y1="32" x2="50" y2="92"/>' +
      '<path d="M53 36 L53 88 L76 88 Z" fill="' + CREAM + '"/><path d="M47 44 L47 88 L28 88 Z" fill="' + color + '"/>' +
      '<path d="M24 94 L76 94 L68 104 L32 104 Z" fill="' + color + '"/></g>' +
      '<path d="M18 110 Q26 106 34 110 T50 110 T66 110 T82 110" fill="none" stroke="' + GOLD + '" stroke-width="2.4" stroke-linecap="round"/>';
  }

  // Pip positions for number cards (on a 100 x 140 card).
  var PIPS = {
    2: [[50, 34], [50, 106, 1]], 3: [[50, 34], [50, 70], [50, 106, 1]],
    4: [[32, 34], [68, 34], [32, 106, 1], [68, 106, 1]],
    5: [[32, 34], [68, 34], [50, 70], [32, 106, 1], [68, 106, 1]],
    6: [[32, 34], [68, 34], [32, 70], [68, 70], [32, 106, 1], [68, 106, 1]],
    7: [[32, 34], [68, 34], [50, 52], [32, 70], [68, 70], [32, 106, 1], [68, 106, 1]],
    8: [[32, 34], [68, 34], [50, 52], [32, 70], [68, 70], [50, 88, 1], [32, 106, 1], [68, 106, 1]],
    9: [[32, 32], [68, 32], [32, 56], [68, 56], [50, 70], [32, 84, 1], [68, 84, 1], [32, 108, 1], [68, 108, 1]],
    10: [[32, 32], [68, 32], [50, 46], [32, 58], [68, 58], [32, 82, 1], [68, 82, 1], [50, 94, 1], [32, 108, 1], [68, 108, 1]]
  };

  function face(c) {
    var r = rankOf(c), s = SUITS[suitOf(c)], col = s.red ? RED : NAVY, rt = rankText(c), body = '';
    if (r <= 10) {
      PIPS[r].forEach(function (p) {
        body += '<text x="' + p[0] + '" y="' + (p[1] + 7) + '" font-size="20" text-anchor="middle" fill="' + col + '"' +
          (p[2] ? ' transform="rotate(180 ' + p[0] + ' ' + p[1] + ')"' : '') + '>' + s.sym + '</text>';
      });
    } else {
      var art = r === 14 ? anchor(col) : r === 13 ? wheel(col) : r === 12 ? lighthouse(col) : sailboat(col);
      body = '<rect x="23" y="20" width="54" height="96" rx="5" fill="' + (s.red ? '#fbeceb' : '#e9eff6') + '" stroke="' + GOLD + '" stroke-width="1.2"/>' +
        '<g transform="translate(50 68) scale(.74) translate(-50 -70)">' + art + '</g>' +
        '<text x="50" y="127" font-size="6.6" text-anchor="middle" fill="' + col + '" font-weight="700" letter-spacing=".6">' +
        (r === 14 ? 'ANCHOR' : r === 13 ? 'CAPTAIN' : r === 12 ? 'LIGHTHOUSE' : 'DECKHAND') + '</text>';
    }
    var corner = '<text x="15" y="23" font-size="' + (rt === '10' ? 12 : 14) + '" font-weight="700" text-anchor="middle" fill="' + col + '" font-family="Georgia,serif">' + rt + '</text>' +
      '<text x="15" y="35" font-size="11" text-anchor="middle" fill="' + col + '">' + s.sym + '</text>';
    return '<svg class="pcard" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + cardName(c) + '">' +
      '<rect x="1" y="1" width="98" height="138" rx="9" fill="' + CREAM + '" stroke="#cdbf9f" stroke-width="1"/>' +
      rope(5, 5, 90, 130, NAVY) + body + corner +
      '<g transform="rotate(180 50 70)">' + corner + '</g></svg>';
  }

  function back() {
    var s = '<svg class="pcard" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Face-down card">' +
      '<defs><pattern id="pcw" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 5 Q3 2 6 5 T12 5" fill="none" stroke="#1c4a73" stroke-width="1.2"/></pattern></defs>' +
      '<rect x="1" y="1" width="98" height="138" rx="9" fill="' + NAVY + '"/><rect x="8" y="8" width="84" height="124" rx="6" fill="url(#pcw)"/>' +
      rope(5, 5, 90, 130, GOLD) + '<g transform="translate(0 0)">';
    // Compass rose
    s += '<circle cx="50" cy="70" r="24" fill="' + NAVY + '" stroke="' + GOLD + '" stroke-width="1.6"/>';
    [0, 90, 180, 270].forEach(function (a) {
      s += '<path d="M50 46 L55 70 L50 70 Z" fill="' + GOLD + '" transform="rotate(' + a + ' 50 70)"/><path d="M50 46 L45 70 L50 70 Z" fill="#e8d3a6" transform="rotate(' + a + ' 50 70)"/>';
    });
    [45, 135, 225, 315].forEach(function (a) {
      s += '<path d="M50 54 L53 70 L47 70 Z" fill="#e8d3a6" transform="rotate(' + a + ' 50 70)"/>';
    });
    s += '<circle cx="50" cy="70" r="3" fill="' + CREAM + '"/><text x="50" y="40" font-size="8" text-anchor="middle" fill="' + GOLD + '" font-weight="700">N</text></g></svg>';
    return s;
  }

  // ---------- Hand ranking ----------
  var CATS = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Five of a Kind'];

  function evaluate(cards) {
    var ranks = cards.map(rankOf), counts = {};
    ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    // Ranks grouped by how many of each, then by rank: e.g. full house 7-7-7-3-3 -> [7, 3].
    var groups = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a] || b - a; });
    var shape = groups.map(function (r) { return counts[r]; });
    if (cards.length < 5) {
      var cat0 = shape[0] >= 4 ? 7 : shape[0] === 3 ? (shape[1] === 2 ? 6 : 3) : shape[0] === 2 ? (shape[1] === 2 ? 2 : 1) : 0;
      return { cat: cat0, tie: groups, name: cards.length ? describe(cat0, groups) : '' };
    }
    var flush = cards.every(function (c) { return suitOf(c) === suitOf(cards[0]); });
    var straightHigh = 0;
    if (groups.length === 5) {
      var srt = groups.slice().sort(function (a, b) { return b - a; });
      if (srt[0] - srt[4] === 4) straightHigh = srt[0];
      else if (srt.join() === '14,5,4,3,2') straightHigh = 5;
    }
    var cat, tie;
    if (shape[0] === 5) { cat = 9; tie = groups; }
    else if (straightHigh && flush) { cat = 8; tie = [straightHigh]; }
    else if (shape[0] === 4) { cat = 7; tie = groups; }
    else if (shape[0] === 3 && shape[1] === 2) { cat = 6; tie = groups; }
    else if (flush) { cat = 5; tie = ranks.slice().sort(function (a, b) { return b - a; }); }
    else if (straightHigh) { cat = 4; tie = [straightHigh]; }
    else if (shape[0] === 3) { cat = 3; tie = groups; }
    else if (shape[0] === 2 && shape[1] === 2) { cat = 2; tie = groups; }
    else if (shape[0] === 2) { cat = 1; tie = groups; }
    else { cat = 0; tie = groups; }
    return { cat: cat, tie: tie, name: describe(cat, tie) };
  }

  function describe(cat, t) {
    switch (cat) {
      case 9: return 'Five of a Kind, ' + PLURAL[t[0]];
      case 8: return t[0] === 14 ? 'Royal Flush' : 'Straight Flush, ' + NAMES[t[0]] + ' high';
      case 7: return 'Four ' + PLURAL[t[0]];
      case 6: return 'Full House, ' + PLURAL[t[0]] + ' over ' + PLURAL[t[1]];
      case 5: return 'Flush, ' + NAMES[t[0]] + ' high';
      case 4: return 'Straight, ' + NAMES[t[0]] + ' high';
      case 3: return 'Three ' + PLURAL[t[0]];
      case 2: return 'Two Pair, ' + PLURAL[t[0]] + ' and ' + PLURAL[t[1]];
      case 1: return 'Pair of ' + PLURAL[t[0]];
      default: return NAMES[t[0]] + ' high';
    }
  }

  // Negative when hand a beats hand b.
  function compare(a, b) {
    if (a.cat !== b.cat) return b.cat - a.cat;
    for (var i = 0; i < Math.max(a.tie.length, b.tie.length); i++) {
      var d = (b.tie[i] || 0) - (a.tie[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  window.PokerCards = { face: face, back: back, evaluate: evaluate, compare: compare, cardName: cardName,
    rankOf: rankOf, CATEGORIES: CATS };
})();
