/* =========================================================================
   PayMate — js/pwa.js
   Progressive-Web-App glue:
     • registers sw.js (offline use + instant start)
     • tells the app when a NEW version is waiting ("Reload" bar)
     • online / offline indicator
     • "Install app" — native prompt where available, step-by-step guide on iPhone
   Everything is relative so it works from a GitHub Pages sub-folder.
   ========================================================================= */
(function (PM) {
  'use strict';

  var P = PM.pwa = {};
  var deferred = null, listeners = [], reloading = false, registration = null;

  P.isStandalone = function () {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  };
  P.isIOS = function () {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  /** true when the browser can show its own install dialog right now */
  P.canPrompt = function () { return !!deferred; };
  P.on = function (fn) { listeners.push(fn); };
  function emit(type, data) { listeners.forEach(function (fn) { try { fn(type, data); } catch (e) {} }); }

  /* ------------------------------------------------------------- install */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; emit('installable'); });
  window.addEventListener('appinstalled', function () { deferred = null; emit('installed'); });

  /** Resolves 'accepted' | 'dismissed' | 'installed' | 'guide' (caller should show the how-to). */
  P.install = function () {
    if (P.isStandalone()) return Promise.resolve('installed');
    if (deferred) {
      var d = deferred; deferred = null;
      d.prompt();
      return d.userChoice.then(function (c) { return c.outcome; }, function () { return 'dismissed'; });
    }
    return Promise.resolve('guide');
  };

  /* ------------------------------------------------------ service worker */
  P.init = function () {
    window.addEventListener('online', function () { emit('online'); });
    window.addEventListener('offline', function () { emit('offline'); });
    if (navigator.onLine === false) emit('offline');

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      registration = reg;
      // A new version downloaded while an old one is running → offer a reload.
      if (reg.waiting && navigator.serviceWorker.controller) emit('update', reg);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) emit('update', reg);
        });
      });
      // look for updates now and whenever the tab comes back to the foreground
      var check = function () { try { reg.update(); } catch (e) {} };
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      setInterval(check, 60 * 60 * 1000);
    }).catch(function () { /* the app works fine without the worker */ });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return; reloading = true; window.location.reload();
    });
  };

  /** Called when the user taps "Reload" on the update bar. */
  P.applyUpdate = function () {
    if (registration && registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
    else window.location.reload();
  };
})(window.PayMate = window.PayMate || {});
