/* =========================================================================
   PayMate — js/bill.js
   The bill data model and ALL the money maths. No DOM code in here, so it
   can be unit-tested in Node.

   Money rule: every calculation is done in whole PAISE (integers), so splits
   never drift by a rupee. The state stores rupees (friendly to read/edit);
   we convert with Math.round(rupees * 100).

   State shape (what gets saved):
   {
     v: 1, id, title, date: 'YYYY-MM-DD', template: 'campus', note,
     friends:  [{ id, name, emoji, c (colour index), upi }],
     expenses: [{ id, name, amount (₹ per item), qty, paidBy (friend id),
                  all (true = split between everyone), with: [friend ids], cat (emoji) }],
     settled:  { 'fromId>toId:paise': true },
     style:    { stk: 1|0 (stickers), pack: 'auto'|packId, cat: 1|0 (category emoji), seed: 0-99 (sticker shuffle), fit: 2 auto / 1 always / 0 never compact layout, round: 1|0 (settle in whole rupees) }
   }
   ========================================================================= */
(function (PM) {
  'use strict';

  var B = PM.bill = {};

  /* ---------------------------------------------------------------- limits */
  var LIM = { friends: 30, expenses: 300, title: 60, name: 24, item: 48, note: 140, upi: 60, amount: 10000000, qty: 9999 };
  B.LIMITS = LIM;

  /* ------------------------------------------------------------- appearance */
  // Friend avatars: pastel background + dark ink pairs, and a friendly emoji set (all widely supported).
  B.PALETTE = [
    ['#e0e7ff', '#4338ca'], ['#ccfbf1', '#0f766e'], ['#fef3c7', '#b45309'], ['#fce7f3', '#be185d'],
    ['#dcfce7', '#15803d'], ['#e0f2fe', '#0369a1'], ['#ede9fe', '#6d28d9'], ['#ffedd5', '#c2410c']
  ];
  B.AVATARS = ['😎', '🤓', '😄', '🥳', '😺', '🦊', '🐼', '🐯', '🦄', '🐸', '🤠', '👻', '🦁', '🐧', '🍀', '🌟', '🔥', '🎧', '⚡', '🍉'];

  /* ------------------------------------------------------------------ utils */
  var seq = 0;
  B.uid = function (p) {
    seq = (seq + 1) % 46656;
    return (p || 'x') + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3) + seq.toString(36);
  };

  function clean(s, max) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max).trim() : s;
  }
  function num(v, def) {
    if (typeof v === 'string') v = v.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
    v = parseFloat(v);
    return isFinite(v) ? v : def;
  }
  B.toPaise = function (rupees) { return Math.round(Math.max(0, num(rupees, 0)) * 100 + 1e-9); };
  B.cleanText = clean;

  /** Rupees (maybe a string like "1,200.50") -> number rounded to 2 decimals, clamped. */
  B.cleanAmount = function (v) {
    v = num(v, 0);
    if (v < 0) v = 0;
    if (v > LIM.amount) v = LIM.amount;
    return Math.round(v * 100) / 100;
  };
  /** Quantity -> number > 0 (max 3 decimals, e.g. 0.5 kg). */
  B.cleanQty = function (v) {
    v = num(v, 1);
    if (!(v > 0)) v = 1;
    if (v > LIM.qty) v = LIM.qty;
    return Math.round(v * 1000) / 1000;
  };

  /** One expense line total in paise: unit price x quantity, rounded to the nearest paisa. */
  B.lineTotal = function (e) { return Math.round(B.toPaise(e.amount) * B.cleanQty(e.qty)); };

  /* ---------------------------------------------------------------- dates */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  B.today = function () { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  B.validDate = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
    return y >= 1970 && y < 2200 && dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  };
  /** '2026-10-19' -> '19 Oct 2026' (no timezone surprises: parsed by hand). */
  B.fmtDate = function (iso, withDay) {
    if (!B.validDate(iso)) return '';
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    var s = d + ' ' + MON[m - 1] + ' ' + y;
    return withDay ? DAY[new Date(y, m - 1, d).getDay()] + ', ' + s : s;
  };
  B.fmtDateLong = function (iso) {
    if (!B.validDate(iso)) return '';
    return (+iso.slice(8, 10)) + ' ' + MONL[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);
  };

  /* --------------------------------------------------------- money display */
  // Indian digit grouping: 12,34,567
  function groupIN(s) {
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  }
  /** paise -> '1,234.50' (decimals only when needed). */
  B.num = function (paise) {
    var neg = paise < 0; paise = Math.abs(Math.round(paise));
    var r = Math.floor(paise / 100), p = paise % 100;
    return (neg ? '-' : '') + groupIN(String(r)) + (p ? '.' + p2(p) : '');
  };
  /** paise -> '₹1,234.50' ; negative values become '-₹250'. */
  B.inr = function (paise) { return (paise < 0 ? '-' : '') + '₹' + B.num(Math.abs(paise)); };
  /** Quantity for display: 2 -> '2', 0.5 -> '0.5'. */
  B.fmtQty = function (q) { return String(Math.round(q * 1000) / 1000); };

  /* ------------------------------------------------------------ categories */
  // Picks a little emoji for an item from its name (the user can still change it).
  var CATS = [
    [/\b(chai|tea|cutting)\b/i, '🫖'], [/\b(coffee|cafe|café|latte|cappuccino|espresso)\b/i, '☕'],
    [/\b(pizza)\b/i, '🍕'], [/\b(burger|sandwich|sub)\b/i, '🍔'], [/\b(momo|momos|dumpling|samosa|kachori)\b/i, '🥟'],
    [/\b(maggi|noodle|noodles|pasta|chowmein|chow mein|ramen)\b/i, '🍜'],
    [/\b(biryani|rice|thali|lunch|dinner|meal|mess|dal|roti|paratha|dosa|idli)\b/i, '🍛'],
    [/\b(breakfast|poha|upma|egg|eggs|omelette|bread)\b/i, '🍳'],
    [/\b(ice ?cream|kulfi|gelato|dessert|sweet|sweets|mithai)\b/i, '🍦'], [/\b(cake|bday|birthday)\b/i, '🎂'],
    [/\b(juice|shake|cold ?drink|cola|soda|drink|drinks|lassi|water|bottle|pepsi|coke|sprite)\b/i, '🥤'],
    [/\b(snack|snacks|chips|namkeen|popcorn|biscuit|biscuits|kurkure|chocolate)\b/i, '🍿'],
    [/\b(fruit|fruits|apple|banana|mango|grapes|orange)\b/i, '🍎'],
    [/\b(veg|veggies|vegetable|vegetables|sabzi|grocery|groceries|kirana|milk|atta|oil|ration|mart)\b/i, '🛒'],
    [/\b(petrol|diesel|fuel|cng)\b/i, '⛽'], [/\b(cab|uber|ola|rapido|auto|rickshaw|taxi)\b/i, '🚕'],
    [/\b(movie|movies|cinema|film|netflix|show|pvr|inox)\b/i, '🎬'],
    [/\b(bus|train|metro|flight|bike|ride)\b/i, '🚌'],
    [/\b(toll|parking|fastag)\b/i, '🅿️'],
    [/\b(hotel|room|stay|hostel|rent|airbnb|resort|camp|tent)\b/i, '🏨'],
    [/\b(game|games|gaming|bowling|arcade|turf|cricket)\b/i, '🎮'],
    [/\b(print|printing|xerox|photocopy|notes|book|books|stationery|pen|copy|assignment|project)\b/i, '📚'],
    [/\b(recharge|wifi|wi-fi|data|internet|sim)\b/i, '📶'], [/\b(medicine|medical|doctor|pharmacy|tablet)\b/i, '💊'],
    [/\b(gift|present|flowers|flower)\b/i, '🎁'], [/\b(party|decor|decoration|balloon|balloons|dj)\b/i, '🎉'],
    [/\b(laundry|wash|washing|dhobi)\b/i, '🧺'], [/\b(electric|electricity|light|bijli)\b/i, '💡'],
    [/\b(gas|cylinder|lpg)\b/i, '🔥'], [/\b(tip|donation|charity)\b/i, '🪙'], [/\b(haircut|salon|barber)\b/i, '💈'],
    [/\b(shopping|clothes|shirt|tshirt|t-shirt|shoes|bag)\b/i, '🛍️'], [/\b(entry|pass|fee|fees|admission|ticket|tickets)\b/i, '🎟️']
  ];
  B.guessCat = function (name) {
    name = String(name || '');
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0].test(name)) return CATS[i][1];
    return '🧾';
  };

  /* -------------------------------------------------------------- creation */
  B.newFriend = function (name, idx) {
    return { id: B.uid('f'), name: clean(name, LIM.name), emoji: B.AVATARS[(idx || 0) % B.AVATARS.length], c: (idx || 0) % B.PALETTE.length, upi: '' };
  };
  B.blank = function () {
    return { v: 1, id: B.uid('b'), title: '', date: B.today(), template: 'campus', note: '', friends: [], expenses: [], settled: {}, style: { stk: 1, pack: 'auto', cat: 1, seed: 0, fit: 2, round: 0 } };
  };

  /** A ready-made sample bill so first-time visitors immediately see how everything works. */
  B.sample = function () {
    var st = B.blank();
    st.title = 'Canteen + Movie Day';
    st.note = 'Pay up before the next canteen run! 😄';
    ['Rahul', 'Aman', 'Priya', 'Sneha'].forEach(function (n, i) { st.friends.push(B.newFriend(n, i)); });
    var f = st.friends;
    function add(name, amount, qty, who, withIds) {
      st.expenses.push({ id: B.uid('e'), name: name, amount: amount, qty: qty, paidBy: f[who].id, all: !withIds, with: withIds ? withIds.map(function (i) { return f[i].id; }) : [], cat: B.guessCat(name) });
    }
    add('Chai', 15, 4, 1);
    add('Samosa', 20, 8, 0);
    add('Pizza', 450, 1, 2);
    add('Cold drinks', 40, 4, 3);
    add('Movie tickets', 250, 3, 0, [0, 1, 2]);
    add('Auto fare', 120, 1, 1);
    return st;
  };

  /* --------------------------------------------------------- normalisation */
  /**
   * Turns ANY input (saved draft, imported file, share link, half-typed form) into a clean, safe state.
   * Unknown fields are dropped, text is trimmed/limited, ids are made unique, broken links are repaired.
   * `validTemplate(id)` is optional: pass it to reset unknown template ids.
   */
  B.normalize = function (raw, validTemplate) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var st = B.blank();
    st.id = clean(raw.id, 40) || st.id;
    st.title = clean(raw.title, LIM.title);
    st.date = B.validDate(raw.date) ? raw.date : B.today();
    st.template = typeof raw.template === 'string' && (!validTemplate || validTemplate(raw.template)) ? raw.template : 'campus';
    st.note = clean(raw.note, LIM.note);
    var rs = raw.style && typeof raw.style === 'object' ? raw.style : {};
    st.style = {
      stk: rs.stk === 0 || rs.stk === false ? 0 : 1,
      pack: clean(rs.pack, 20) || 'auto',
      cat: rs.cat === 0 || rs.cat === false ? 0 : 1,
      seed: Math.max(0, Math.min(99, Math.floor(num(rs.seed, 0)))),
      fit: rs.fit === 1 || rs.fit === true ? 1 : (rs.fit === 0 || rs.fit === false ? 0 : 2),
      round: rs.round === 1 || rs.round === true ? 1 : 0
    };

    var seen = {};
    (Array.isArray(raw.friends) ? raw.friends : []).slice(0, LIM.friends).forEach(function (f, i) {
      if (!f || typeof f !== 'object') return;
      var name = clean(f.name, LIM.name);
      if (!name) return;
      var id = clean(f.id, 40);
      if (!id || seen[id]) id = B.uid('f');
      seen[id] = 1;
      var emoji = typeof f.emoji === 'string' && f.emoji && f.emoji.length <= 8 ? f.emoji : B.AVATARS[i % B.AVATARS.length];
      var c = typeof f.c === 'number' && f.c >= 0 && f.c < B.PALETTE.length ? Math.floor(f.c) : i % B.PALETTE.length;
      st.friends.push({ id: id, name: name, emoji: emoji, c: c, upi: clean(f.upi, LIM.upi) });
    });

    var fids = {}; st.friends.forEach(function (f) { fids[f.id] = 1; });
    var eseen = {};
    if (st.friends.length) {
      (Array.isArray(raw.expenses) ? raw.expenses : []).slice(0, LIM.expenses).forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        var name = clean(e.name, LIM.item) || 'Item';
        var id = clean(e.id, 40);
        if (!id || eseen[id]) id = B.uid('e');
        eseen[id] = 1;
        var paidBy = fids[e.paidBy] ? e.paidBy : st.friends[0].id;           // repair a missing payer
        var withIds = (Array.isArray(e.with) ? e.with : []).filter(function (x, i, a) { return fids[x] && a.indexOf(x) === i; });
        var all = e.all === false && withIds.length > 0 ? false : true;        // empty custom split => everyone
        var cat = typeof e.cat === 'string' && e.cat && e.cat.length <= 8 ? e.cat : B.guessCat(name);
        st.expenses.push({ id: id, name: name, amount: B.cleanAmount(e.amount), qty: B.cleanQty(e.qty), paidBy: paidBy, all: all, with: all ? [] : withIds, cat: cat });
      });
    }
    // keep only "settled" marks that look valid (they are re-checked against live settlements anyway)
    if (raw.settled && typeof raw.settled === 'object') {
      Object.keys(raw.settled).slice(0, 200).forEach(function (k) { if (/^[^>]+>[^:]+:\d+$/.test(k) && raw.settled[k]) st.settled[k] = true; });
    }
    return st;
  };

  /* ------------------------------------------------------------- the maths */
  function participants(e, friends) {
    var idx = [], i;
    if (!e.all && e.with && e.with.length) {
      for (i = 0; i < friends.length; i++) if (e.with.indexOf(friends[i].id) !== -1) idx.push(i);
    }
    if (!idx.length) for (i = 0; i < friends.length; i++) idx.push(i);
    return idx;
  }

  /**
   * Settlement: who pays whom, using the fewest transfers we can find.
   * 1) match debtors and creditors with identical amounts first, 2) then greedily pair the
   *    biggest debtor with the biggest creditor. Never more than (people - 1) transfers.
   */
  function settle(people) {
    var debt = [], cred = [], out = [], d, c;
    people.forEach(function (p, i) {
      if (p.balance < 0) debt.push({ id: p.id, amt: -p.balance, o: i });
      else if (p.balance > 0) cred.push({ id: p.id, amt: p.balance, o: i });
    });
    function push(from, to, amt) { out.push({ from: from, to: to, amount: amt, key: from + '>' + to + ':' + amt }); }
    for (d = 0; d < debt.length; d++) {
      for (c = 0; c < cred.length; c++) {
        if (debt[d].amt > 0 && debt[d].amt === cred[c].amt) { push(debt[d].id, cred[c].id, debt[d].amt); debt[d].amt = 0; cred[c].amt = 0; break; }
      }
    }
    function byAmt(a, b) { return b.amt - a.amt || a.o - b.o; }
    for (;;) {
      debt = debt.filter(function (x) { return x.amt > 0; }).sort(byAmt);
      cred = cred.filter(function (x) { return x.amt > 0; }).sort(byAmt);
      if (!debt.length || !cred.length) break;
      var pay = Math.min(debt[0].amt, cred[0].amt);
      push(debt[0].id, cred[0].id, pay);
      debt[0].amt -= pay; cred[0].amt -= pay;
    }
    return out;
  }
  B._settle = settle;

  /**
   * Everything the UI and the bill need, computed from a (normalised) state.
   * All money values are PAISE.
   */
  B.compute = function (st) {
    var fr = st.friends, n = fr.length, i;
    var res = { n: n, total: 0, lines: [], people: [], settlements: [], avg: 0, cats: [], stats: { top: null, biggest: null, items: st.expenses.length }, byId: {} };
    if (!n) return res;

    var paid = [], share = [];
    for (i = 0; i < n; i++) { paid.push(0); share.push(0); }
    var index = {}; fr.forEach(function (f, k) { index[f.id] = k; });
    var catMap = {};

    st.expenses.forEach(function (e, ei) {
      var t = B.lineTotal(e), who = participants(e, fr), k = who.length, base = Math.floor(t / k), rem = t - base * k, j;
      var shares = {};
      for (j = 0; j < k; j++) { share[who[j]] += base; shares[fr[who[j]].id] = base; }
      // the leftover paise go to different people for different items, so nobody is always the unlucky one
      for (j = 0; j < rem; j++) { var w = who[(ei + j) % k]; share[w] += 1; shares[fr[w].id] += 1; }
      paid[index[e.paidBy]] += t;
      res.total += t;
      res.lines.push({ id: e.id, name: e.name, qty: B.cleanQty(e.qty), unit: B.toPaise(e.amount), total: t, paidBy: e.paidBy, cat: e.cat, all: !!e.all || who.length === n, with: who.map(function (x) { return fr[x].id; }), shares: shares });
      catMap[e.cat] = (catMap[e.cat] || 0) + t;
      if (!res.stats.biggest || t > res.stats.biggest.total) res.stats.biggest = res.lines[res.lines.length - 1];
    });

    fr.forEach(function (f, k) {
      var p = { id: f.id, name: f.name, emoji: f.emoji, c: f.c, upi: f.upi, paid: paid[k], share: share[k], balance: paid[k] - share[k] };
      res.people.push(p); res.byId[f.id] = p;
    });
    res.avg = Math.round(res.total / n);
    res.settlements = settle(res.people);
    // optional: "Round to whole rupees" — nobody wants to send ₹0.02, so every transfer becomes a whole ₹ amount
    res.rounded = !!(st.style && st.style.round);
    if (res.rounded) {
      res.settlements = res.settlements.map(function (x) {
        var a = Math.round(x.amount / 100) * 100;
        return { from: x.from, to: x.to, amount: a, key: x.from + '>' + x.to + ':' + a };
      }).filter(function (x) { return x.amount > 0; });
    }
    res.cats = Object.keys(catMap).map(function (c) { return { cat: c, total: catMap[c] }; }).sort(function (a, b) { return b.total - a.total; });
    var top = null; res.people.forEach(function (p) { if (p.paid > 0 && (!top || p.paid > top.paid)) top = p; });
    res.stats.top = top;
    // how many of the current settlements are marked as paid
    res.doneCount = 0;
    res.settlements.forEach(function (s) { s.done = !!st.settled[s.key]; if (s.done) res.doneCount++; });
    res.allDone = res.settlements.length > 0 && res.doneCount === res.settlements.length;
    return res;
  };

  /** Drops "settled" marks that no longer match any live settlement (bill was edited). */
  B.pruneSettled = function (st, calc) {
    var live = {}, changed = false;
    calc.settlements.forEach(function (s) { live[s.key] = 1; });
    Object.keys(st.settled).forEach(function (k) { if (!live[k]) { delete st.settled[k]; changed = true; } });
    return changed;
  };

  /* ----------------------------------------------------------- whatsapp text */
  /**
   * The WhatsApp-ready summary (uses *bold* markup that WhatsApp understands).
   * opts: { items: bool, url: string }
   */
  B.whatsappText = function (st, calc, opts) {
    opts = opts || {};
    var L = [], title = st.title || 'Expense bill';
    L.push('🧾 *' + title + '*' + (B.fmtDate(st.date) ? '  •  ' + B.fmtDate(st.date) : ''));
    L.push('━━━━━━━━━━━━━━');
    L.push('💰 *Total spent:* ' + B.inr(calc.total));
    if (calc.n) L.push('👥 ' + calc.n + (calc.n === 1 ? ' person' : ' friends') + '  •  Average: ' + B.inr(calc.avg) + ' each');
    if (opts.items && calc.lines.length) {
      L.push('', '🛍️ *Items*');
      calc.lines.forEach(function (l) {
        L.push('• ' + l.cat + ' ' + l.name + (l.qty !== 1 ? ' (' + B.fmtQty(l.qty) + ' × ' + B.inr(l.unit) + ')' : '') + ' — ' + B.inr(l.total) + '  [' + (calc.byId[l.paidBy] ? calc.byId[l.paidBy].name : '?') + ']');
      });
    }
    if (calc.people.length) {
      L.push('', '💳 *Who paid*');
      calc.people.forEach(function (p) { L.push('• ' + p.name + ': ' + B.inr(p.paid)); });
      L.push('', '🍽️ *Each person\'s share*');
      calc.people.forEach(function (p) { L.push('• ' + p.name + ': ' + B.inr(p.share)); });
    }
    L.push('', '🤝 *Settle up*');
    if (!calc.settlements.length) L.push(calc.total ? '✅ Everyone is even — nothing to settle!' : '— Add some expenses first —');
    calc.settlements.forEach(function (s) {
      L.push((s.done ? '✅ ' : '👉 ') + calc.byId[s.from].name + ' pays ' + calc.byId[s.to].name + ' ' + B.inr(s.amount) + (s.done ? ' (done)' : ''));
    });
    if (calc.rounded && calc.settlements.length) L.push('(amounts rounded to whole ₹)');
    if (st.note) L.push('', '📝 ' + st.note);
    L.push('', '✨ Made with PayMate • Split smart. Settle easy.');
    if (opts.url) L.push(opts.url);
    return L.join('\n');
  };

  /* ------------------------------------------------------------ list parser */
  /**
   * Parses pasted lines into expenses, e.g.
   *   "Samosa 20 x 3"   -> Samosa, ₹20, qty 3
   *   "Taxi - ₹450"     -> Taxi, ₹450
   *   "120 Chai"        -> Chai, ₹120
   * Returns [{ name, amount, qty }] (lines it cannot understand are skipped).
   */
  B.parseList = function (text) {
    var out = [];
    String(text || '').split(/\r?\n|;/).forEach(function (line) {
      line = line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim();
      if (!line) return;
      var qty = 1, m;
      // trailing "x 3" / "× 3" / "*3"
      if ((m = /\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(line))) { qty = parseFloat(m[1]); line = line.slice(0, m.index).trim(); }
      var name, amt;
      if ((m = /^(.*?)[\s:=\-–—]*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/-|rs|₹)?\s*$/i.exec(line)) && m[1].replace(/[^A-Za-zऀ-ॿ]/g, '')) {
        name = m[1]; amt = m[2];
      } else if ((m = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/-|rs|₹)?[\s:=\-–—]+(.+)$/i.exec(line))) {
        amt = m[1]; name = m[2];
      } else return;
      name = clean(name.replace(/[\s:=\-–—]+$/, ''), LIM.item);
      var a = B.cleanAmount(amt);
      if (!name || !(a > 0)) return;
      out.push({ name: name, amount: a, qty: B.cleanQty(qty) });
    });
    return out;
  };

  /* ----------------------------------------------------------------- misc */
  B.firstName = function (s) { return String(s || '').split(' ')[0]; };
  B.initial = function (name) {
    var ch = String(name || '?').trim().charAt(0);
    return ch ? ch.toUpperCase() : '?';
  };
  /** Safe text for HTML. */
  B.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  /** Bill file name: PayMate-Canteen-Movie-Day-2026-10-19 */
  B.fileName = function (st) {
    var t = clean(st.title, 40).replace(/[^\wऀ-ॿ]+/g, '-').replace(/^-+|-+$/g, '') || 'Bill';
    return 'PayMate-' + t + '-' + (B.validDate(st.date) ? st.date : B.today());
  };

})(window.PayMate = window.PayMate || {});
