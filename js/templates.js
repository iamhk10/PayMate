/* =========================================================================
   PayMate — js/templates.js
   Bill templates + sticker packs + the function that turns a bill into HTML.

   One shared HTML structure is rendered for every template; css/bill.css then
   gives each one its own colours, fonts, stickers and decorations.
   Only CSS that html2canvas can paint is used, so the PDF/JPG matches the preview.
   ========================================================================= */
(function (PM) {
  'use strict';

  var B = PM.bill, esc = B.esc;
  var T = PM.templates = {};

  /* ------------------------------------------------------------ sticker packs */
  // 10 icons each: [0,1] hero cluster · [2,3,4] edge stickers · [5,6,7] footer row · [8,9] spare
  var PACKS = {
    campus:  { name: 'Campus',  icon: '🎓', icons: ['🎓', '✏️', '📎', '📚', '🎒', '📝', '☕', '🧮', '🏫', '🔬'] },
    market:  { name: 'Market',  icon: '🛒', icons: ['🛒', '🍅', '🥬', '🍎', '🥕', '🥭', '🧅', '🌽', '🍋', '🥦'] },
    trip:    { name: 'Trip',    icon: '✈️', icons: ['✈️', '🧳', '🗺️', '🏝️', '📸', '🧭', '⛺', '🚆', '🏔️', '🌅'] },
    cafe:    { name: 'Café',    icon: '☕', icons: ['☕', '🥐', '🍰', '🧁', '🍩', '🫖', '🍪', '🥞', '🍯', '🥛'] },
    party:   { name: 'Party',   icon: '🎉', icons: ['🎉', '🥳', '🎈', '🍕', '🎂', '🎊', '🪩', '🎁', '🥂', '🎤'] },
    chai:    { name: 'Chai',    icon: '🫖', icons: ['🫖', '☕', '🍪', '🥟', '🛵', '🌶️', '🧆', '🍞', '🌾', '✨'] },
    night:   { name: 'Night',   icon: '🌙', icons: ['🌙', '⭐', '🎧', '🕹️', '🛸', '🔮', '🍜', '⚡', '💿', '🌌'] },
    minimal: { name: 'Minimal', icon: '◆',  icons: ['●', '■', '▲', '◆', '✚', '✱', '○', '♥', '✦', '❖'] }
  };
  T.packs = PACKS;
  T.packList = Object.keys(PACKS).map(function (id) { return { id: id, name: PACKS[id].name, icon: PACKS[id].icon }; });

  /* --------------------------------------------------------------- templates */
  // The first six are the required ones; Chai Tapri and Neon Night are bonus looks.
  var LIST = [
    { id: 'campus',  name: 'Campus Classic', tag: 'Notebook-page vibes',      emoji: '🎓', pack: 'campus',  kicker: 'EXPENSE BILL',      stamp: 'ALL SETTLED ✓', hello: 'Class dismissed!',     bg: '#fffefa', sw: ['#4f46e5', '#eef0ff'] },
    { id: 'market',  name: 'Market Mate',    tag: 'Fresh from the kirana',    emoji: '🛒', pack: 'market',  kicker: 'SHOPPING BILL',     stamp: 'PAID ✓',        hello: 'Thank you, visit again!', bg: '#fffcf0', sw: ['#16a34a', '#fff8e1'] },
    { id: 'trip',    name: 'Trip Mode',      tag: 'Boarding-pass style',      emoji: '✈️', pack: 'trip',    kicker: 'TRAVEL EXPENSE PASS', stamp: 'ARRIVED ✓',   hello: 'Bon voyage!',          bg: '#f3f9ff', sw: ['#1d6fd1', '#ff8a1f'] },
    { id: 'cafe',    name: 'Café Chill',     tag: 'Cozy menu-card feel',      emoji: '☕', pack: 'cafe',    kicker: 'TODAY\'S TAB',      stamp: 'ENJOYED ✓',     hello: 'See you again soon!',  bg: '#fbf3e4', sw: ['#8b5a2b', '#fbf1df'] },
    { id: 'party',   name: 'Party Pop',      tag: 'Loud, bright & fun',       emoji: '🎉', pack: 'party',   kicker: 'PARTY BILL',        stamp: 'PARTY ON ✓',    hello: 'That was epic!',       bg: '#fff6fc', sw: ['#e11d8f', '#7c3aed'] },
    { id: 'minimal', name: 'Minimal Pro',    tag: 'Black, white, no noise',   emoji: '◼️', pack: 'minimal', kicker: 'EXPENSE SUMMARY',   stamp: 'SETTLED',       hello: 'Clean books.',         bg: '#ffffff', sw: ['#111111', '#ffffff'] },
    { id: 'chai',    name: 'Chai Tapri',     tag: 'Desi tea-stall charm',     emoji: '🫖', pack: 'chai',    kicker: 'TAPRI HISAAB',      stamp: 'CHAI DONE ✓',   hello: 'Ek cutting aur?',      bg: '#f8e7c6', sw: ['#d9730d', '#f7e4c0'] },
    { id: 'night',   name: 'Neon Night',     tag: 'Dark mode, glowing',       emoji: '🌙', pack: 'night',   kicker: 'NIGHT OUT BILL',    stamp: 'ALL CLEAR ✓',   hello: 'Good night, all!',     bg: '#1d1148', sw: ['#22d3ee', '#0e1230'] }
  ];
  var BY = {}; LIST.forEach(function (t) { BY[t.id] = t; });
  T.list = LIST;
  T.get = function (id) { return BY[id] || BY.campus; };
  T.has = function (id) { return !!BY[id]; };

  /* ---------------------------------------------------------- small builders */
  function rot(arr, n) { n = ((n % arr.length) + arr.length) % arr.length; return arr.slice(n).concat(arr.slice(0, n)); }

  // one sticker: <span class="stk e1" style="--r:-8deg"><i>🎓</i></span>
  function stk(sym, cls, r, s) {
    return '<span class="stk ' + cls + '" style="--r:' + r + 'deg;--s:' + (s || 1) + '"><i>' + sym + '</i></span>';
  }
  function avatar(p, small) {
    var pal = B.PALETTE[p.c % B.PALETTE.length];
    return '<i class="pp-av' + (small ? ' sm' : '') + '" style="--avbg:' + pal[0] + ';--avink:' + pal[1] + '"><b class="av-e">' + esc(p.emoji) + '</b><b class="av-i">' + esc(B.initial(p.name)) + '</b></i>';
  }
  function name(calc, id) { return calc.byId[id] ? calc.byId[id].name : '?'; }

  // Per-template extras injected into the top band / the background layer.
  function bunting() {
    var cols = ['#ff3d9a', '#7c3aed', '#ffc233', '#19c2a0', '#3b82f6'], h = '';
    for (var i = 0; i < 20; i++) h += '<i style="border-top-color:' + cols[i % cols.length] + '"></i>';
    return '<div class="bunting">' + h + '</div>';
  }
  var DECOR = {
    campus:  { top: '', bg: '<i class="hole" style="top:150px"></i><i class="hole" style="top:540px"></i><i class="hole" style="top:930px"></i>' },
    market:  { top: '<div class="awn">' + new Array(14).join('<i></i>') + '</div>', bg: '' },
    trip:    { top: '<div class="trip-bar"><span>FROM</span><b>FRIENDS</b><em>✈</em><span>TO</span><b>ALL SETTLED</b></div>', bg: '', hero: '<i class="notch n1"></i><i class="notch n2"></i>' },
    cafe:    { top: '<div class="gingham"></div><i class="tape t1"></i><i class="tape t2"></i>', bg: '<i class="ring"></i>' },
    party:   { top: bunting(), bg: '<i class="blob b1"></i><i class="blob b2"></i>' },
    minimal: { top: '', bg: '' },
    chai:    { top: '<div class="flags">' + new Array(14).join('<i></i>') + '</div>', bg: '' },
    night:   { top: '', bg: '' },
  };

  /* -------------------------------------------------------------- the bill */
  /**
   * Returns the HTML string of one bill ("paper").
   *   st   normalised bill state       calc  result of PayMate.bill.compute(st)
   *   opts { fit: true|false } -> force the compact one-page layout on/off
   */
  T.render = function (st, calc, opts) {
    opts = opts || {};
    var tpl = T.get(st.template), style = st.style || {};
    var packId = style.pack && style.pack !== 'auto' && PACKS[style.pack] ? style.pack : tpl.pack;
    var P = rot(PACKS[packId].icons, style.seed || 0);
    var on = style.stk !== 0;
    var d = DECOR[tpl.id] || DECOR.campus;
    var title = st.title || '';
    var tcls = title.length > 44 ? ' t-xl' : title.length > 26 ? ' t-long' : '';

    var fit = opts.fit != null ? !!opts.fit : style.fit === 1;       // 'auto' (2) is decided by the app after measuring
    var h = '<article class="paper tpl-' + tpl.id + (fit ? ' pp-fit' : '') + (style.cat === 0 ? ' pp-nocat' : '') + (on ? '' : ' pp-nostk') + '" data-tpl="' + tpl.id + '" data-pack="' + packId + '">';
    h += '<div class="pp-bg">' + d.bg + '</div>';
    if (on) {
      h += '<div class="pp-stk-layer">' + stk(P[2], 'e1', -10) + stk(P[3], 'e2', 9) + stk(P[4], 'e3', -7) + '</div>';
    }

    /* ---- top band: brand + template name */
    h += '<header class="pp-top">' + d.top +
      '<div class="pp-head"><div class="pp-brand"><b class="pp-logo">₹</b><span class="pp-bn">PayMate</span></div>' +
      '<div class="pp-tn"><i>' + tpl.emoji + '</i><span>' + esc(tpl.name) + '</span></div></div></header>';

    h += '<div class="pp-in">';

    /* ---- hero: title, date, sticker cluster */
    h += '<section class="pp-hero"><div class="pp-hero-main"><div class="pp-kicker">' + esc(tpl.kicker) + '</div>' +
      '<h1 class="pp-title' + tcls + (title ? '' : ' is-empty') + '">' + esc(title || 'Untitled bill') + '</h1>' +
      '<div class="pp-date"><i>📅</i><span>' + esc(B.fmtDate(st.date, true)) + '</span></div></div>' +
      (on ? '<div class="pp-cluster">' + stk(P[0], 'c1', -9, 1.12) + stk(P[1], 'c2', 8, 0.94) + '</div>' : '') +
      (d.hero || '') + '</section>';

    /* ---- friends */
    h += '<section class="pp-sec pp-people"><h2 class="pp-h"><span>Friends</span><em>' + calc.n + '</em></h2><ul class="pp-chips">';
    if (!calc.n) h += '<li class="pp-empty">No friends added yet</li>';
    calc.people.forEach(function (p) { h += '<li class="pp-chip">' + avatar(p) + '<span>' + esc(p.name) + '</span></li>'; });
    h += '</ul></section>';

    /* ---- expenses table */
    h += '<section class="pp-sec pp-items"><h2 class="pp-h"><span>Expenses</span><em>' + calc.lines.length + '</em></h2>' +
      '<table class="pp-table"><thead><tr><th class="c-item">Item</th><th class="c-qty">Qty</th><th class="c-amt">Amount</th><th class="c-by">Paid by</th></tr></thead><tbody>';
    if (!calc.lines.length) h += '<tr class="pp-none"><td colspan="4">No expenses added yet</td></tr>';
    calc.lines.forEach(function (l) {
      var split = l.all ? '' : '<small>split: ' + esc(l.with.map(function (id) { return B.firstName(name(calc, id)); }).join(', ')) + '</small>';
      var rate = l.qty !== 1 ? '<em class="x">× ' + B.inr(l.unit) + '</em>' : '';
      h += '<tr><td class="c-item"><div class="pp-cell"><i class="pp-cat">' + esc(l.cat) + '</i><span class="pp-in-name"><b>' + esc(l.name) + '</b>' + split + '</span></div></td>' +
        '<td class="c-qty"><span>' + B.fmtQty(l.qty) + '</span>' + rate + '</td>' +
        '<td class="c-amt"><b>' + B.inr(l.total) + '</b></td>' +
        '<td class="c-by">' + esc(B.firstName(name(calc, l.paidBy))) + '</td></tr>';
    });
    h += '</tbody></table></section>';

    /* ---- totals strip */
    h += '<section class="pp-totals"><div class="pp-tot big"><span>Total spent</span><b>' + B.inr(calc.total) + '</b></div>' +
      '<div class="pp-tot"><span>Friends</span><b>' + calc.n + '</b></div>' +
      '<div class="pp-tot"><span>Average each</span><b>' + B.inr(calc.avg) + '</b></div></section>';

    /* ---- per-person summary */
    h += '<section class="pp-sec pp-shares"><h2 class="pp-h"><span>Per-person summary</span></h2><table class="pp-table pp-table-s"><thead><tr>' +
      '<th class="c-item">Person</th><th class="c-num">Paid</th><th class="c-num">Share</th><th class="c-bal">Balance</th></tr></thead><tbody>';
    calc.people.forEach(function (p) {
      var bal = p.balance > 0 ? '<span class="pp-bal pos">gets ' + B.inr(p.balance) + '</span>' : p.balance < 0 ? '<span class="pp-bal neg">owes ' + B.inr(-p.balance) + '</span>' : '<span class="pp-bal even">even</span>';
      h += '<tr><td class="c-item"><div class="pp-cell">' + avatar(p, true) + '<span class="pp-in-name"><b>' + esc(p.name) + '</b></span></div></td><td class="c-num">' + B.inr(p.paid) + '</td><td class="c-num">' + B.inr(p.share) + '</td><td class="c-bal">' + bal + '</td></tr>';
    });
    h += '</tbody></table></section>';

    /* ---- settlement summary */
    h += '<section class="pp-sec pp-settle"><h2 class="pp-h"><span>Settlement summary</span></h2>';
    if (calc.allDone) h += '<div class="pp-stamp">' + esc(tpl.stamp) + '</div>';
    if (!calc.settlements.length) {
      h += '<div class="pp-even">' + (calc.total ? 'Everyone is even — nobody owes anything 🎉' : 'Add expenses to see who pays whom') + '</div>';
    } else {
      h += '<ul class="pp-sts">';
      calc.settlements.forEach(function (s) {
        var a = calc.byId[s.from], b = calc.byId[s.to];
        h += '<li class="pp-st' + (s.done ? ' is-done' : '') + '"><span class="pp-who">' + avatar(a, true) + '<b>' + esc(a.name) + '</b></span>' +
          '<span class="pp-pay"><em>pays</em><u></u><i>➜</i></span>' +
          '<span class="pp-who">' + avatar(b, true) + '<b>' + esc(b.name) + '</b></span>' +
          '<span class="pp-amt">' + B.inr(s.amount) + '</span>' + (s.done ? '<span class="pp-ok">✓ paid</span>' : '') + '</li>';
      });
      h += '</ul>';
      if (calc.rounded) h += '<div class="pp-rnote">Amounts rounded to whole ₹</div>';
    }
    h += '</section>';

    /* ---- handwritten note (user's own, or the template's friendly line) */
    var note = st.note || tpl.hello;
    h += '<div class="pp-note"><span>' + esc(note) + '</span></div>';

    /* ---- footer */
    h += '<footer class="pp-foot">' +
      (on ? '<div class="pp-foot-stk">' + stk(P[5], 'f1', -8) + stk(P[6], 'f2', 6) + stk(P[7], 'f3', -5) + '</div>' : '') +
      '<div class="pp-foot-txt">Made with PayMate <i>•</i> Split smart. Settle easy.</div></footer>';

    h += '</div></article>';
    return h;
  };

  /* A small, fixed demo bill used for the template picker thumbnails. */
  T.demo = function () {
    var st = B.blank();
    st.title = 'Weekend Plan';
    ['Rahul', 'Aman', 'Priya'].forEach(function (n, i) { st.friends.push(B.newFriend(n, i)); });
    var f = st.friends;
    [['Chai & snacks', 60, 3, 0], ['Cab ride', 240, 1, 1], ['Dinner', 780, 1, 2], ['Movie tickets', 200, 3, 0]].forEach(function (r) {
      st.expenses.push({ id: B.uid('e'), name: r[0], amount: r[1], qty: r[2], paidBy: f[r[3]].id, all: true, with: [], cat: B.guessCat(r[0]) });
    });
    return st;
  };
})(window.PayMate = window.PayMate || {});
