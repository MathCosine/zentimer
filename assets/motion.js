/* The small movements: rows that slide to their new places instead of
   jumping, a tick that pops, a quiet burst of colour when the evening's work
   is done, and the notes that slide up from the bottom. All of it stands
   down when the system asks for less motion. */
window.Motion = (function () {
  'use strict';

  var still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function reduced() { return !!still.matches; }

  var SOFT = ['#f7b2c4', '#b8a6f5', '#9fd8c9', '#ffd98a', '#9ccaf5', '#f9c49a'];
  var EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  var SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

  function play(node, frames, options) {
    if (!node || !node.animate) return null;
    try { return node.animate(frames, options); } catch (e) { return null; }
  }

  /* ---------- a list that rearranges itself ---------- */

  /* Rows are found by a key attribute. Before a redraw, where every row was;
     after it, the ones still there glide from the old place to the new, the
     new ones fade in, and the ones that went fade out where they were. A
     redraw that throws every node away and builds new ones is fine: it is
     the key that is followed, not the node. */
  function flip(container, key, draw) {
    if (!container || reduced() || !container.isConnected || !container.offsetParent) { draw(); return; }
    var selector = '[' + key + ']';
    var before = {};
    var ghosts = [];
    var box = container.getBoundingClientRect();
    Array.prototype.forEach.call(container.querySelectorAll(selector), function (row) {
      var id = row.getAttribute(key);
      var r = row.getBoundingClientRect();
      if (r.bottom < box.top - 40 || r.top > box.bottom + 40) return;     // out of sight: nothing to show
      before[id] = { top: r.top, left: r.left, node: row };
    });
    var first = container.childElementCount === 0;
    var scrolled = container.scrollTop;

    draw();
    // emptying a list scrolls it to the top; where you were reading comes back
    // before anything is measured, or every row would seem to have moved
    if (scrolled) container.scrollTop = Math.min(scrolled, Math.max(0, container.scrollHeight - container.clientHeight));

    var after = {};
    var fresh = 0;
    Array.prototype.forEach.call(container.querySelectorAll(selector), function (row) {
      var id = row.getAttribute(key);
      after[id] = true;
      var was = before[id];
      if (!was) {
        if (!first && fresh < 6 && Object.keys(before).length) {
          fresh++;
          play(row, [{ opacity: 0, transform: 'translateY(-6px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
               { duration: 260, easing: EASE, delay: fresh * 25 });
        }
        return;
      }
      var r = row.getBoundingClientRect();
      var dy = was.top - r.top, dx = was.left - r.left;
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) return;
      if (Math.abs(dy) > window.innerHeight) return;
      play(row, [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
           { duration: 320, easing: SPRING });
    });

    /* what left goes out where it stood, over the rows sliding into its place */
    Object.keys(before).forEach(function (id) {
      if (after[id]) return;
      var was = before[id];
      var ghost = was.node.cloneNode(true);
      ghost.removeAttribute(key);
      ghost.classList.add('is-leaving');
      ghost.setAttribute('aria-hidden', 'true');
      var holder = container.getBoundingClientRect();
      ghost.style.position = 'absolute';
      ghost.style.left = (was.left - holder.left + container.scrollLeft) + 'px';
      ghost.style.top = (was.top - holder.top + container.scrollTop) + 'px';
      ghost.style.width = was.node.offsetWidth + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.margin = '0';
      container.appendChild(ghost);
      ghosts.push(ghost);
      var go = play(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(18px) scale(0.97)' }],
                    { duration: 300, easing: EASE, fill: 'forwards' });
      var gone = function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); };
      if (go) go.onfinish = gone; else gone();
      setTimeout(gone, 600);
    });
    return ghosts;
  }

  /* ---------- a tick that pops ---------- */

  function burst(anchor, tone) {
    if (!anchor || reduced()) return;
    var r = anchor.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var layer = document.createElement('div');
    layer.className = 'burst';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    var colours = tone ? [tone].concat(SOFT) : SOFT;
    for (var i = 0; i < 9; i++) {
      var dot = document.createElement('span');
      var angle = (Math.PI * 2 * i) / 9 + Math.random() * 0.4;
      var far = 16 + Math.random() * 12;
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      dot.style.background = colours[i % colours.length];
      if (i % 3 === 0) dot.className = 'is-star';
      layer.appendChild(dot);
      play(dot, [
        { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + Math.cos(angle) * far + 'px), calc(-50% + ' + Math.sin(angle) * far + 'px)) scale(1)', opacity: 1, offset: 0.6 },
        { transform: 'translate(calc(-50% + ' + Math.cos(angle) * (far + 6) + 'px), calc(-50% + ' + Math.sin(angle) * (far + 6) + 'px)) scale(0.2)', opacity: 0 }
      ], { duration: 560, easing: EASE, fill: 'forwards' });
    }
    play(anchor, [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
         { duration: 420, easing: SPRING });
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 700);
  }

  /* ---------- the evening's work, done ---------- */

  /* Not a party: a few dozen soft pieces, once, from the top, gone in under
     two seconds. */
  function confetti() {
    if (reduced()) return;
    var layer = document.createElement('div');
    layer.className = 'confetti';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    var wide = window.innerWidth;
    for (var i = 0; i < 34; i++) {
      var bit = document.createElement('span');
      var x = wide * (0.15 + Math.random() * 0.7);
      bit.style.left = x + 'px';
      bit.style.background = SOFT[i % SOFT.length];
      bit.style.width = (6 + Math.random() * 5) + 'px';
      bit.style.height = (8 + Math.random() * 6) + 'px';
      if (i % 4 === 0) bit.style.borderRadius = '50%';
      layer.appendChild(bit);
      var drift = (Math.random() - 0.5) * 160;
      var fall = window.innerHeight * (0.45 + Math.random() * 0.35);
      var turn = (Math.random() - 0.5) * 720;
      play(bit, [
        { transform: 'translate(0, -20px) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + drift + 'px, ' + fall + 'px) rotate(' + turn + 'deg)', opacity: 0 }
      ], { duration: 1300 + Math.random() * 600, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', delay: Math.random() * 180, fill: 'forwards' });
    }
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 2300);
  }

  /* ---------- notes from the bottom ---------- */

  var shelf = null;
  /* One at a time: a second note replaces the first rather than stacking. */
  function toast(text, action, options) {
    shelf = shelf || document.getElementById('toasts');
    if (!shelf) {
      shelf = document.createElement('div');
      shelf.className = 'toasts';
      shelf.id = 'toasts';
      shelf.setAttribute('aria-live', 'polite');
      document.body.appendChild(shelf);
    }
    var old = shelf.querySelector('.toast');
    if (old) old.remove();
    var note = document.createElement('div');
    note.className = 'toast' + (options && options.tone ? ' is-' + options.tone : '');
    var words = document.createElement('span');
    words.className = 'toast-text';
    words.textContent = text;
    note.appendChild(words);
    if (action) {
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'toast-go';
      go.textContent = action.label;
      go.addEventListener('click', function () { action.run(); leave(); });
      note.appendChild(go);
    }
    shelf.appendChild(note);
    var timer = setTimeout(leave, (options && options.ms) || 5200);
    function leave() {
      clearTimeout(timer);
      if (!note.parentNode) return;
      var out = reduced() ? null : play(note, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(0.96)' }],
                                       { duration: 200, easing: EASE, fill: 'forwards' });
      var gone = function () { if (note.parentNode) note.parentNode.removeChild(note); };
      if (out) out.onfinish = gone; else gone();
    }
    return { close: leave, node: note };
  }

  /* ---------- a panel under the button that opened it ---------- */

  function place(pop, anchor) {
    if (!pop || !anchor) return;
    var r = anchor.getBoundingClientRect();
    var wide = Math.min(pop.offsetWidth || 260, window.innerWidth - 16);
    var right = Math.max(8, window.innerWidth - r.right - 4);
    if (window.innerWidth - right - wide < 8) right = Math.max(8, window.innerWidth - wide - 8);
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.right = Math.round(right) + 'px';
    pop.style.left = 'auto';
    var origin = Math.max(12, Math.min(wide - 12, wide - (window.innerWidth - right - (r.left + r.width / 2))));
    pop.style.transformOrigin = origin + 'px 0';
  }

  /* ---------- opening something in place ---------- */

  function grow(node) {
    if (!node || reduced() || node.hidden) return;
    play(node, [{ opacity: 0, transform: 'translateY(-4px)', clipPath: 'inset(0 0 100% 0)' },
                { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }],
         { duration: 240, easing: EASE });
  }

  function nudge(node) {
    if (!node || reduced()) return;
    play(node, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' },
                { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: EASE });
  }

  return { reduced: reduced, flip: flip, burst: burst, confetti: confetti, toast: toast, place: place, grow: grow, nudge: nudge, play: play };
})();
