/* =========================================================================
   PayMate — js/storage.js
   A tiny, safe wrapper around localStorage. Everything PayMate remembers lives
   under the "paymate.v1." prefix, on THIS device only — nothing is ever uploaded.

   Keys
     paymate.v1.state     the bill currently being edited (auto-saved)
     paymate.v1.drafts    the list of bills saved with "Save draft"
     paymate.v1.last      id of the most recently saved draft
     paymate.v1.settings  theme, WhatsApp options, tip dismissed, recent items …
   ========================================================================= */
(function (PM) {
  'use strict';

  var PREFIX = 'paymate.v1.';
  var MAX_DRAFTS = 60;
  var S = PM.store = {};

  // localStorage can be missing/blocked (private mode, strict settings): fall back to memory.
  var mem = {};
  var ok = (function () {
    try { var k = '__pm_test'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  })();
  S.persistent = ok;

  S.get = function (key, def) {
    try {
      var raw = ok ? window.localStorage.getItem(PREFIX + key) : mem[key];
      return raw == null ? def : JSON.parse(raw);
    } catch (e) { return def; }
  };
  /** Returns false when the browser refused (quota / private mode). */
  S.set = function (key, val) {
    try {
      var raw = JSON.stringify(val);
      if (ok) window.localStorage.setItem(PREFIX + key, raw); else mem[key] = raw;
      return true;
    } catch (e) { return false; }
  };
  S.remove = function (key) { try { if (ok) window.localStorage.removeItem(PREFIX + key); else delete mem[key]; } catch (e) {} };

  /* ------------------------------------------------------------- settings */
  S.settings = function () { var s = S.get('settings', {}); return s && typeof s === 'object' ? s : {}; };
  S.setSetting = function (k, v) { var s = S.settings(); s[k] = v; return S.set('settings', s); };

  /* ---------------------------------------------------------------- drafts */
  // A draft = { id, title, updated (ms), state }
  S.drafts = function () {
    var d = S.get('drafts', []);
    return Array.isArray(d) ? d.filter(function (x) { return x && x.id && x.state; }) : [];
  };
  S.saveDraft = function (state) {
    var list = S.drafts().filter(function (d) { return d.id !== state.id; });
    list.unshift({ id: state.id, title: state.title || 'Untitled bill', updated: Date.now(), state: JSON.parse(JSON.stringify(state)) });
    if (list.length > MAX_DRAFTS) list.length = MAX_DRAFTS;
    var good = S.set('drafts', list);
    if (good) S.set('last', state.id);
    return good;
  };
  S.getDraft = function (id) { var l = S.drafts(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; };
  S.deleteDraft = function (id) {
    var list = S.drafts().filter(function (d) { return d.id !== id; });
    S.set('drafts', list);
    if (S.get('last', null) === id) S.set('last', list[0] ? list[0].id : null);
  };
  /** The most recently saved draft (what "Resume last draft" opens), or null. */
  S.lastDraft = function () {
    var id = S.get('last', null), d = id ? S.getDraft(id) : null;
    if (d) return d;
    var l = S.drafts();
    return l.length ? l.slice().sort(function (a, b) { return b.updated - a.updated; })[0] : null;
  };

  /* ----------------------------------------------------- backup / clear all */
  S.exportAll = function () {
    return { app: 'PayMate', v: 1, exported: new Date().toISOString(), state: S.get('state', null), drafts: S.drafts(), settings: S.settings() };
  };
  S.keys = function () {
    var out = [];
    try { for (var i = 0; i < window.localStorage.length; i++) { var k = window.localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) out.push(k); } } catch (e) {}
    return out;
  };
  /** Removes everything PayMate saved (bills, drafts, settings). */
  S.clearAll = function () {
    S.keys().forEach(function (k) { try { window.localStorage.removeItem(k); } catch (e) {} });
    mem = {};
  };
})(window.PayMate = window.PayMate || {});
