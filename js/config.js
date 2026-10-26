/* =========================================================================
   PayMate — js/config.js
   The ONE file you edit to personalise the app (name, UPI id, e-mail, URL).
   Everything else reads from window.PayMate.CONFIG.
   ========================================================================= */
window.PayMate = window.PayMate || {};

window.PayMate.CONFIG = {
  appName: 'PayMate',
  tagline: 'Split smart. Settle easy.',
  version: '1.0.0',

  // Public link of your deployed site (used in the WhatsApp text & "Share PayMate").
  // Leave empty to use whatever address the app is currently opened from.
  siteUrl: '',

  // ---- Developer card ("Meet the Developer") --------------------------------
  developer: {
    name: 'ΣTΣЯПITY',
    initials: 'ΣT',
    role: 'Founder & Developer, PayMate',
    tagline: 'Building simple tools for students.'
  },

  // ---- Support the developer (optional UPI donation, shown as a QR code) ----
  donate: {
    upi: 'iamhk@ybl',        // UPI id that receives the donation
    payee: 'ETERNITY',       // plain-ASCII payee name used inside the UPI link (safest for UPI apps)
    presets: [10, 51, 101, 501],
    note: 'PayMate support'
  },

  // ---- Suggestion / bug-report form -----------------------------------------
  // Sent through FormSubmit (free). The very first message triggers a one-time
  // "activate" e-mail to this address — click it once and every later message arrives normally.
  feedback: {
    email: 'iamhk.sah@gmail.com',
    endpoint: 'https://formsubmit.co/ajax/'
  },

  // ---- Export libraries (loaded only when someone taps Download) ------------
  // Tried in order. Drop html2canvas.min.js / jspdf.umd.min.js into js/vendor/
  // to make exports work offline from the very first visit.
  libs: {
    html2canvas: [
      'js/vendor/html2canvas.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    ],
    jspdf: [
      'js/vendor/jspdf.umd.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
    ]
  }
};
