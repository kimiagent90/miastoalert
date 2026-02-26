const CACHE_NAME = 'miastoalert-static-v1'
const OFFLINE_URL = '/offline.html'

const ASSETS = [
  '/',
  '/index.html',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS)
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const { request } = event
  const isNavigation =
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept')?.includes('text/html'))

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        const offline = await cache.match(OFFLINE_URL)
        return offline || Response.error()
      }),
    )
    return
  }

  if (request.url.includes('/api/')) {
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse
          }
          const responseClone = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone))
          return networkResponse
        }),
    ),
  )
})

