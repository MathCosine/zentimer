/* Offline.
   The shell — markup, styles, scripts, the font, the icons — is precached on
   install and served from cache first, because it only changes when a new
   version ships. Everything else goes to the network first.

   A new version is never swapped in underneath someone mid-session: it waits
   until the page asks. The page asks after telling them. */

/* Bump this whenever anything in SHELL changes: it is what makes the new
   version install, sweep the old cache and offer itself to the open page. */
var VERSION = 'pip-v2';
var SHELL = [
  './',
  './index.html',
  './privacy.html',
  './app/',
  './app/index.html',
  './manifest.webmanifest',
  './assets/style.css',
  './assets/landing.css',
  './assets/config.js',
  './assets/music.js',
  './assets/sync.js',
  './assets/store.js',
  './assets/plan.js',
  './assets/settings.js',
  './assets/pet.js',
  './assets/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/fonts/fredoka-latin.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // one missing file must not fail the whole install
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          return name === VERSION ? null : caches.delete(name);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // supabase and the cdn are not ours to cache

  /* A navigation comes from the cache so it opens with no connection, and is
     refreshed in the background for next time. */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(function (hit) {
        var fresh = fetch(request).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(request, copy); });
          }
          return res;
        }).catch(function () { return hit || caches.match('./app/index.html'); });
        return hit || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) {
        // keep it current for next time without making anyone wait
        fetch(request).then(function (res) {
          if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(request, res); });
        }).catch(function () {});
        return hit;
      }
      return fetch(request).then(function (res) {
        if (res && res.ok && url.pathname.indexOf('/assets/') === 0) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(request, copy); });
        }
        return res;
      });
    })
  );
});
