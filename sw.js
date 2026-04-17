const CACHE = 'mikacosmica-1.21'
const ASSETS = [
  'index.html',
  'app.css',
  'app.js',
  'manifest.json',
  'repeat_icon.png',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' })))
  )
})

self.addEventListener('fetch', e => {
  // CSVはネットワーク優先（オフライン時はキャッシュにフォールバック）
  if (e.request.url.endsWith('.csv')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // アプリシェルはキャッシュ優先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  )
})
