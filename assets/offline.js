/* Registering the service worker, and the one piece of UI it needs: a line
   that says a new version is ready, because a page that silently swaps its own
   code underneath you is worse than one that asks. */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  // the worker lives at the site root so it can cover both the front page and /app/
  var root = location.pathname.indexOf('/app/') === 0 ? '../sw.js' : './sw.js';

  function offerReload(worker) {
    var bar = document.createElement('div');
    bar.className = 'update-bar';
    var text = document.createElement('span');
    text.textContent = 'a new version is ready';
    bar.appendChild(text);
    var go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'reload';
    go.addEventListener('click', function () {
      worker.postMessage('skip-waiting');
      // the new worker takes over, then the page comes back on the new code
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        location.reload();
      });
    });
    bar.appendChild(go);
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'update-later';
    no.textContent = 'later';
    no.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(no);
    document.body.appendChild(bar);
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(root).then(function (reg) {
      if (reg.waiting) offerReload(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', function () {
          // "installed" with a controller already present means an update, not a first run
          if (next.state === 'installed' && navigator.serviceWorker.controller) offerReload(next);
        });
      });
    }).catch(function () { /* offline is a nicety, not a requirement */ });
  });
})();
