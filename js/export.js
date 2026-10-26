/* =========================================================================
   PayMate — js/export.js
   Turns the bill on screen into a PDF (A4), a high-quality JPG, a shareable
   file, or a print-out.

   - html2canvas + jsPDF are loaded from a CDN only when somebody taps Download
     (and cached by the service worker, so later downloads work offline).
   - The bill is captured from an off-screen, un-scaled copy so the file is always
     pixel-sharp, whatever zoom the on-screen preview is using.
   - Bills longer than one page are cut between rows (never through a line of text).
   ========================================================================= */
(function (PM) {
  'use strict';

  var X = PM.exporter = {};
  var CFG = (PM.CONFIG && PM.CONFIG.libs) || {};
  var A4_W = 210, A4_H = 297;        // mm

  /* ------------------------------------------------------------ loading */
  function loadScript(urls, isReady) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      (function next() {
        if (isReady()) return resolve();
        if (i >= urls.length) return reject(new Error('lib'));
        var s = document.createElement('script');
        s.src = urls[i++]; s.async = true;
        s.onload = function () { isReady() ? resolve() : next(); };
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
  }
  var hasCanvas = function () { return typeof window.html2canvas === 'function'; };
  var hasPdf = function () { return !!((window.jspdf && window.jspdf.jsPDF) || window.jsPDF); };

  /** need: 'canvas' (JPG) or 'pdf' (canvas + jsPDF). Rejects with Error('lib') when offline & not cached. */
  X.loadLibs = function (need) {
    var p = loadScript(CFG.html2canvas || [], hasCanvas);
    if (need === 'pdf') p = p.then(function () { return loadScript(CFG.jspdf || [], hasPdf); });
    return p;
  };

  // Make sure every font the bill uses is ready before the picture is taken.
  var FACES = ['400 16px "PM Poppins"', '500 16px "PM Poppins"', '700 16px "PM Poppins"', '400 16px "PM Adventor"', '700 16px "PM Adventor"',
    '700 16px "PM Schola"', '700 16px "PM Bonum"', '400 16px "PM Heros"', '700 16px "PM Heros"', '400 16px "PM Cursor"', '700 16px "PM Cursor"',
    'italic 500 16px "PM Chorus"', '500 16px "PM Lora"', '700 16px "PM Lora"', '400 16px "PM Symbols"'];
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(FACES.map(function (f) { return document.fonts.load(f, 'Aa₹→✓').catch(function () {}); }))
      .then(function () { return document.fonts.ready; }).catch(function () {});
  }
  var frames = function (n) { return new Promise(function (r) { (function t(k) { k <= 0 ? r() : requestAnimationFrame(function () { t(k - 1); }); })(n); }); };

  /* ------------------------------------------------------- off-screen copy */
  function mount(node) {
    var stage = document.getElementById('exportStage');
    stage.innerHTML = '';
    var clone = node.cloneNode(true);
    clone.style.transform = 'none'; clone.style.margin = '0'; clone.style.left = '0'; clone.style.top = '0'; clone.style.position = 'relative';
    clone.classList.add('pp-export');
    stage.appendChild(clone);
    return clone;
  }
  function unmount() { var s = document.getElementById('exportStage'); if (s) s.innerHTML = ''; }

  /** y positions (CSS px from the top of the bill) where a page may safely end. */
  function breakPoints(paper) {
    var top = paper.getBoundingClientRect().top, out = [];
    var sel = '.pp-hero, .pp-people, .pp-totals, .pp-note, .pp-table tbody tr, .pp-sts li, .pp-even, .pp-sec';
    Array.prototype.forEach.call(paper.querySelectorAll(sel), function (el) {
      var b = el.getBoundingClientRect().bottom - top;
      if (b > 40) out.push(Math.round(b) + 2);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // Keep the canvas under what phones can allocate (iOS Safari ≈ 16.7 M pixels).
  function pickScale(w, h, want) {
    var mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent), max = mobile ? 12e6 : 30e6, s = want;
    while (s > 1 && w * s * h * s > max) s -= 0.25;
    return Math.max(1, s);
  }

  /* ---------------------------------------------------------------- capture */
  /**
   * node: the .paper element. opts: { scale, bg }.
   * Resolves { canvas, scale, width, height, breaks }.
   */
  X.capture = function (node, opts) {
    opts = opts || {};
    var clone, w, h, s, breaks;
    return fontsReady().then(function () {
      clone = mount(node);
      return frames(2);
    }).then(function () {
      w = clone.offsetWidth; h = clone.offsetHeight;
      s = pickScale(w, h, opts.scale || 2);
      breaks = breakPoints(clone);
      return window.html2canvas(clone, {
        scale: s, useCORS: true, allowTaint: false, logging: false, backgroundColor: opts.bg || '#ffffff',
        width: w, height: h, windowWidth: w, windowHeight: h, scrollX: 0, scrollY: 0
      });
    }).then(function (canvas) {
      unmount();
      return { canvas: canvas, scale: canvas.width / w, width: w, height: h, breaks: breaks };
    }, function (err) { unmount(); throw err; });
  };

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [255, 255, 255];
    var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toBlob(canvas, type, q) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('blob')); }, type, q);
      else {
        try {
          var d = canvas.toDataURL(type, q).split(','), bin = atob(d[1]), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type }));
        } catch (e) { reject(e); }
      }
    });
  }

  /* -------------------------------------------------------------------- JPG */
  /** meta: { bg } — returns a Blob (image/jpeg). */
  X.makeJpg = function (node, meta) {
    meta = meta || {};
    return X.loadLibs('canvas').then(function () { return X.capture(node, { scale: 3, bg: meta.bg }); })
      .then(function (cap) { return toBlob(cap.canvas, 'image/jpeg', 0.95); });
  };

  /* -------------------------------------------------------------------- PDF */
  /** Where each PDF page starts/ends (CSS px). Cuts at the latest safe break that fits on the page. */
  X.planPages = function (height, width, breaks) {
    var pageH = width * A4_H / A4_W, cuts = [0], y = 0, guard = 0;
    while (height - y > pageH * 1.004 && guard++ < 200) {
      var limit = y + pageH, best = 0;
      for (var i = 0; i < breaks.length; i++) if (breaks[i] <= limit && breaks[i] > y + pageH * 0.55) best = breaks[i];
      y = best || limit;
      cuts.push(y);
    }
    cuts.push(height);
    return cuts;
  };

  /** meta: { bg } — returns a Blob (application/pdf) with one A4 page per slice. */
  X.makePdf = function (node, meta) {
    meta = meta || {};
    return X.loadLibs('pdf').then(function () { return X.capture(node, { scale: 2, bg: meta.bg }); }).then(function (cap) {
      var JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      var pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      var cuts = X.planPages(cap.height, cap.width, cap.breaks), rgb = hexToRgb(meta.bg), s = cap.scale;
      for (var p = 0; p < cuts.length - 1; p++) {
        var a = Math.round(cuts[p] * s), b = Math.round(cuts[p + 1] * s), hpx = Math.max(1, b - a);
        var slice = document.createElement('canvas');
        slice.width = cap.canvas.width; slice.height = hpx;
        var ctx = slice.getContext('2d');
        ctx.fillStyle = meta.bg || '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(cap.canvas, 0, a, cap.canvas.width, hpx, 0, 0, cap.canvas.width, hpx);
        var hmm = Math.min(A4_H, hpx * A4_W / cap.canvas.width);
        if (p > 0) pdf.addPage('a4', 'portrait');
        if (hmm < A4_H - 0.5) { pdf.setFillColor(rgb[0], rgb[1], rgb[2]); pdf.rect(0, 0, A4_W, A4_H, 'F'); }   // colour the rest of a short last page
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_W, hmm, undefined, 'FAST');
        slice.width = slice.height = 0;                                     // free memory early (phones!)
      }
      cap.canvas.width = cap.canvas.height = 0;
      return { blob: pdf.output('blob'), pages: cuts.length - 1 };
    });
  };

  /* ------------------------------------------------------ download / share */
  X.download = function (blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 8000);
  };

  X.canShareFile = function (blob, name) {
    try {
      if (!navigator.canShare || !navigator.share || typeof File === 'undefined') return false;
      return navigator.canShare({ files: [new File([blob], name, { type: blob.type })] });
    } catch (e) { return false; }
  };
  X.shareFile = function (blob, name, title, text) {
    var f = new File([blob], name, { type: blob.type });
    return navigator.share({ files: [f], title: title, text: text });
  };

  /* ------------------------------------------------------------------ print */
  // Fallback for "Save as PDF" when the libraries cannot load, and for real printers.
  X.print = function (node) {
    var m = document.getElementById('printMount');
    m.innerHTML = '';
    var c = node.cloneNode(true); c.style.transform = 'none'; c.classList.add('pp-export');
    m.appendChild(c);
    document.body.classList.add('is-printing');
    var done = function () { document.body.classList.remove('is-printing'); m.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(done, 1500); }, 60);
  };
})(window.PayMate = window.PayMate || {});
