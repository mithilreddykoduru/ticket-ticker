const CACHE_NAME = 'ticket-ticker-v1'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/storage.js',
  '/js/model.js',
  '/js/sample.js',
  '/js/importer.js',
  '/js/app.js',
  '/data/template.json',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/icons/apple-touch-icon.png'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('Pre-cache partial failure:', err)
      })
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)

  // Don't intercept non-GET requests
  if (req.method !== 'GET') return

  // Navigation requests (HTML pages): Network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match('/index.html') || caches.match('/'))
    )
    return
  }

  // Google Fonts or static assets: Cache-first with runtime caching
  if (url.origin === location.origin || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached
        return fetch(req).then(networkRes => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            const copy = networkRes.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy))
          }
          return networkRes
        })
      })
    )
  }
})
