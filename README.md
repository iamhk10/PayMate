# PayMate — Split smart. Settle easy.

Free expense-bill & split maker for students and friends. No login, no backend, no ads.
Pure HTML / CSS / JavaScript — everything stays in the visitor's browser.

## Edit your details — `js/config.js`
Developer name/role/tagline, donate UPI id + payee, feedback e-mail, site URL (used in WhatsApp text).
> Donate UPI is set to `XXX@ybl` — change it there if your real id is different.

## Releasing an update (PWA)
Change `VERSION` in `sw.js` (e.g. `paymate-v1.0.1`) and upload. Visitors see a "new version — Reload" bar.

## PDF / JPG libraries
html2canvas 1.4.1 and jsPDF 2.5.1 load from cdnjs (fallback jsDelivr) on first export and are then cached
for offline use. For offline-from-first-visit, drop `html2canvas.min.js` and `jspdf.umd.min.js` into `js/vendor/`
and add their local paths first in `CFG.libs` (js/config.js) and in the `SHELL` list of `sw.js`.

## Suggestion form
Uses FormSubmit → the first message triggers a one-time activation e-mail to the developer address. Falls back to the mail app.

## Features
8 bill templates (Campus Classic, Market Mate, Trip Mode, Café Chill, Party Pop, Minimal Pro, Chai Tapri, Neon Night)
with sticker packs · live A4 preview with auto-fit to one page · PDF (multi-page, rows never cut) · JPG · print ·
WhatsApp summary · exact paise maths with minimal settlements · "Whole ₹" rounding · paste-a-list quick add ·
undo / redo · settled ticks + confetti · UPI pay QR per settlement · drafts library · backup / restore ·
share-by-link · dark mode · installable & offline · keyboard shortcuts (N, Ctrl+S/Z/Y/P).

Files: `index.html`, `css/`, `js/` (config, storage, bill, templates, export, pwa, app), `fonts/`, `icons/`, `manifest.webmanifest`, `sw.js`.
