/* The garden: every study session grows a plant, and every five plants in a
   week grow into a tree.

   A plant is a record of a session -- when, how long, and the seed it grew
   from (which decides what kind it is and how it looks). Kept in this browser
   and, once you are signed in, with your account, so every device grows the
   same garden. Trees are never stored: they are the week's plants, five at a
   time, so they can never disagree with them.

   Garden.add({ seed, mins, task })  a finished session; returns { plant, tree }
   Garden.last()                     the newest plant
   Garden.weeks()                    each week: its trees, and plants not yet in one
   Garden.paintSill(el)              this week's plants, small, under the timer
   Garden.open() / close()           the garden itself                         */
window.Garden = (function () {
  'use strict';

  var KEY = 'pip.garden.v1';
  var PER_TREE = 5;          // plants in a week that grow into a tree
  var LEAST = 5;             // minutes: less than this is not a session, it is a false start
  var TREE_FULL = 600;       // minutes in a tree's five plants for it to be fully grown

  var plants = read();
  var listeners = [];
  var el = {};

  function read() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list.filter(valid) : [];
    } catch (e) { return []; }
  }

  function valid(p) {
    return p && typeof p.id === 'string' && typeof p.mins === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(String(p.day));
  }

  function signedIn() {
    try { return !!(window.Store && Store.remote && Store.remote.signedIn()); } catch (e) { return false; }
  }

  function keep(share) {
    plants.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    try { localStorage.setItem(KEY, JSON.stringify(plants)); } catch (e) { /* private mode: this visit only */ }
    if (share && signedIn() && window.Sync && Sync.setPref) {
      Promise.resolve(Sync.setPref('garden', plants.slice(-3000))).catch(function () {});
    }
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* Another device's plants, added to this one's: each once, by its seed. If
     this device had some the account did not, they go back up. */
  var adopted = false;
  function adopt() {
    if (adopted || !signedIn() || !window.Sync || !Sync.getPref) return;
    adopted = true;
    Promise.resolve(Sync.getPref('garden')).then(function (theirs) {
      if (!Array.isArray(theirs)) theirs = [];
      var have = {}, mine = {};
      plants.forEach(function (p) { have[p.id] = true; });
      theirs.forEach(function (p) { if (valid(p)) mine[p.id] = true; });
      var fresh = theirs.filter(function (p) { return valid(p) && !have[p.id]; });
      var missing = plants.some(function (p) { return !mine[p.id]; });
      if (fresh.length) plants = plants.concat(fresh);
      if (fresh.length || missing) keep(missing);
    }, function () { adopted = false; });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // the Monday of the week a day is in
  function weekOf(day) {
    var d = new Date(day + 'T12:00');
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return Store.dayKey(d);
  }

  function treeOf(week, group, index) {
    var mins = group.reduce(function (sum, p) { return sum + p.mins; }, 0);
    var seed = week + ':' + index + ':' + group[0].id;
    return { seed: seed, kind: Plants.pickTree(seed), g: clamp(Math.sqrt(mins / TREE_FULL), 0.3, 1),
      mins: mins, plants: group, week: week, at: group[group.length - 1].at };
  }

  function add(o) {
    var mins = Math.round(Number(o && o.mins) || 0);
    if (!o || !o.seed || mins < LEAST) return null;
    if (plants.some(function (p) { return p.id === o.seed; })) return null;
    var plant = { id: String(o.seed), at: Date.now(), day: Store.dayKey(), mins: Math.min(mins, 720),
      kind: Plants.pick(o.seed), task: o.task ? String(o.task).slice(0, 80) : '' };
    plants.push(plant);
    keep(true);
    var week = weekOf(plant.day);
    var mine = plants.filter(function (p) { return weekOf(p.day) === week; });
    var tree = mine.length % PER_TREE === 0
      ? treeOf(week, mine.slice(-PER_TREE), mine.length / PER_TREE - 1) : null;
    return { plant: plant, tree: tree };
  }

  function weeks() {
    var by = {};
    plants.forEach(function (p) { var w = weekOf(p.day); (by[w] = by[w] || []).push(p); });
    return Object.keys(by).sort().reverse().map(function (week) {
      var list = by[week].slice().sort(function (a, b) { return a.at - b.at; });
      var trees = [];
      for (var i = 0; i + PER_TREE <= list.length; i += PER_TREE) trees.push(treeOf(week, list.slice(i, i + PER_TREE), i / PER_TREE));
      return { week: week, plants: list, trees: trees, loose: list.slice(trees.length * PER_TREE),
        mins: list.reduce(function (sum, p) { return sum + p.mins; }, 0) };
    });
  }

  function thisWeek() {
    var key = weekOf(Store.dayKey());
    return weeks().filter(function (w) { return w.week === key; })[0] || { week: key, plants: [], trees: [], loose: [], mins: 0 };
  }

  /* ---------- words ---------- */

  function span(mins) {
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }

  function dayName(day) {
    return new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase();
  }

  function weekName(week) {
    if (week === weekOf(Store.dayKey())) return 'this week';
    return 'week of ' + new Date(week + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toLowerCase();
  }

  function aOrAn(word) { return /^[aeiou]/i.test(word) ? 'an ' + word : 'a ' + word; }

  function toGo(n) {
    return n === 1 ? 'one more session grows a tree' : (n === PER_TREE ? 'five sessions grow a tree' : n + ' more sessions grow a tree');
  }

  /* ---------- drawing ---------- */

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function plantTile(p, small) {
    var tile = node('div', 'g-plant' + (small ? ' is-small' : ''));
    tile.innerHTML = Plants.svg({ kind: p.kind, seed: p.id, g: Plants.growthFor(p.mins), label: aOrAn(Plants.name(p.kind)) });
    tile.title = Plants.name(p.kind) + ' · ' + span(p.mins) + ' · ' + dayName(p.day) + (p.task ? ' · ' + p.task : '');
    if (!small) {
      tile.appendChild(node('span', 'g-name', Plants.name(p.kind)));
      tile.appendChild(node('span', 'g-mins', span(p.mins)));
    }
    return tile;
  }

  function treeTile(t) {
    var tile = node('div', 'g-tree');
    tile.innerHTML = Plants.tree({ kind: t.kind, seed: t.seed, g: t.g, label: aOrAn(Plants.name(t.kind)) });
    tile.title = Plants.name(t.kind) + ' · five sessions, ' + span(t.mins) + ' · ' + weekName(t.week);
    tile.appendChild(node('span', 'g-name', Plants.name(t.kind)));
    tile.appendChild(node('span', 'g-mins', span(t.mins)));
    return tile;
  }

  // the empty places on the sill, one for each plant still to come
  function slots(n, cls) {
    var row = document.createDocumentFragment();
    for (var i = 0; i < n; i++) row.appendChild(node('span', cls));
    return row;
  }

  /* Under the timer: this week's plants not yet in a tree, and the places
     waiting for the rest. */
  function paintSill(box) {
    if (!box) return;
    var week = thisWeek();
    var key = week.loose.map(function (p) { return p.id; }).join() + '|' + week.trees.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    var row = node('span', 'sill-row');
    week.loose.forEach(function (p) { row.appendChild(plantTile(p, true)); });
    row.appendChild(slots(PER_TREE - week.loose.length, 'sill-slot'));
    box.appendChild(row);
    var words = week.trees.length
      ? week.trees.length + (week.trees.length === 1 ? ' tree' : ' trees') + ' this week · ' + toGo(PER_TREE - week.loose.length)
      : toGo(PER_TREE - week.loose.length);
    box.appendChild(node('span', 'sill-words', words));
    box.title = 'Your garden';
  }

  function render() {
    if (!el.body) return;
    var body = el.body;
    body.textContent = '';
    var all = weeks();
    var total = plants.reduce(function (sum, p) { return sum + p.mins; }, 0);
    var trees = all.reduce(function (sum, w) { return sum + w.trees.length; }, 0);

    if (!plants.length) {
      var empty = node('div', 'g-empty');
      empty.innerHTML = Plants.svg({ kind: 'fern', seed: 'first', g: 0 });
      empty.appendChild(node('p', 'g-lede', 'every study session grows a plant — the longer you go, the taller it gets'));
      empty.appendChild(node('p', 'g-note', 'five plants in a week grow into a tree'));
      body.appendChild(empty);
      return;
    }

    body.appendChild(node('p', 'g-sum', plants.length + (plants.length === 1 ? ' plant' : ' plants') + ' · ' +
      trees + (trees === 1 ? ' tree' : ' trees') + ' · ' + span(total) + ' grown'));

    // this week first: its trees, and the plants on their way to the next
    var now = thisWeek();
    var head = node('div', 'g-head');
    head.appendChild(node('h3', null, 'this week'));
    head.appendChild(node('span', 'g-note', toGo(PER_TREE - now.loose.length)));
    body.appendChild(head);
    var shelf = node('div', 'g-shelf');
    now.trees.forEach(function (t) { shelf.appendChild(treeTile(t)); });
    now.loose.forEach(function (p) { shelf.appendChild(plantTile(p)); });
    shelf.appendChild(slots(PER_TREE - now.loose.length, 'g-slot'));
    body.appendChild(shelf);

    // and every tree there has ever been, on one stretch of ground
    var grown = [];
    all.forEach(function (w) { if (w.week !== now.week) grown = grown.concat(w.trees); });
    if (grown.length) {
      var gh = node('div', 'g-head');
      gh.appendChild(node('h3', null, 'your grove'));
      gh.appendChild(node('span', 'g-note', grown.length + (grown.length === 1 ? ' tree' : ' trees') + ' from earlier weeks'));
      body.appendChild(gh);
      var grove = node('div', 'g-grove');
      grown.forEach(function (t) { grove.appendChild(treeTile(t)); });
      body.appendChild(grove);
    }

    // what earlier weeks grew that never made a tree, kept all the same
    all.forEach(function (w) {
      if (w.week === now.week || !w.loose.length) return;
      var h = node('div', 'g-head');
      h.appendChild(node('h3', null, weekName(w.week)));
      h.appendChild(node('span', 'g-note', w.plants.length + (w.plants.length === 1 ? ' plant' : ' plants') + ' · ' + span(w.mins)));
      body.appendChild(h);
      var row = node('div', 'g-shelf is-small');
      w.loose.forEach(function (p) { row.appendChild(plantTile(p)); });
      body.appendChild(row);
    });
  }

  function open() {
    if (!el.card) return;
    if (window.Panel && Panel.show) Panel.show(false);
    render();
    el.card.hidden = false;
    document.body.classList.add('garden-open');
    if (window.Motion && Motion.grow) Motion.grow(el.card);
    if (el.close) el.close.focus({ preventScroll: true });
    if (window.innerWidth < 900) el.card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function close() {
    if (!el.card || el.card.hidden) return;
    el.card.hidden = true;
    document.body.classList.remove('garden-open');
  }

  function init() {
    el = { card: document.getElementById('gardenCard'), body: document.getElementById('gardenBody'),
      close: document.getElementById('gardenClose') };
    if (el.close) el.close.addEventListener('click', close);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && el.card && !el.card.hidden) close();
    });
    if (window.Store) Store.subscribe(adopt);
    setTimeout(adopt, 2000);
    listeners.push(function () { if (el.card && !el.card.hidden) render(); });
  }

  return {
    init: init, add: add, weeks: weeks, thisWeek: thisWeek,
    last: function () { return plants[plants.length - 1] || null; },
    count: function () { return plants.length; },
    paintSill: paintSill, open: open, close: close,
    onChange: function (fn) { listeners.push(fn); },
    PER_TREE: PER_TREE, LEAST: LEAST
  };
})();
