// AXIS service worker (cache names keep their original kl- prefix so nothing is lost): makes the app open offline.
const CACHE = 'kl-journal-v56';
const OCR = 'kl-ocr-v1';   // text reader files (~7 MB): kept across app updates
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/apple-touch-icon.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/favicon.png',
  './assets/hero-home.webp', './assets/hero-today.webp', './assets/hero-journal.webp',
  './assets/hero-spiritual.webp', './assets/hero-sessions.webp', './assets/hero-more.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OCR).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Pages: network first so updates show up, cache as fallback for offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Text reader: cache first in its own long-lived cache, so it works offline after the first use.
  if (url.origin === location.origin && /\/ocr\//.test(url.pathname)) {
    e.respondWith(caches.open(OCR).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  // Fonts and app files: cache first.
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    })));
  }
});

// Mindful Reset: a push from your Apps Script means a check-in is due. Pushes carry no content.
const MR_LINES = ['Return to what matters. Time for a quick check-in.', 'How are you doing? Water, a stretch, a breath?',
  'Still on track, or chasing perfection? Take a moment.', 'You’ve been at it a while. A short reset can help.',
  'Is this still the best use of your time?', 'A quick pause for your body and mind.'];
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    // a timed task due now? (the app keeps this list on the device; the push itself carries nothing)
    try {
      const c = await caches.open('kl-remind'), r = await c.match('./kl-remind.json'), list = r ? await r.json() : [], now = Date.now();
      const seenR = await c.match('./kl-remind-seen.json'), seen = seenR ? await seenR.json() : [];
      const due = list.filter(x => Math.abs(x.at - now) <= 11 * 60000 && !seen.includes(x.id + ':' + x.at));
      if (due.length) {
        await c.put('./kl-remind-seen.json', new Response(JSON.stringify(seen.concat(due.map(x => x.id + ':' + x.at)).slice(-200))));
        const x = due[0];
        return self.registration.showNotification('Task reminder', { body: x.t + (due.length > 1 ? ' (+' + (due.length - 1) + ' more)' : ''), tag: 'kl-task-' + x.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './?tk=' + encodeURIComponent(x.id) } });
      }
    } catch (err) {}
    const body = MR_LINES[Math.floor(Math.random() * MR_LINES.length)];
    return self.registration.showNotification('Mindful Reset', { body, tag: 'kl-mreset', icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './?mr=checkin' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const url = (e.notification.data && e.notification.data.url) || './?mr=checkin', tk = (url.match(/[?&]tk=([^&]+)/) || [])[1];
    for (const c of list) { if ('focus' in c) { c.postMessage(tk ? { type: 'tk-open', id: decodeURIComponent(tk) } : { type: 'mr-checkin' }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

// Share to AXIS (Android / desktop Chrome): keep the shared files on the device, then open Quick Capture.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'POST' || !/\/share-target$/.test(u.pathname)) return;
  e.respondWith((async () => {
    try {
      const f = await e.request.formData(), c = await caches.open('kl-share'), files = f.getAll('media').filter(x => x && x.size);
      for (let i = 0; i < files.length; i++) await c.put('./shared/f' + i, new Response(files[i], { headers: { 'content-type': files[i].type || 'application/octet-stream' } }));
      await c.put('./shared/meta.json', new Response(JSON.stringify({ title: f.get('title') || '', text: f.get('text') || '', url: f.get('url') || '', files: files.map(x => ({ name: x.name, type: x.type, lm: x.lastModified })) })));
    } catch (err) {}
    return Response.redirect('./?share=1', 303);
  })());
});

