/* =========================================================================
   PayMate — js/app.js
   The UI controller: forms, lists, live preview, drafts, undo/redo, exports,
   donate / suggestion / install, theme and all the small helpers.

   Flow:  user action → change the bill state `S` → commit() →
          normalise + recompute (bill.js) → re-render lists + preview → auto-save.
   ========================================================================= */
(function (PM) {
  'use strict';

  var B = PM.bill, T = PM.templates, ST = PM.store, X = PM.exporter, PW = PM.pwa, CFG = PM.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var esc = B.esc;
  var PAGE_W = 794, PAGE_H = 1123;

  var S = null;            // the bill being edited (always normalised)
  var calc = null;         // B.compute(S)
  var zoom = 1;            // preview zoom, relative to "fit"
  var editing = null;      // expense-sheet state

  /* =====================================================================
     1. SMALL HELPERS
     ===================================================================== */
  function toast(msg, opts) {
    opts = opts || {};
    var box = $('toasts'), el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    if (opts.action) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = opts.action.label;
      b.addEventListener('click', function () { opts.action.fn(); kill(); });
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    var t = setTimeout(kill, opts.ms || (opts.action ? 6000 : 2800));
    function kill() { clearTimeout(t); el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 99999);
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); } finally { ta.remove(); }
    });
  }

  function busy(msg) {
    var el = document.createElement('div');
    el.className = 'busy'; el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="busy-card glass"><div class="spinner"></div><div>' + esc(msg) + '</div></div>';
    document.body.appendChild(el);
    return { set: function (m) { el.querySelector('.busy-card div:last-child').textContent = m; }, close: function () { el.remove(); } };
  }

  /* ---- modal manager: Esc + Android/browser Back button close the top-most window ---- */
  var stack = [], focusStack = [], skipPop = 0;
  function openModal(id, replace) {
    var m = $(id);
    if (!m || !m.hidden) return;
    m.hidden = false; stack.push(id); focusStack.push(document.activeElement);
    document.body.classList.add('has-modal');
    try { replace ? history.replaceState({ pm: id }, '') : history.pushState({ pm: id }, ''); } catch (e) {}
    setTimeout(function () {
      var f = m.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]):not(.honeypot), textarea, .modal-b button, .btn-icon');
      if (f && !/^(INPUT|TEXTAREA)$/.test(f.tagName) ? true : f) { try { f.focus({ preventScroll: true }); } catch (e) {} }
    }, 60);
  }
  function closeModal(id, o) {
    o = o || {};
    var m = $(id), i = stack.lastIndexOf(id);
    if (!m || m.hidden) return;
    m.hidden = true; if (i > -1) stack.splice(i, 1);
    var f = focusStack.pop(); if (f && f.focus) try { f.focus({ preventScroll: true }); } catch (e) {}
    if (!stack.length) document.body.classList.remove('has-modal');
    if (!o.noBack && !o.fromPop && history.state && history.state.pm) { skipPop++; history.back(); }
  }
  /** close the top modal and open another one without piling up history entries */
  function go(id) { var top = stack[stack.length - 1]; if (top) closeModal(top, { noBack: true }); openModal(id, !!top); }
  window.addEventListener('popstate', function () {
    if (skipPop) { skipPop--; return; }
    var id = stack[stack.length - 1]; if (id) closeModal(id, { fromPop: true });
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-close]');
    if (c) { var m = c.closest('.modal'); if (m) closeModal(m.id); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); closeModal(stack[stack.length - 1]); }
    // keep Tab inside the open window
    if (e.key === 'Tab' && stack.length) {
      var m = $(stack[stack.length - 1]), f = m.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not(.honeypot), select, textarea, [tabindex]:not([tabindex="-1"])');
      f = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /** Promise-based replacement for window.confirm(). */
  function confirmDialog(title, text, yes, danger) {
    return new Promise(function (resolve) {
      $('cfTitle').textContent = title; $('cfText').textContent = text;
      var y = $('cfYes'), n = $('cfNo');
      y.textContent = yes || 'Yes'; y.className = 'btn ' + (danger === false ? 'btn-primary' : 'btn-danger');
      var done = function (v) { y.onclick = n.onclick = null; closeModal('confirmModal'); resolve(v); };
      y.onclick = function () { done(true); }; n.onclick = function () { done(false); };
      openModal('confirmModal');
      setTimeout(function () { n.focus(); }, 80);
    });
  }

  function avHtml(f, cls) {
    var pal = B.PALETTE[f.c % B.PALETTE.length];
    return '<span class="av ' + (cls || '') + '" style="--avbg:' + pal[0] + ';--avink:' + pal[1] + '">' + esc(f.emoji) + '</span>';
  }
  function friendById(id) { for (var i = 0; i < S.friends.length; i++) if (S.friends[i].id === id) return S.friends[i]; return null; }
  function hasContent() { return !!(S.friends.length || S.expenses.length || S.title); }

  /* =====================================================================
     2. STATE, SAVING, UNDO / REDO
     ===================================================================== */
  var saveTimer = null, undoTimer = null, baseline = '', undoStack = [], redoStack = [];

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    var ok = ST.set('state', S);
    var h = $('saveHint');
    if (!ok) h.textContent = '⚠ Could not save on this device (storage full or blocked)';
    else h.textContent = ST.persistent ? 'Auto-saved on this device ✓' : 'Private mode: changes are kept only until you close this tab';
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });

  function snap() { return JSON.stringify(S); }
  function pushUndo(delay) {
    clearTimeout(undoTimer);
    undoTimer = setTimeout(flushUndo, delay);
  }
  function flushUndo() {
    clearTimeout(undoTimer);
    var cur = snap();
    if (cur === baseline) return;
    undoStack.push(baseline); if (undoStack.length > 60) undoStack.shift();
    baseline = cur; redoStack = [];
    syncUndoButtons();
  }
  function syncUndoButtons() { $('btnUndo').disabled = !undoStack.length; $('btnRedo').disabled = !redoStack.length; }
  function doUndo() {
    flushUndo();
    if (!undoStack.length) return;
    redoStack.push(baseline); baseline = undoStack.pop();
    S = B.normalize(JSON.parse(baseline), T.has); afterLoad(true); syncUndoButtons(); toast('Undone ↩︎');
  }
  function doRedo() {
    flushUndo();
    if (!redoStack.length) return;
    undoStack.push(baseline); baseline = redoStack.pop();
    S = B.normalize(JSON.parse(baseline), T.has); afterLoad(true); syncUndoButtons(); toast('Redone ↪︎');
  }

  /**
   * kind: 'struct' (friends / expenses / options changed) or 'text' (typing in title / note / date).
   * Re-normalises, recomputes and redraws what changed, then saves.
   */
  function commit(kind) {
    S = B.normalize(S, T.has);
    calc = B.compute(S);
    if (B.pruneSettled(S, calc)) calc = B.compute(S);
    if (kind !== 'text') { renderFriends(); renderExpenses(); renderSummary(); updatePickerState(); }
    renderPreviewSoon();
    persist();
    pushUndo(kind === 'text' ? 700 : 30);
    syncTip();
  }

  /** load a whole new bill into the UI */
  function afterLoad(keepUndo) {
    calc = B.compute(S);
    if (B.pruneSettled(S, calc)) calc = B.compute(S);
    syncDetails(); renderFriends(); renderExpenses(); renderSummary(); updatePickerState(); renderPreview();
    if (!keepUndo) { undoStack = []; redoStack = []; baseline = snap(); syncUndoButtons(); }
    persist(); syncTip();
  }
  function loadState(st) { S = B.normalize(st, T.has); afterLoad(false); }

  function syncDetails() {
    $('fTitle').value = S.title; $('fDate').value = S.date; $('fNote').value = S.note;
  }

  /* ---- first-visit sample bill tip ---- */
  function syncTip() {
    var s = ST.settings();
    $('tipBar').hidden = !(s.sampleId && s.sampleId === S.id && !s.tipClosed && S.id === s.sampleId && sampleUntouched);
  }
  var sampleUntouched = false;

  /* =====================================================================
     3. DETAILS CARD
     ===================================================================== */
  $('fTitle').addEventListener('input', function () { S.title = this.value; sampleUntouched = false; commit('text'); });
  $('fNote').addEventListener('input', function () { S.note = this.value; sampleUntouched = false; commit('text'); });
  $('fDate').addEventListener('input', function () { if (B.validDate(this.value)) { S.date = this.value; commit('text'); } });
  $('fDate').addEventListener('blur', function () { if (!B.validDate(this.value)) this.value = S.date; });

  function saveDraftNow(silent) {
    flushSave();
    var ok = ST.saveDraft(S);
    if (!silent) toast(ok ? 'Draft saved 💾' : 'Could not save — browser storage is full or blocked');
    return ok;
  }
  $('btnSave').addEventListener('click', function () { saveDraftNow(); });

  $('btnResume').addEventListener('click', function () {
    var d = ST.lastDraft();
    if (!d) { toast('No saved draft yet — tap “Save draft” first'); return; }
    if (d.id === S.id && JSON.stringify(B.normalize(d.state, T.has)) === snap()) { toast('You are already on the last saved draft'); return; }
    var go = function () { saveCurrentIfNeeded(); loadState(d.state); toast('Resumed “' + (d.title || 'Untitled bill') + '” 📂'); };
    hasContent() ? confirmDialog('Resume last draft?', 'Your current bill will be saved in “My bills” first, then “' + (d.title || 'Untitled bill') + '” opens.', 'Resume', false).then(function (y) { if (y) go(); }) : go();
  });

  function saveCurrentIfNeeded() {
    if (!sampleUntouched && (S.expenses.length || S.title)) ST.saveDraft(S);
  }
  function newBill() {
    saveCurrentIfNeeded();
    S = B.blank(); S.template = (ST.settings().lastTemplate && T.has(ST.settings().lastTemplate)) ? ST.settings().lastTemplate : 'campus';
    sampleUntouched = false;
    afterLoad(false);
    toast('New bill ready ✨');
    $('fTitle').focus({ preventScroll: false });
  }
  $('btnNew').addEventListener('click', function () {
    if (!S.expenses.length && !S.friends.length && !S.title) { toast('This bill is already empty'); return; }
    sampleUntouched ? newBill() : confirmDialog('Start a new bill?', 'Your current bill is saved in “My bills” first, so nothing is lost.', 'Start new', false).then(function (y) { if (y) newBill(); });
  });
  $('tipNew').addEventListener('click', newBill);
  $('tipClose').addEventListener('click', function () { ST.setSetting('tipClosed', true); $('tipBar').hidden = true; });

  $('btnUndo').addEventListener('click', doUndo);
  $('btnRedo').addEventListener('click', doRedo);

  /* =====================================================================
     4. FRIENDS
     ===================================================================== */
  function renderFriends() {
    $('friendCount').textContent = S.friends.length;
    var h = '';
    S.friends.forEach(function (f) {
      h += '<li class="fr"><button class="fr-main" type="button" data-edit="' + f.id + '" aria-label="Edit ' + esc(f.name) + '">' + avHtml(f) +
        '<span class="fr-name">' + esc(f.name) + '</span>' + (f.upi ? '<span class="fr-upi">UPI</span>' : '') + '</button>' +
        '<button class="fr-x" type="button" data-del="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">✕</button></li>';
    });
    $('friendList').innerHTML = h || '<li class="empty" style="width:100%"><span class="big">👋</span><b>No friends yet</b>Add the people who shared the expenses.</li>';
  }

  $('friendForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('fFriend'), names = inp.value.split(/[,\n;]+/).map(function (s) { return B.cleanText(s, B.LIMITS.name); }).filter(Boolean);
    if (!names.length) { inp.focus(); return; }
    var added = 0;
    names.forEach(function (n) {
      if (S.friends.length >= B.LIMITS.friends) return;
      S.friends.push(B.newFriend(n, S.friends.length)); added++;
    });
    if (!added) { toast('You can add up to ' + B.LIMITS.friends + ' friends'); return; }
    sampleUntouched = false;
    inp.value = ''; commit('struct');
    toast(added === 1 ? names[0] + ' added 🎉' : added + ' friends added 🎉');
    inp.focus();
  });

  $('friendList').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) openFriend(ed.dataset.edit);
    else if (del) removeFriend(del.dataset.del);
  });

  function removeFriend(id) {
    var f = friendById(id); if (!f) return;
    var paidCount = S.expenses.filter(function (x) { return x.paidBy === id; }).length;
    var msg = paidCount ? f.name + ' paid for ' + paidCount + ' expense' + (paidCount > 1 ? 's' : '') + '. Removing them also removes ' + (paidCount > 1 ? 'those expenses' : 'that expense') + '. You can undo this.' : 'Remove ' + f.name + ' from this bill? You can undo this.';
    confirmDialog('Remove ' + f.name + '?', msg, 'Remove').then(function (y) {
      if (!y) return;
      S.friends = S.friends.filter(function (x) { return x.id !== id; });
      S.expenses = S.expenses.filter(function (x) { return x.paidBy !== id; });
      S.expenses.forEach(function (x) { x.with = x.with.filter(function (w) { return w !== id; }); });
      sampleUntouched = false;
      commit('struct');
      closeModal('friendModal');
      toast(f.name + ' removed', { action: { label: 'Undo', fn: doUndo } });
    });
  }

  /* ---- friend sheet ---- */
  var frId = null, frEmoji = null;
  function openFriend(id) {
    var f = friendById(id); if (!f) return;
    frId = id; frEmoji = f.emoji;
    $('frName').value = f.name; $('frUpi').value = f.upi || ''; $('frErr').hidden = true;
    drawEmojiGrid();
    openModal('friendModal');
  }
  function drawEmojiGrid() {
    $('frEmoji').innerHTML = B.AVATARS.map(function (e) { return '<button type="button" data-e="' + e + '" aria-pressed="' + (e === frEmoji) + '" aria-label="Avatar ' + e + '">' + e + '</button>'; }).join('');
  }
  $('frEmoji').addEventListener('click', function (e) { var b = e.target.closest('[data-e]'); if (b) { frEmoji = b.dataset.e; drawEmojiGrid(); } });
  $('frForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = friendById(frId); if (!f) return;
    var name = B.cleanText($('frName').value, B.LIMITS.name), upi = B.cleanText($('frUpi').value, B.LIMITS.upi);
    if (!name) { $('frErr').textContent = 'Please enter a name.'; $('frErr').hidden = false; return; }
    if (upi && !/^[\w.\-+]{2,}@[A-Za-z][\w.\-]{1,}$/.test(upi)) { $('frErr').textContent = 'That UPI ID looks wrong — it should look like name@bank.'; $('frErr').hidden = false; return; }
    f.name = name; f.emoji = frEmoji || f.emoji; f.upi = upi;
    commit('struct'); closeModal('friendModal'); toast('Saved ✓');
  });
  $('frDelete').addEventListener('click', function () { removeFriend(frId); });

  /* =====================================================================
     5. EXPENSES
     ===================================================================== */
  function renderExpenses() {
    $('expCount').textContent = S.expenses.length;
    var h = '';
    calc.lines.forEach(function (l) {
      var p = calc.byId[l.paidBy], n = calc.n;
      var split = l.all ? 'split ' + n + ' ways' : 'split: ' + l.with.map(function (id) { return B.firstName(calc.byId[id].name); }).join(', ');
      var rate = l.qty !== 1 ? B.fmtQty(l.qty) + ' × ' + B.inr(l.unit) + ' · ' : '';
      h += '<li class="exp" data-id="' + l.id + '"><button class="exp-main" type="button" data-edit="' + l.id + '" aria-label="Edit ' + esc(l.name) + '">' +
        '<span class="exp-ic" aria-hidden="true">' + esc(l.cat) + '</span><span class="exp-txt"><b>' + esc(l.name) + '</b><small>' + esc(rate) + 'paid by ' + esc(p ? p.name : '?') + ' · ' + esc(split) + '</small></span>' +
        '<span class="exp-amt">' + B.inr(l.total) + '</span></button>' +
        '<button class="btn-icon btn-icon-sm exp-del" type="button" data-del="' + l.id + '" aria-label="Delete ' + esc(l.name) + '">🗑️</button></li>';
    });
    $('expList').innerHTML = h || '<li class="empty"><span class="big">🧾</span><b>No expenses yet</b>Tap “Add expense” to start your bill.</li>';
    $('expTotal').hidden = !S.expenses.length;
    $('expTotalVal').textContent = B.inr(calc.total);
  }

  $('expList').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) openExpense(ed.dataset.edit);
    else if (del) {
      var id = del.dataset.del, ex = S.expenses.filter(function (x) { return x.id === id; })[0];
      if (!ex) return;
      S.expenses = S.expenses.filter(function (x) { return x.id !== id; });
      sampleUntouched = false; commit('struct');
      toast('“' + ex.name + '” deleted', { action: { label: 'Undo', fn: doUndo } });
    }
  });

  var BASE_ITEMS = ['Chai', 'Samosa', 'Pizza', 'Burger', 'Maggi', 'Momos', 'Biryani', 'Cold drinks', 'Ice cream', 'Snacks', 'Lunch', 'Dinner', 'Breakfast', 'Cab', 'Auto fare', 'Petrol', 'Bus tickets', 'Train tickets', 'Movie tickets', 'Hotel room', 'Groceries', 'Printouts', 'Recharge', 'Gift', 'Cake', 'Tip'];
  var CAT_CHOICES = ['🧾', '🍽️', '🫖', '☕', '🍕', '🍔', '🥟', '🍜', '🍛', '🍦', '🥤', '🍿', '🛒', '🚕', '🚌', '⛽', '🏨', '🎬', '🎮', '📚', '📶', '💊', '🎁', '🎉', '🎂', '🛍️', '🎟️', '💡'];

  function fillSuggestions() {
    var recent = ST.settings().recent || [], seen = {}, out = [];
    recent.concat(BASE_ITEMS).forEach(function (n) { var k = String(n).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(n); } });
    $('itemSuggest').innerHTML = out.slice(0, 40).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }

  function openExpense(id) {
    if (!S.friends.length) {
      toast('Add your friends first 👥');
      $('cardFriends').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { $('fFriend').focus({ preventScroll: true }); }, 400);
      return;
    }
    var ex = id ? S.expenses.filter(function (x) { return x.id === id; })[0] : null;
    var lastPayer = ST.settings().lastPayer;
    editing = ex
      ? { id: ex.id, cat: ex.cat, catAuto: false, paid: ex.paidBy, all: !!ex.all, with: ex.all ? S.friends.map(function (f) { return f.id; }) : ex.with.slice() }
      : { id: null, cat: '🧾', catAuto: true, paid: friendById(lastPayer) ? lastPayer : S.friends[0].id, all: true, with: S.friends.map(function (f) { return f.id; }) };
    $('expTitle').textContent = ex ? 'Edit expense' : 'Add expense';
    $('eName').value = ex ? ex.name : ''; $('eAmount').value = ex ? String(ex.amount || '') : ''; $('eQty').value = ex ? B.fmtQty(ex.qty) : '1';
    $('eDelete').hidden = !ex; $('eSaveMore').hidden = !!ex; $('eErr').hidden = true; $('catPick').hidden = true;
    fillSuggestions(); drawPickers(); drawCat(); drawCalc();
    openModal('expModal');
    if (!ex) setTimeout(function () { $('eName').focus(); }, 120);
  }

  function drawCat() { $('eCat').textContent = editing.cat; }
  function drawPickers() {
    $('ePaid').innerHTML = S.friends.map(function (f) {
      return '<button type="button" role="radio" aria-checked="' + (editing.paid === f.id) + '" data-id="' + f.id + '">' + avHtml(f, 'sm') + '<span>' + esc(f.name) + '</span></button>';
    }).join('');
    $('eWith').innerHTML = S.friends.map(function (f) {
      return '<button type="button" aria-pressed="' + (editing.with.indexOf(f.id) !== -1) + '" data-id="' + f.id + '">' + avHtml(f, 'sm') + '<span>' + esc(f.name) + '</span></button>';
    }).join('');
    $('eAllBtn').textContent = editing.with.length === S.friends.length ? 'Everyone ✓' : 'Select everyone';
  }
  function drawCalc() {
    var amt = B.cleanAmount($('eAmount').value), qty = B.cleanQty($('eQty').value);
    var total = B.lineTotal({ amount: amt, qty: qty }), k = Math.max(1, editing.with.length);
    $('eCalc').innerHTML = total > 0
      ? 'Total <b>' + B.inr(total) + '</b>' + (qty !== 1 ? ' (' + B.fmtQty(qty) + ' × ' + B.inr(B.toPaise(amt)) + ')' : '') + ' · about <b>' + B.inr(Math.round(total / k)) + '</b> each for ' + k + (k === 1 ? ' person' : ' people')
      : 'Type the price of <b>one</b> item and the quantity — PayMate does the rest.';
  }

  $('eName').addEventListener('input', function () { if (editing.catAuto) { editing.cat = B.guessCat(this.value); drawCat(); } });
  $('eAmount').addEventListener('input', drawCalc);
  $('eQty').addEventListener('input', drawCalc);
  function stepQty(d) {
    var q = B.cleanQty($('eQty').value), n = Math.max(1, Math.round(q + d));
    if (d < 0 && q <= 1) n = q > 0.5 ? 0.5 : 0.5;
    $('eQty').value = B.fmtQty(d < 0 && q <= 1 ? Math.max(0.5, q - 0.5) : n); drawCalc();
  }
  $('qtyMinus').addEventListener('click', function () { stepQty(-1); });
  $('qtyPlus').addEventListener('click', function () { stepQty(1); });

  $('ePaid').addEventListener('click', function (e) { var b = e.target.closest('[data-id]'); if (b) { editing.paid = b.dataset.id; drawPickers(); } });
  $('eWith').addEventListener('click', function (e) {
    var b = e.target.closest('[data-id]'); if (!b) return;
    var id = b.dataset.id, i = editing.with.indexOf(id);
    if (i === -1) editing.with.push(id); else if (editing.with.length > 1) editing.with.splice(i, 1); else toast('Keep at least one person in the split');
    drawPickers(); drawCalc();
  });
  $('eAllBtn').addEventListener('click', function () { editing.with = S.friends.map(function (f) { return f.id; }); drawPickers(); drawCalc(); });

  $('eCat').addEventListener('click', function () {
    var box = $('catPick');
    box.innerHTML = CAT_CHOICES.map(function (c) { return '<button type="button" data-c="' + c + '" aria-label="Emoji ' + c + '">' + c + '</button>'; }).join('');
    box.hidden = !box.hidden;
  });
  $('catPick').addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (b) { editing.cat = b.dataset.c; editing.catAuto = false; drawCat(); $('catPick').hidden = true; } });

  function saveExpense(another) {
    var name = B.cleanText($('eName').value, B.LIMITS.item), amt = B.cleanAmount($('eAmount').value), qty = B.cleanQty($('eQty').value), err = $('eErr');
    if (!name) { err.textContent = 'Please type what the expense was for (e.g. Pizza).'; err.hidden = false; $('eName').focus(); return; }
    if (!(amt > 0)) { err.textContent = 'Please enter an amount greater than ₹0.'; err.hidden = false; $('eAmount').focus(); return; }
    err.hidden = true;
    var all = editing.with.length === S.friends.length;
    var rec = { id: editing.id || B.uid('e'), name: name, amount: amt, qty: qty, paidBy: editing.paid, all: all, with: all ? [] : editing.with.slice(), cat: editing.cat };
    if (editing.id) S.expenses = S.expenses.map(function (x) { return x.id === editing.id ? rec : x; });
    else { if (S.expenses.length >= B.LIMITS.expenses) { toast('That is the maximum of ' + B.LIMITS.expenses + ' expenses for one bill'); return; } S.expenses.push(rec); }
    // remember for next time
    var s = ST.settings(), rc = (s.recent || []).filter(function (n) { return n.toLowerCase() !== name.toLowerCase(); }); rc.unshift(name);
    s.recent = rc.slice(0, 30); s.lastPayer = editing.paid; ST.set('settings', s);
    sampleUntouched = false;
    commit('struct');
    var row = document.querySelector('.exp[data-id="' + rec.id + '"]'); if (row) row.classList.add('flash');
    if (another) {
      toast('Added “' + name + '” ✓');
      editing = { id: null, cat: '🧾', catAuto: true, paid: editing.paid, all: true, with: S.friends.map(function (f) { return f.id; }) };
      $('eName').value = ''; $('eAmount').value = ''; $('eQty').value = '1'; drawPickers(); drawCat(); drawCalc();
      $('eName').focus();
    } else { closeModal('expModal'); toast(editing.id ? 'Expense updated ✓' : 'Expense added ✓'); }
  }
  $('expForm').addEventListener('submit', function (e) { e.preventDefault(); saveExpense(false); });
  $('eSaveMore').addEventListener('click', function () { saveExpense(true); });
  $('eDelete').addEventListener('click', function () {
    var id = editing.id, ex = S.expenses.filter(function (x) { return x.id === id; })[0];
    S.expenses = S.expenses.filter(function (x) { return x.id !== id; });
    commit('struct'); closeModal('expModal');
    toast('“' + (ex ? ex.name : 'Expense') + '” deleted', { action: { label: 'Undo', fn: doUndo } });
  });
  $('btnAddExp').addEventListener('click', function () { openExpense(); });
  $('dockAdd').addEventListener('click', function () { openExpense(); });

  /* ---- paste a list ---- */
  var pastePaid = null;
  $('btnPaste').addEventListener('click', function () {
    if (!S.friends.length) { toast('Add your friends first 👥'); return; }
    pastePaid = friendById(ST.settings().lastPayer) ? ST.settings().lastPayer : S.friends[0].id;
    $('pasteText').value = ''; drawPastePaid(); drawPastePrev(); openModal('pasteModal');
  });
  function drawPastePaid() {
    $('pastePaid').innerHTML = S.friends.map(function (f) { return '<button type="button" role="radio" aria-checked="' + (pastePaid === f.id) + '" data-id="' + f.id + '">' + avHtml(f, 'sm') + '<span>' + esc(f.name) + '</span></button>'; }).join('');
  }
  function drawPastePrev() {
    var items = B.parseList($('pasteText').value);
    $('pastePrev').innerHTML = items.length
      ? '<b>' + items.length + ' item' + (items.length > 1 ? 's' : '') + ' found</b><ul>' + items.slice(0, 8).map(function (i) { return '<li>' + esc(i.name) + ' — ' + B.inr(B.toPaise(i.amount)) + (i.qty !== 1 ? ' × ' + B.fmtQty(i.qty) : '') + '</li>'; }).join('') + (items.length > 8 ? '<li>…and ' + (items.length - 8) + ' more</li>' : '') + '</ul>'
      : 'Nothing recognised yet. Example: <i>Samosa 20 x 3</i>';
  }
  $('pastePaid').addEventListener('click', function (e) { var b = e.target.closest('[data-id]'); if (b) { pastePaid = b.dataset.id; drawPastePaid(); } });
  $('pasteText').addEventListener('input', drawPastePrev);
  $('pasteForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var items = B.parseList($('pasteText').value);
    if (!items.length) { toast('Nothing to add yet — try “Samosa 20 x 3”'); return; }
    items.slice(0, B.LIMITS.expenses - S.expenses.length).forEach(function (i) {
      S.expenses.push({ id: B.uid('e'), name: i.name, amount: i.amount, qty: i.qty, paidBy: pastePaid, all: true, with: [], cat: B.guessCat(i.name) });
    });
    sampleUntouched = false; commit('struct'); closeModal('pasteModal'); toast(items.length + ' item' + (items.length > 1 ? 's' : '') + ' added ✓');
  });

  /* =====================================================================
     6. SUMMARY & SETTLE UP
     ===================================================================== */
  function renderSummary() {
    var c = calc, h = '';
    if (!c.n) {
      $('sumBody').innerHTML = '<div class="empty"><span class="big">🤝</span><b>Nothing to settle yet</b>Add your friends and a few expenses — PayMate works out who pays whom.</div>';
      return;
    }
    h += '<div class="sum-hero"><div class="sum-total"><span>Total spent</span><b>' + B.inr(c.total) + '</b></div><div class="sum-mini"><span>Friends</span><b>' + c.n + '</b></div><div class="sum-mini"><span>Average each</span><b>' + B.inr(c.avg) + '</b></div></div>';
    var facts = '';
    if (c.stats.top) facts += '<span class="fact">🥇 ' + esc(c.stats.top.name) + ' paid the most · ' + B.inr(c.stats.top.paid) + '</span>';
    if (c.stats.biggest && c.lines.length > 1) facts += '<span class="fact">' + esc(c.stats.biggest.cat) + ' Biggest: ' + esc(c.stats.biggest.name) + ' · ' + B.inr(c.stats.biggest.total) + '</span>';
    if (facts) h += '<div class="facts">' + facts + '</div>';

    h += '<h3 class="sum-h">Who paid &amp; who owes</h3><ul class="people">';
    c.people.forEach(function (p) {
      var pill = p.balance > 0 ? '<span class="pill pos">gets ' + B.inr(p.balance) + '</span>' : p.balance < 0 ? '<span class="pill neg">owes ' + B.inr(-p.balance) + '</span>' : '<span class="pill even">all even</span>';
      h += '<li class="person">' + avHtml(p) + '<div class="person-t"><b>' + esc(p.name) + '</b><small>paid ' + B.inr(p.paid) + ' · share ' + B.inr(p.share) + '</small></div>' + pill + '</li>';
    });
    h += '</ul>';

    h += '<div class="sum-h"><h3>Settle up' + (c.settlements.length ? ' <span class="count">' + c.doneCount + '/' + c.settlements.length + '</span>' : '') + '</h3>' +
      '<label class="switch" title="Round every payment to whole rupees"><input type="checkbox" id="swRound"' + (S.style.round ? ' checked' : '') + '><span class="sw-track" aria-hidden="true"></span><span class="sw-text">Whole ₹</span></label></div>';
    if (!c.settlements.length) {
      h += '<div class="st-none">' + (c.total ? '✅ Everyone is even — nobody owes anything!' : 'Add an expense to see who pays whom.') + '</div>';
    } else {
      h += '<ul class="settle">';
      c.settlements.forEach(function (s, i) {
        var a = c.byId[s.from], b = c.byId[s.to];
        h += '<li class="st' + (s.done ? ' is-done' : '') + '"><label class="st-check" title="Mark as paid"><input type="checkbox" data-key="' + esc(s.key) + '"' + (s.done ? ' checked' : '') + ' aria-label="' + esc(a.name) + ' paid ' + esc(b.name) + '"><span class="box" aria-hidden="true">✓</span></label>' +
          '<div class="st-main">' + avHtml(a, 'sm') + '<b>' + esc(a.name) + '</b><span class="arrow" aria-hidden="true">→</span>' + avHtml(b, 'sm') + '<b>' + esc(b.name) + '</b></div><div class="st-amt">' + B.inr(s.amount) + '</div>' +
          '<div class="st-act"><button class="btn btn-sm btn-soft" type="button" data-pay="' + i + '">📲 Pay with UPI</button><button class="btn-icon btn-icon-sm" type="button" data-copy="' + i + '" aria-label="Copy this payment" title="Copy">📋</button></div></li>';
      });
      h += '</ul>';
    }

    if (c.cats.length > 1) {
      h += '<h3 class="sum-h">Where the money went</h3><div class="cats">';
      c.cats.slice(0, 6).forEach(function (k) { var pct = Math.max(3, Math.round(k.total * 100 / c.total)); h += '<div class="cat"><span aria-hidden="true">' + esc(k.cat) + '</span><div class="cat-bar"><i style="width:' + pct + '%"></i></div><b>' + B.inr(k.total) + '</b></div>'; });
      h += '</div>';
    }

    h += '<div class="sum-actions"><button class="btn btn-wa" type="button" data-wa="copy">💬 Copy WhatsApp summary</button><button class="btn btn-soft" type="button" data-wa="open">↗ Send on WhatsApp</button></div>' +
      '<label class="switch" style="margin-top:12px"><input type="checkbox" id="swItems"' + (ST.settings().waItems ? ' checked' : '') + '><span class="sw-track" aria-hidden="true"></span><span class="sw-text">Include the item list in the WhatsApp text</span></label>';
    $('sumBody').innerHTML = h;
  }

  function waText() {
    var url = CFG.siteUrl || (location.protocol.indexOf('http') === 0 ? location.origin + location.pathname : '');
    return B.whatsappText(S, calc, { items: !!ST.settings().waItems, url: url });
  }
  function copyWa() {
    if (!calc.total) { toast('Add some expenses first'); return; }
    copyText(waText()).then(function () { toast('Copied! Paste it in WhatsApp 💬'); }, function () { toast('Could not copy — long-press and copy manually'); });
  }

  $('sumBody').addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.key) {
      if (t.checked) S.settled[t.dataset.key] = true; else delete S.settled[t.dataset.key];
      var was = calc.allDone; commit('struct');
      if (calc.allDone && !was) { celebrate(); toast('All settled — you are all square! 🎉'); }
    } else if (t.id === 'swRound') { S.style.round = t.checked ? 1 : 0; commit('struct'); }
    else if (t.id === 'swItems') { ST.setSetting('waItems', t.checked); }
  });
  $('sumBody').addEventListener('click', function (e) {
    var pay = e.target.closest('[data-pay]'), cp = e.target.closest('[data-copy]'), wa = e.target.closest('[data-wa]');
    if (pay) openPay(calc.settlements[+pay.dataset.pay]);
    else if (cp) {
      var s = calc.settlements[+cp.dataset.copy];
      copyText(calc.byId[s.from].name + ' pays ' + calc.byId[s.to].name + ' ' + B.inr(s.amount)).then(function () { toast('Copied ✓'); });
    } else if (wa) {
      if (wa.dataset.wa === 'copy') copyWa();
      else if (calc.total) window.open('https://wa.me/?text=' + encodeURIComponent(waText()), '_blank', 'noopener');
      else toast('Add some expenses first');
    }
  });
  $('btnWa').addEventListener('click', copyWa);

  /* ---- pay one settlement with UPI (deep link + QR) ---- */
  function upiLink(upi, name, rupees, note) {
    return 'upi://pay?pa=' + encodeURIComponent(upi) + '&pn=' + encodeURIComponent(name) + (rupees > 0 ? '&am=' + rupees.toFixed(2) : '') + '&cu=INR&tn=' + encodeURIComponent(note);
  }
  function qrSvg(text) {
    try { return window.PMQR.svg(text, { level: 'M', margin: 2 }); } catch (e) { return '<span style="font-size:.8rem;color:#475569;padding:10px">QR could not be drawn — use the button below.</span>'; }
  }
  function openPay(s) {
    var a = calc.byId[s.from], b = calc.byId[s.to], friend = friendById(s.to), body = $('pyBody');
    $('pyTitle').textContent = a.name + ' → ' + b.name;
    var draw = function () {
      var f = friendById(s.to);
      if (f && f.upi) {
        var link = upiLink(f.upi, f.name, s.amount / 100, 'PayMate: ' + (S.title || 'bill'));
        body.innerHTML = '<p><b>' + esc(a.name) + '</b> pays <b>' + esc(b.name) + '</b></p><div class="qr-box">' + qrSvg(link) + '</div><p class="upi-line" style="font-size:1.4rem"><b>' + B.inr(s.amount) + '</b></p><p class="upi-line">' + esc(f.upi) + '</p>' +
          '<div class="row-actions center"><a class="btn btn-primary" href="' + esc(link) + '">📱 Open UPI app</a><button class="btn btn-soft" id="pyCopy" type="button">Copy UPI ID</button></div>' +
          '<p class="hint">Opens GPay, PhonePe, Paytm or any UPI app with the amount filled in. PayMate never sees or stores payments.</p><p class="hint"><button class="link" id="pyEdit" type="button">Change ' + esc(f.name) + '\'s UPI ID</button></p>';
        $('pyCopy').onclick = function () { copyText(f.upi).then(function () { toast('UPI ID copied ✓'); }); };
        $('pyEdit').onclick = function () { f.upi = ''; commit('struct'); draw(); };
      } else {
        body.innerHTML = '<p>Add <b>' + esc(b.name) + '</b>\'s UPI ID once and PayMate makes a ready-to-scan payment QR for <b>' + B.inr(s.amount) + '</b>.</p>' +
          '<div class="field" style="text-align:left"><label for="pyUpi">' + esc(b.name) + '\'s UPI ID</label><input id="pyUpi" type="text" placeholder="name@bank" autocapitalize="none" spellcheck="false" maxlength="60"></div><p class="form-err" id="pyErr" hidden></p>' +
          '<div class="row-actions center"><button class="btn btn-primary" id="pySave" type="button">Save &amp; show QR</button></div><p class="hint">Stays on this device only.</p>';
        $('pySave').onclick = function () {
          var v = B.cleanText($('pyUpi').value, B.LIMITS.upi);
          if (!/^[\w.\-+]{2,}@[A-Za-z][\w.\-]{1,}$/.test(v)) { $('pyErr').textContent = 'That UPI ID looks wrong — it should look like name@bank.'; $('pyErr').hidden = false; return; }
          friend.upi = v; commit('struct'); draw();
        };
      }
    };
    draw(); openModal('payModal');
  }

  /* =====================================================================
     7. TEMPLATE PICKER (glass) + STICKER OPTIONS
     ===================================================================== */
  function buildPicker() {
    var demo = B.normalize(T.demo(), T.has), dc = B.compute(demo), h = '';
    T.list.forEach(function (t) {
      var d = JSON.parse(JSON.stringify(demo)); d.template = t.id; d.note = '';
      h += '<button class="tpl-card" type="button" role="option" aria-selected="false" data-id="' + t.id + '" aria-label="' + esc(t.name) + ' — ' + esc(t.tag) + '">' +
        '<div class="tpl-thumb" aria-hidden="true">' + T.render(d, dc, { fit: false }) + '</div>' +
        '<span class="tpl-name"><span aria-hidden="true">' + t.emoji + '</span><span>' + esc(t.name) + '</span><span class="tpl-check" aria-hidden="true">✓</span></span><span class="tpl-tag">' + esc(t.tag) + '</span></button>';
    });
    $('tplRow').innerHTML = h;
    $('selPack').innerHTML = '<option value="auto">Auto stickers</option>' + T.packList.map(function (p) { return '<option value="' + p.id + '">' + p.icon + ' ' + esc(p.name) + '</option>'; }).join('');
  }
  function updatePickerState() {
    Array.prototype.forEach.call($('tplRow').children, function (c) { c.setAttribute('aria-selected', String(c.dataset.id === S.template)); });
    $('swStk').checked = S.style.stk !== 0;
    $('selPack').value = S.style.pack && (S.style.pack === 'auto' || T.packs[S.style.pack]) ? S.style.pack : 'auto';
    $('selPack').disabled = S.style.stk === 0; $('btnShuffle').disabled = S.style.stk === 0;
  }
  $('tplRow').addEventListener('click', function (e) {
    if (dragMoved) { dragMoved = false; return; }
    var c = e.target.closest('.tpl-card'); if (!c) return;
    S.template = c.dataset.id; ST.setSetting('lastTemplate', S.template);
    commit('struct');
    c.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
  // drag-to-scroll with a mouse (touch already scrolls natively)
  var dragMoved = false;
  (function () {
    var row = $('tplRow'), down = false, sx = 0, sl = 0;
    row.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = true; sx = e.clientX; sl = row.scrollLeft; dragMoved = false; });
    window.addEventListener('pointermove', function (e) { if (!down) return; var dx = e.clientX - sx; if (Math.abs(dx) > 5) { dragMoved = true; row.classList.add('dragging'); row.scrollLeft = sl - dx; } });
    window.addEventListener('pointerup', function () { down = false; row.classList.remove('dragging'); setTimeout(function () { dragMoved = false; }, 0); });
  })();
  $('swStk').addEventListener('change', function () { S.style.stk = this.checked ? 1 : 0; commit('struct'); });
  $('selPack').addEventListener('change', function () { S.style.pack = this.value; commit('struct'); });
  $('btnShuffle').addEventListener('click', function () { S.style.seed = (S.style.seed + 1) % 100; commit('struct'); });

  /* =====================================================================
     8. LIVE PREVIEW (scaled bill), auto-fit to one page, zoom
     ===================================================================== */
  var rafId = 0;
  function renderPreviewSoon() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(renderPreview); }

  var lastPages = 1, autoFitted = false;
  function renderPreview() {
    var stage = $('stage'), mode = S.style.fit;               // 2 auto · 1 compact · 0 roomy
    stage.innerHTML = T.render(S, calc, { fit: mode === 1 });
    var paper = stage.firstElementChild;
    autoFitted = false;
    if (mode === 2 && paper.offsetHeight > PAGE_H + 4) {        // try the compact layout; keep it only if it really gets us to one page
      stage.innerHTML = T.render(S, calc, { fit: true });
      var p2 = stage.firstElementChild;
      if (p2.offsetHeight <= PAGE_H + 4) autoFitted = true;
      else stage.innerHTML = T.render(S, calc, { fit: false });
    }
    fitPaper(); drawPageInfo();
  }

  function drawPageInfo() {
    var paper = $('stage').firstElementChild; if (!paper) return;
    var h = paper.offsetHeight, pages = Math.max(1, Math.ceil((h - 6) / PAGE_H)); lastPages = pages;
    var chip = pages === 1
      ? '<span class="page-chip">' + (autoFitted ? '✨ Auto-fitted to 1 A4 page' : '📄 1 A4 page ✓') + '</span>'
      : '<span class="page-chip warn">📑 ' + pages + ' A4 pages — rows are never cut in half</span>';
    var label = S.style.fit === 2 ? 'Layout: Auto' : S.style.fit === 1 ? 'Layout: Compact' : 'Layout: Roomy';
    $('pageInfo').innerHTML = chip + '<button class="btn btn-sm btn-soft" id="btnFit" type="button" title="Switch between Auto, Compact and Roomy spacing">' + label + '</button>';
  }
  $('pageInfo').addEventListener('click', function (e) {
    if (e.target.id === 'btnFit') { S.style.fit = S.style.fit === 2 ? 1 : S.style.fit === 1 ? 0 : 2; commit('struct'); }
  });

  function fitPaper() {
    var stage = $('stage'), paper = stage.firstElementChild, wrap = $('wrap');
    if (!paper) return;
    var h = paper.offsetHeight, availW = Math.max(120, wrap.clientWidth - 24);
    var fit = Math.min(1, availW / PAGE_W);
    if (window.matchMedia('(min-width:1024px)').matches) {           // laptop/desktop: also fit the first page into the visible height
      var chrome = $('picker').offsetHeight + $('cardDownload').offsetHeight + 32 + 150;
      var availH = window.innerHeight - 104 - chrome;
      if (availH > 320) fit = Math.min(fit, availH / Math.min(h, PAGE_H));
    }
    fit = Math.max(.25, fit);
    var scale = Math.min(2, fit * zoom);
    stage.style.width = Math.round(PAGE_W * scale) + 'px';
    stage.style.height = Math.round(h * scale) + 'px';
    paper.style.transform = 'scale(' + scale + ')';
    wrap.style.overflowX = PAGE_W * scale > availW ? 'auto' : 'hidden';
  }
  $('zoomIn').addEventListener('click', function () { zoom = Math.min(2.5, zoom * 1.25); fitPaper(); });
  $('zoomOut').addEventListener('click', function () { zoom = Math.max(.5, zoom / 1.25); fitPaper(); });
  $('zoomFit').addEventListener('click', function () { zoom = 1; fitPaper(); $('wrap').scrollLeft = 0; });
  var rz = 0;
  function onResize() { cancelAnimationFrame(rz); rz = requestAnimationFrame(fitPaper); }
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('wrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (S) renderPreview(); });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { if (S) renderPreviewSoon(); });

  /* =====================================================================
     9. DOWNLOAD / SHARE / PRINT
     ===================================================================== */
  function paperNode() { return $('stage').firstElementChild; }
  function exportMeta() { return { bg: T.get(S.template).bg }; }

  function guardExport() {
    if (!S.friends.length || !S.expenses.length) { toast('Add friends and at least one expense first'); return false; }
    return true;
  }
  function libFailed() {
    toast('Could not load the export tool — check your internet once', { ms: 7000, action: { label: 'Print instead', fn: function () { X.print(paperNode()); } } });
  }

  function doPdf() {
    if (!guardExport()) return;
    var b = busy('Creating your PDF…');
    X.makePdf(paperNode(), exportMeta()).then(function (r) {
      X.download(r.blob, B.fileName(S) + '.pdf');
      toast('PDF ready — ' + r.pages + (r.pages > 1 ? ' pages' : ' page') + ' 📄');
      bump('pdf');
    }).catch(function (e) { if (e && e.message === 'lib') libFailed(); else toast('Something went wrong while making the PDF. Try “Print” → Save as PDF.', { ms: 6000 }); })
      .then(b.close, b.close);
  }
  function doJpg() {
    if (!guardExport()) return;
    var b = busy('Creating your JPG…');
    X.makeJpg(paperNode(), exportMeta()).then(function (blob) {
      X.download(blob, B.fileName(S) + '.jpg'); toast('JPG ready 🖼️'); bump('jpg');
    }).catch(function (e) { if (e && e.message === 'lib') libFailed(); else toast('Something went wrong while making the JPG.', { ms: 6000 }); })
      .then(b.close, b.close);
  }
  function bump(k) { var s = ST.settings(); s['n_' + k] = (s['n_' + k] || 0) + 1; ST.set('settings', s); }

  function doShare() {
    if (!guardExport()) { return; }
    var title = S.title || 'Expense bill', text = waText();
    if (!navigator.share) { copyWa(); return; }
    var b = busy('Preparing to share…');
    X.makePdf(paperNode(), exportMeta()).then(function (r) {
      var name = B.fileName(S) + '.pdf';
      b.close();
      if (X.canShareFile(r.blob, name)) return X.shareFile(r.blob, name, title, text);
      return navigator.share({ title: title, text: text });
    }).catch(function (e) {
      b.close();
      if (e && e.name === 'AbortError') return;
      navigator.share({ title: title, text: text }).catch(function () { copyWa(); });
    });
  }
  $('btnPdf').addEventListener('click', doPdf); $('dockPdf').addEventListener('click', doPdf);
  $('btnJpg').addEventListener('click', doJpg); $('dockJpg').addEventListener('click', doJpg);
  $('btnShare').addEventListener('click', doShare);
  $('btnPrint').addEventListener('click', function () { if (guardExport()) X.print(paperNode()); });

  /* =====================================================================
     10. SHARE LINK (the whole bill inside the address, nothing uploaded)
     ===================================================================== */
  function toB64Url(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  function pump(stream, bytes) {
    var w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Response(stream.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function shareable() {
    var o = JSON.parse(JSON.stringify(S));
    delete o.settled; delete o.id; o.friends.forEach(function (f) { delete f.upi; });          // never put UPI ids in a link
    return o;
  }
  function makeLink() {
    var bytes = new TextEncoder().encode(JSON.stringify(shareable())), base = location.href.split('#')[0];
    if (window.CompressionStream) return pump(new CompressionStream('deflate-raw'), bytes).then(function (z) { return base + '#b=' + toB64Url(z); });
    return Promise.resolve(base + '#j=' + toB64Url(bytes));
  }
  function readLink(hash) {
    var m = /^#([bj])=(.+)$/.exec(hash); if (!m) return Promise.resolve(null);
    var bytes; try { bytes = fromB64Url(m[2]); } catch (e) { return Promise.resolve(null); }
    var p = m[1] === 'b' ? (window.DecompressionStream ? pump(new DecompressionStream('deflate-raw'), bytes) : Promise.reject(new Error('nodecomp'))) : Promise.resolve(bytes);
    return p.then(function (u) { return B.normalize(JSON.parse(new TextDecoder().decode(u)), T.has); }).catch(function () { return null; });
  }
  function copyLink() {
    if (!/^https?:$/.test(location.protocol)) { toast('Bill links work once PayMate is hosted online (not from a local file)'); return; }
    makeLink().then(function (l) { return copyText(l).then(function () { toast('Link copied 🔗 — anyone can open this bill'); }); }).catch(function () { toast('Could not make the link'); });
  }
  $('btnLink').addEventListener('click', function () { if (!S.expenses.length) { toast('Add some expenses first'); return; } copyLink(); });

  function importFromHash() {
    if (!/^#[bj]=/.test(location.hash)) return Promise.resolve(false);
    var hash = location.hash;
    return readLink(hash).then(function (st) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (!st) { toast('That bill link looks damaged'); return false; }
      return confirmDialog('Open shared bill?', '“' + (st.title || 'Untitled bill') + '” — ' + st.friends.length + ' friends, ' + st.expenses.length + ' expenses. It opens as a new bill; your current one stays in “My bills”.', 'Open', false).then(function (y) {
        if (!y) return false; saveCurrentIfNeeded(); st.id = B.uid('b'); sampleUntouched = false; loadState(st); toast('Shared bill opened ✓'); return true;
      });
    });
  }

  /* =====================================================================
     11. MY BILLS (drafts), BACKUP / RESTORE, CLEAR
     ===================================================================== */
  function openDrafts() { drawDrafts(); go('draftsModal'); }
  function drawDrafts() {
    var list = ST.drafts().sort(function (a, b) { return b.updated - a.updated; }), h = '';
    list.forEach(function (d) {
      var st = B.normalize(d.state, T.has), c = B.compute(st), tp = T.get(st.template);
      h += '<li class="draft' + (d.id === S.id ? ' cur' : '') + '" data-id="' + d.id + '"><span class="tile t-indigo" aria-hidden="true">' + tp.emoji + '</span><div class="draft-t"><b>' + esc(d.title || 'Untitled bill') + '</b>' +
        '<small>' + B.inr(c.total) + ' · ' + st.friends.length + ' friends · ' + st.expenses.length + ' items · ' + esc(new Date(d.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })) + '</small></div>' +
        '<button class="btn btn-sm btn-soft" type="button" data-open="' + d.id + '">Open</button><button class="btn-icon btn-icon-sm" type="button" data-dup="' + d.id + '" aria-label="Duplicate" title="Duplicate">⧉</button><button class="btn-icon btn-icon-sm" type="button" data-rm="' + d.id + '" aria-label="Delete draft" title="Delete">🗑️</button></li>';
    });
    $('draftList').innerHTML = h || '<li class="empty"><span class="big">📚</span><b>No saved bills yet</b>Tap “Save current bill” to keep this one.</li>';
  }
  $('draftList').addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]'), dup = e.target.closest('[data-dup]'), rm = e.target.closest('[data-rm]');
    if (o) { var d = ST.getDraft(o.dataset.open); if (!d) return; saveCurrentIfNeeded(); sampleUntouched = false; loadState(d.state); closeModal('draftsModal'); toast('Opened “' + (d.title || 'Untitled bill') + '” ✓'); }
    else if (dup) { var s0 = ST.getDraft(dup.dataset.dup); if (!s0) return; var cp = B.normalize(s0.state, T.has); cp.id = B.uid('b'); cp.title = (cp.title || 'Untitled bill') + ' (copy)'; ST.saveDraft(cp); drawDrafts(); toast('Duplicated ✓'); }
    else if (rm) {
      var id = rm.dataset.rm; var dd = ST.getDraft(id);
      confirmDialog('Delete this saved bill?', '“' + (dd ? dd.title : 'Untitled bill') + '” will be removed from this device.', 'Delete').then(function (y) { if (y) { ST.deleteDraft(id); drawDrafts(); toast('Deleted'); } });
    }
  });
  $('drSaveNow').addEventListener('click', function () { if (saveDraftNow()) drawDrafts(); });

  $('mBackup').addEventListener('click', function () {
    flushSave();
    var blob = new Blob([JSON.stringify(ST.exportAll(), null, 1)], { type: 'application/json' });
    X.download(blob, 'paymate-backup-' + B.today() + '.json'); toast('Backup downloaded 💾');
  });
  $('mRestore').addEventListener('click', function () { $('restoreFile').click(); });
  $('restoreFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = ''; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result); if (!d || d.app !== 'PayMate') throw new Error('x');
        var incoming = (Array.isArray(d.drafts) ? d.drafts : []).concat(d.state ? [{ id: d.state.id, title: d.state.title, updated: Date.now(), state: d.state }] : []);
        var map = {}; ST.drafts().forEach(function (x) { map[x.id] = x; });
        var n = 0;
        incoming.forEach(function (x) { if (!x || !x.state) return; var st = B.normalize(x.state, T.has); if (!st.friends.length && !st.expenses.length) return; map[st.id] = { id: st.id, title: st.title || 'Untitled bill', updated: +x.updated || Date.now(), state: st }; n++; });
        ST.set('drafts', Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.updated - a.updated; }).slice(0, 60));
        toast(n ? n + ' bill' + (n > 1 ? 's' : '') + ' restored into “My bills” ✓' : 'That backup had no bills in it'); if (n) openDrafts();
      } catch (e) { toast('That file is not a PayMate backup'); }
    };
    r.readAsText(f);
  });
  $('mDrafts').addEventListener('click', openDrafts);

  $('btnClearAll').addEventListener('click', function () {
    confirmDialog('Clear all saved data?', 'This deletes the current bill, every saved draft and your settings from this browser. It cannot be undone.', 'Delete everything').then(function (y) {
      if (!y) return;
      ST.clearAll(); closeModal('moreModal', { noBack: false });
      S = B.blank(); sampleUntouched = false; zoom = 1; afterLoad(false); applyTheme(autoTheme(), true);
      toast('All saved data cleared 🧹');
    });
  });

  /* =====================================================================
     12. MORE MENU, DEVELOPER, DONATE, SUGGESTIONS, INSTALL, THEME
     ===================================================================== */
  var NOTES = {
    en: 'PayMate started with one simple idea: friends should not waste time calculating who paid what and who owes how much. Whether it is a market trip, canteen bill, college trip, or hostel expense, PayMate keeps everything clear. If you find it useful, share it with your friends. Your feedback means a lot to me.',
    hi: 'PayMate ek simple idea se shuru hua: friends ko time waste nahi karna chahiye ye calculate karne mein ki kisne kitna diya aur kaun kitna dega. Market trip ho, canteen ka bill ho, college trip ho ya hostel ka kharcha—PayMate sab kuch clear rakhta hai. Agar app useful lage to apne friends ke saath share karna. Aapka feedback mere liye bahut matter karta hai.'
  };
  document.querySelector('.seg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-note]'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
    $('noteText').textContent = NOTES[b.dataset.note]; $('noteText').lang = b.dataset.note === 'hi' ? 'hi-Latn' : 'en';
  });
  $('moreBtn').addEventListener('click', function () { openModal('moreModal'); });
  $('footDev').addEventListener('click', function () { openModal('moreModal'); });

  /* ---- theme ---- */
  function autoTheme() { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function applyTheme(t, noSave) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0e1030' : '#4f46e5');
    $('themeBtn').firstElementChild.textContent = t === 'dark' ? '☀️' : '🌙';
    $('mThemeSub').textContent = t === 'dark' ? 'Dark' : 'Light';
    if (!noSave) ST.setSetting('theme', t);
  }
  function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
  $('themeBtn').addEventListener('click', toggleTheme);
  $('mTheme').addEventListener('click', toggleTheme);

  /* ---- share the app itself ---- */
  $('mShareApp').addEventListener('click', function () {
    var url = CFG.siteUrl || location.origin + location.pathname, text = 'PayMate — free expense bills for friends. Split smart. Settle easy.';
    if (navigator.share && /^https?:$/.test(location.protocol)) navigator.share({ title: 'PayMate', text: text, url: url }).catch(function () {});
    else copyText(text + ' ' + url).then(function () { toast('Link copied — send it to your friends 🎁'); });
  });
  $('mLink').addEventListener('click', function () { if (!S.expenses.length) { toast('Add some expenses first'); return; } copyLink(); });
  $('mKeys').addEventListener('click', function () { go('keysModal'); });

  /* ---- donate (UPI QR) ---- */
  function donateAmount() { return Math.max(0, parseFloat(String($('dnAmount').value).replace(/[^\d.]/g, '')) || 0); }
  function refreshDonate() {
    var D = CFG.donate, amt = donateAmount();
    var link = 'upi://pay?pa=' + encodeURIComponent(D.upi) + '&pn=' + encodeURIComponent(D.payee) + (amt > 0 ? '&am=' + amt.toFixed(2) : '') + '&cu=INR&tn=' + encodeURIComponent(D.note);
    $('dnUpi').textContent = D.upi; $('dnPayee').textContent = D.payee;
    $('dnLink').href = link; $('dnLink').textContent = amt > 0 ? '📱 Pay ₹' + amt + ' in UPI app' : '📱 Open in UPI app';
    $('dnQr').innerHTML = qrSvg(link);
    $('dnNote').textContent = amt > 0 ? 'QR and button are set to ₹' + amt + '. Thank you so much! 🙏' : 'Scan with any UPI app and pay any amount you like — or pick one above. Thank you! 🙏';
    Array.prototype.forEach.call($('dnChips').children, function (b) { b.classList.toggle('on', +b.dataset.a === amt); });
  }
  $('dnChips').innerHTML = CFG.donate.presets.map(function (a) { return '<button type="button" data-a="' + a + '">₹' + a + '</button>'; }).join('');
  $('dnChips').addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) { $('dnAmount').value = b.dataset.a; refreshDonate(); } });
  $('dnAmount').addEventListener('input', refreshDonate);
  $('dnCopy').addEventListener('click', function () { copyText(CFG.donate.upi).then(function () { toast('UPI ID copied: ' + CFG.donate.upi); }, function () { toast('UPI ID: ' + CFG.donate.upi); }); });
  function openDonate() { refreshDonate(); stack.length ? go('donateModal') : openModal('donateModal'); }
  $('openDonate').addEventListener('click', openDonate); $('footDonate').addEventListener('click', openDonate);

  /* ---- suggestions → developer's e-mail (FormSubmit, mail-app fallback) ---- */
  function sgStatus(msg, kind) { var el = $('sgStatus'); el.textContent = msg; el.className = 'form-status ' + (kind || ''); }
  function openSuggest() { sgStatus('', ''); stack.length ? go('suggestModal') : openModal('suggestModal'); }
  $('openSuggest').addEventListener('click', openSuggest); $('footSuggest').addEventListener('click', openSuggest);
  $('sgForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('sgHoney').value) return;
    var type = $('sgType').value, name = $('sgName').value.trim(), email = $('sgEmail').value.trim(), msg = $('sgMessage').value.trim(), btn = $('sgSubmit');
    if (msg.length < 10) { sgStatus('Please write at least 10 characters so I can understand your idea.', 'error'); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { sgStatus('That email address looks wrong — fix it or leave it empty.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    var subject = 'PayMate · ' + type + (name ? ' from ' + name : '');
    var payload = { _subject: subject, _captcha: 'false', _template: 'table', _honey: '', Type: type, Name: name || 'Not provided', Email: email || 'Not provided', Message: msg };
    if (email) payload._replyto = email;
    fetch(CFG.feedback.endpoint + CFG.feedback.email, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.success === false || d.success === 'false') throw new Error('send'); }); })
      .then(function () { $('sgForm').reset(); sgStatus('✅ Thank you! Your message reached the developer.', 'success'); toast('Suggestion sent. Thank you! 🙏'); })
      .catch(function () {
        var body = 'Type: ' + type + '\nName: ' + (name || 'Not provided') + '\nEmail: ' + (email || 'Not provided') + '\n\n' + msg;
        sgStatus('Direct sending is not available right now — your email app opens with the message ready.', 'info');
        window.location.href = 'mailto:' + CFG.feedback.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      })
      .then(function () { btn.disabled = false; btn.textContent = 'Send ↗'; });
  });

  /* ---- install ---- */
  function syncInstall() { $('installPill').hidden = PW.isStandalone() || !(PW.canPrompt() || PW.isIOS()); }
  function installGuide(ios) {
    $('inTitle').textContent = ios ? 'Install on iPhone / iPad' : 'Install PayMate';
    $('inBody').innerHTML = ios
      ? '<ol class="guide"><li>Open PayMate in <b>Safari</b> (iPhone installs only from Safari).</li><li>Tap the <b>Share</b> button <b>⬆︎</b> at the bottom of the screen.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b> — PayMate now opens like a real app, even offline ✅</li></ol>'
      : '<ol class="guide"><li><b>Chrome / Edge (computer):</b> click the install icon at the right of the address bar, or open <b>⋮ → Install PayMate</b>.</li><li><b>Android Chrome:</b> <b>⋮ → Install app</b> / <b>Add to Home screen</b>.</li><li><b>Other browsers:</b> open the browser menu and choose <b>Add to Home screen</b>.</li></ol><p class="hint">Installing is optional — PayMate also works fine in the browser.</p>';
    stack.length ? go('installModal') : openModal('installModal');
  }
  function doInstall() {
    PW.install().then(function (r) {
      if (r === 'installed') toast('PayMate is already installed ✅');
      else if (r === 'accepted') toast('Installing PayMate… 🎉');
      else if (r === 'guide') installGuide(PW.isIOS());
    });
  }
  $('installPill').addEventListener('click', doInstall); $('mInstall').addEventListener('click', doInstall);
  PW.on(function (type, data) {
    if (type === 'installable' || type === 'installed') { syncInstall(); if (type === 'installed') toast('PayMate installed 🎉'); }
    else if (type === 'update') { $('updateBar').hidden = false; }
    else if (type === 'offline') { $('offlineDot').hidden = false; }
    else if (type === 'online') { $('offlineDot').hidden = true; }
  });
  $('updateBtn').addEventListener('click', function () { PW.applyUpdate(); });

  /* =====================================================================
     13. SCROLL BUTTON, CONFETTI, SHORTCUTS
     ===================================================================== */
  (function () {
    var fab = $('scrollFab'), ticking = false;
    function update() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight, y = window.scrollY;
      fab.hidden = max < 260;
      var up = y > max / 2;
      fab.classList.toggle('up', up); fab.setAttribute('aria-label', up ? 'Scroll to top' : 'Scroll to bottom');
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    fab.addEventListener('click', function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: window.scrollY > max / 2 ? 0 : max, behavior: 'smooth' });
    });
    setInterval(update, 1500);
    PM._scrollUpdate = update;
  })();

  function celebrate() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = $('confetti'), ctx = cv.getContext('2d'), W = cv.width = window.innerWidth, H = cv.height = window.innerHeight;
    var cols = ['#4f46e5', '#14b8a6', '#f5a524', '#ef5b4a', '#ec4899', '#22c55e'], ps = [];
    for (var i = 0; i < 110; i++) ps.push({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .75, vx: (Math.random() - .5) * 12, vy: -Math.random() * 15 - 6, s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length] });
    var t0 = performance.now();
    (function frame(t) {
      var dt = t - t0; ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - dt / 2600); ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); ctx.restore(); });
      if (dt < 2600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
    var mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveDraftNow(); }
    else if (mod && k === 'p') { e.preventDefault(); if (guardExport()) X.print(paperNode()); }
    else if (mod && !typing && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (mod && !typing && k === 'y') { e.preventDefault(); doRedo(); }
    else if (!mod && !typing && !stack.length && k === 'n') { e.preventDefault(); openExpense(); }
  });

  /* =====================================================================
     14. START-UP
     ===================================================================== */
  function init() {
    // developer card + version come from js/config.js
    var D = CFG.developer;
    $('devName').textContent = D.name; $('devRole').textContent = D.role; $('devAvatar').textContent = D.initials; $('devTag').textContent = D.tagline;
    $('footDev').textContent = D.name; $('verText').textContent = 'v' + CFG.version;

    applyTheme(document.documentElement.getAttribute('data-theme') || autoTheme(), true);
    buildPicker();

    // load the saved bill, or show a friendly sample the very first time
    var saved = ST.get('state', null), settings = ST.settings();
    if (saved && typeof saved === 'object' && (saved.friends || []).length + (saved.expenses || []).length + String(saved.title || '').length > 0) {
      S = B.normalize(saved, T.has);
      sampleUntouched = !!settings.sampleId && settings.sampleId === S.id && settings.sampleSnap === JSON.stringify(S);
    } else {
      S = B.normalize(B.sample(), T.has);
      var s = ST.settings(); s.sampleId = S.id; s.sampleSnap = JSON.stringify(S); s.tipClosed = false; ST.set('settings', s);
      sampleUntouched = true;
    }
    afterLoad(false);
    syncInstall();

    PW.init();
    importFromHash();
    window.addEventListener('hashchange', importFromHash);

    // shortcuts from the installed app icon (?action=new / ?action=add)
    var act = new URLSearchParams(location.search).get('action');
    if (act) { try { history.replaceState(null, '', location.pathname); } catch (e) {} if (act === 'new') newBill(); else if (act === 'add') setTimeout(openExpense, 300); }

    document.documentElement.classList.add('ready');
    if (PM._scrollUpdate) PM._scrollUpdate();
  }
  init();

  // handy for testing / console tinkering
  PM.app = { state: function () { return S; }, calc: function () { return calc; }, openExpense: openExpense };
})(window.PayMate = window.PayMate || {});
