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

  /* What the app knows about itself: which version is running, and a way to go
     and look for a newer one without waiting for the browser to wonder. */
  window.PipVersion = {
    running: function () {
      return new Promise(function (resolve) {
        var worker = navigator.serviceWorker.controller;
        if (!worker) { resolve(null); return; }
        var channel = new MessageChannel();
        var done = false;
        channel.port1.onmessage = function (e) { done = true; resolve(e.data || null); };
        try { worker.postMessage('version', [channel.port2]); } catch (e) { resolve(null); }
        setTimeout(function () { if (!done) resolve(null); }, 1200);
      });
    },
    look: function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) return 'not installed';
        return reg.update().then(function () {
          return reg.waiting || reg.installing ? 'a new version is on its way' : 'this is the latest';
        });
      }).catch(function () { return 'could not look just now'; });
    }
  };

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
