/* Offline.
   The shell — markup, styles, scripts, the font, the icons — is precached on
   install and served from cache first, because it only changes when a new
   version ships. Everything else goes to the network first.

   A new version is never swapped in underneath someone mid-session: it waits
   until the page asks. The page asks after telling them. */

/* Bump this whenever anything in SHELL changes: it is what makes the new
   version install, sweep the old cache and offer itself to the open page. */
var VERSION = 'pip-v3';

/* The app's own code is asked for over the network first, with the cache as
   the answer when there is no network. Cache-first was wrong for it: a fix
   pushed to the site reached an installed browser a load late, so the app went
   on running yesterday's code while its author wondered why nothing had
   changed. Fonts and pictures stay cache-first -- they do not change, and they
   are the slow ones. */
var CODE = /\.(?:js|css|html|webmanifest)$/;
var NET_WAIT = 3000;

function fromNetwork(request, wait) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) { settled = true; reject(new Error('slow')); }
    }, wait);
    fetch(request).then(function (res) {
      clearTimeout(timer);
      if (settled) {                            // too late to be used, still worth keeping
        if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(request, res.clone()); });
        return;
      }
      settled = true;
      resolve(res);
    }).catch(function (err) {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}
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

/* Take over as soon as the new copy is installed, rather than waiting for
   every tab to close. Waiting sounds polite and is how an app gets stuck: the
   old worker keeps answering while a tab stays open, and if the old worker is
   the one with the bug, no amount of reloading escapes it. Nothing on screen
   changes underneath anyone -- the page keeps the code it loaded with; it is
   the next load that is new. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
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
  // so the app can say out loud which version of itself it is running
  if (event.data === 'version' && event.ports && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // supabase and the cdn are not ours to cache

  /* A page, or the code that makes it work: the network first, and whatever is
     in the cache the moment the network is slow or gone. */
  if (request.mode === 'navigate' || CODE.test(url.pathname) || url.pathname === '/') {
    event.respondWith(
      fromNetwork(request, NET_WAIT).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(request, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || (request.mode === 'navigate' ? caches.match('./app/index.html') : Response.error());
        });
      })
    );
    return;
  }

  /* Everything else -- fonts, icons, pictures -- is the same every time it is
     asked for, so the cache answers and the network only fills the gaps. */
  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) return hit;
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
