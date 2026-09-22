/* The data behind the planner: lists, tags, tasks, day blocks and time logs.
   Everything runs through here so there is exactly one place that knows how
   data is shaped and where it is kept. A backend is pluggable: local storage
   today, Supabase once it is configured. */
window.Store = (function () {
  'use strict';

  var KEY = 'pip.plan.v1';
  var listeners = [];
  var saveTimer = 0;

  var TAG_COLORS = ['blue', 'green', 'yellow', 'violet', 'coral', 'teal', 'pink'];

  var state = blank();

  function blank() {
    return {
      version: 1,
      lists: [],
      tags: [],
      tasks: [],
      blocks: [],
      logs: [],
      updated: 0
    };
  }

  function seed() {
    return {
      version: 1,
      lists: [
        { id: 'l_school', name: 'School', order: 0 },
        { id: 'l_extra', name: 'Extracurricular', order: 1 }
      ],
      tags: [],
      tasks: [],
      blocks: [],
      logs: [],
      updated: 0        // never edited here, so it loses every tie with the server
    };
  }

  /* ---------- rows, tombstones and what still needs sending ---------- */

  var ROW_TABLES = ['lists', 'tags', 'tasks', 'blocks', 'logs'];

  /* A deleted row is marked, not removed. A row that is merely absent cannot
     be told apart from one another device has not pulled yet, which is how
     deleted things come back from the dead. */
  function bury(table, matches) {
    var when = Date.now(), any = false;
    state[table].forEach(function (row) {
      if (row.deletedAt || !matches(row)) return;
      row.deletedAt = when;
      any = true;
    });
    return any;
  }

  function alive(rows) {
    return rows.filter(function (r) { return !r.deletedAt; });
  }

  /* What the server last agreed each row looked like. Comparing against it on
     save means the twenty places that edit a row do not each have to remember
     to say so. */
  var shadow = {};
  ROW_TABLES.forEach(function (t) { shadow[t] = {}; });

  function scanForChanges() {
    ROW_TABLES.forEach(function (table) {
      (state[table] || []).forEach(function (row) {
        // a row created since the last pass has no stamps yet
        if (typeof row.updated !== 'number') row.updated = 0;
        if (typeof row.deletedAt === 'undefined') row.deletedAt = null;
        if (!window.Sync) return;
        var json = stamp(row);
        if (shadow[table][row.id] === json) return;
        shadow[table][row.id] = json;
        Sync.markDirty(table, row.id);
      });
    });
  }

  // `updated` is the server's answer, not part of what we are proposing
  function stamp(row) {
    var copy = {}, keys = Object.keys(row).sort();
    keys.forEach(function (k) { if (k !== 'updated') copy[k] = row[k]; });
    return JSON.stringify(copy);
  }

  function markSynced(table, id) {
    var row = (state[table] || []).filter(function (r) { return r.id === id; })[0];
    if (row) shadow[table][id] = stamp(row);
  }

  function hasContent(doc) {
    return !!(doc && ((doc.tasks && doc.tasks.length) ||
                      (doc.blocks && doc.blocks.length) ||
                      (doc.logs && doc.logs.length)));
  }

  /* A backup you have to remember to take is a backup you do not have. One
     snapshot a day, the last five kept, entirely on this device. */
  var SNAPS = 'pip.plan.snaps';
  function snapshotDaily() {
    if (!hasContent(state)) return;
    var snaps = [];
    try { snaps = JSON.parse(localStorage.getItem(SNAPS) || '[]'); } catch (e) { snaps = []; }
    var today = dayKey();
    if (snaps.length && snaps[snaps.length - 1].day === today) return;
    snaps.push({ day: today, at: Date.now(), data: state });
    while (snaps.length > 5) snaps.shift();
    try { localStorage.setItem(SNAPS, JSON.stringify(snaps)); }
    catch (e) {
      // out of room: one snapshot is better than none
      try { localStorage.setItem(SNAPS, JSON.stringify(snaps.slice(-1))); } catch (e2) {}
    }
  }

  function snapshots() {
    try { return JSON.parse(localStorage.getItem(SNAPS) || '[]'); } catch (e) { return []; }
  }

  /* Nothing is ever replaced without a way back. */
  var BACKUP = 'pip.plan.backup';
  function keepSafetyCopy(doc) {
    if (!hasContent(doc)) return;
    try {
      localStorage.setItem(BACKUP, JSON.stringify({ at: Date.now(), data: doc }));
    } catch (e) { /* private mode, or no room */ }
  }

  /* ---------- helpers ---------- */

  function id(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function minutesNow(d) {
    d = d || new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function clockLabel(minutes, hour12) {
    var h = Math.floor(minutes / 60) % 24, m = minutes % 60, suffix = '';
    if (hour12) { suffix = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; }
    return (hour12 ? h : pad(h)) + ':' + pad(m) + suffix;
  }

  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  /* ---------- persistence ---------- */

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function persist() {
    persistTimer = 0;
    scanForChanges();
    snapshotDaily();      // self-limiting: one a day, whenever there is something to keep
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  /* Typing a title used to serialise the whole document to storage on every
     keystroke. The stamp still lands at the moment of the edit, so last-write
     -wins stays honest, but the writing itself waits for you to pause -- and
     goes out at once if the page is about to disappear. */
  var persistTimer = 0;
  function save() {
    state.updated = Date.now();
    if (!persistTimer) persistTimer = setTimeout(persist, 250);
  }

  function flush() { if (persistTimer) { clearTimeout(persistTimer); persist(); } }

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  function changed() {
    save();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      listeners.forEach(function (fn) { fn(state); });
    }, 0);
  }

  /* ---------- tasks ---------- */

  function tagByName(name) {
    var clean = String(name || '').trim();
    if (!clean) return null;
    var found = alive(state.tags).filter(function (t) { return t.name.toLowerCase() === clean.toLowerCase(); })[0];
    if (found) return found;
    var tag = { id: id('g_'), name: clean, color: TAG_COLORS[alive(state.tags).length % TAG_COLORS.length] };
    state.tags.push(tag);
    return tag;
  }

  /* Two names for the same class: everything wearing one ends up wearing the
     other, and the emptied tag goes. */
  function mergeTags(fromId, intoId) {
    if (fromId === intoId) return null;
    var into = alive(state.tags).filter(function (t) { return t.id === intoId; })[0];
    if (!into) return null;
    alive(state.tasks).forEach(function (task) {
      if (!task.tags || task.tags.indexOf(fromId) === -1) return;
      task.tags = task.tags.filter(function (x) { return x !== fromId; });
      if (task.tags.indexOf(intoId) === -1) task.tags.push(intoId);
    });
    bury('tags', function (t) { return t.id === fromId; });
    changed();
    return into;
  }

  /* "PHY Workbook Week 5" → tagged PHY. Bulk paste then lands already sorted. */
  function sniffTag(title) {
    var first = String(title || '').trim().split(/\s+/)[0] || '';
    if (/^[A-Z][A-Z0-9]{1,7}$/.test(first) && first !== 'A' && first !== 'I') return first;
    return null;
  }

  function addTask(fields) {
    var tags = (fields.tags || []).slice();
    var sniffed = fields.autoTag === false ? null : sniffTag(fields.title);
    if (sniffed) {
      var tag = tagByName(sniffed);
      if (tag && tags.indexOf(tag.id) === -1) tags.push(tag.id);
    }
    var task = {
      id: id('t_'),
      listId: fields.listId || (state.lists[0] && state.lists[0].id) || null,
      title: String(fields.title || '').trim().slice(0, 140),
      tags: tags,
      due: fields.due || null,
      repeat: fields.repeat || 'none',       // none | daily | weekdays | weekly
      weekday: typeof fields.weekday === 'number' ? fields.weekday : null,
      at: typeof fields.at === 'number' ? fields.at : null,    // minutes past midnight
      mins: fields.mins || 30,
      done: false,
      completions: {},
      skips: {},
      created: Date.now(),
      order: state.tasks.length
    };
    if (!task.title) return null;
    state.tasks.push(task);
    changed();
    return task;
  }

  function updateTask(taskId, fields) {
    var task = taskById(taskId);
    if (!task) return null;
    var retimed = ('at' in fields) || ('mins' in fields) || ('repeat' in fields);
    Object.keys(fields).forEach(function (key) { task[key] = fields[key]; });
    if (retimed) {
      var today = dayKey();
      bury('blocks', function (b) { return b.routine && b.taskId === taskId && b.date >= today; });
      if (task.skips) Object.keys(task.skips).forEach(function (d) { if (d >= today) delete task.skips[d]; });
    }
    changed();
    return task;
  }

  function removeTask(taskId) {
    bury('tasks', function (t) { return t.id === taskId; });
    alive(state.blocks).forEach(function (b) { if (b.taskId === taskId) b.taskId = null; });
    changed();
  }

  function taskById(taskId) {
    return alive(state.tasks).filter(function (t) { return t.id === taskId; })[0] || null;
  }

  function repeats(task) { return task.repeat && task.repeat !== 'none'; }

  /* does this repeating task belong on this date at all? */
  function dueOn(task, date) {
    if (!repeats(task)) return true;
    var day = date.getDay();
    if (task.repeat === 'daily') return true;
    if (task.repeat === 'weekdays') return day >= 1 && day <= 5;
    if (task.repeat === 'weekly') return day === (task.weekday === null ? date.getDay() : task.weekday);
    return true;
  }

  function isDone(task, key) {
    return repeats(task) ? !!task.completions[key || dayKey()] : !!task.done;
  }

  function toggleDone(taskId, key) {
    var task = taskById(taskId);
    if (!task) return;
    var when = key || dayKey();
    if (repeats(task)) {
      if (task.completions[when]) delete task.completions[when];
      else task.completions[when] = Date.now();
    } else {
      task.done = !task.done;
      task.doneAt = task.done ? Date.now() : null;
    }
    changed();
  }

  /* ---------- day blocks ---------- */

  function addBlock(fields) {
    var block = {
      id: id('b_'),
      date: fields.date || dayKey(),
      start: Math.max(0, Math.min(1439, fields.start)),
      end: Math.max(15, Math.min(1440, fields.end)),
      taskId: fields.taskId || null,
      title: String(fields.title || '').slice(0, 140),
      done: false,
      ranOver: 0
    };
    if (block.end <= block.start) block.end = block.start + 30;
    state.blocks.push(block);
    changed();
    return block;
  }

  function updateBlock(blockId, fields) {
    var block = blockById(blockId);
    if (!block) return null;
    var movedByHand = (('start' in fields) && fields.start !== block.start) ||
                      (('end' in fields) && fields.end !== block.end);
    Object.keys(fields).forEach(function (key) { block[key] = fields[key]; });
    if (movedByHand) block.routine = false;
    if (block.end <= block.start) block.end = block.start + 15;
    changed();
    return block;
  }

  function removeBlock(blockId) {
    var block = blockById(blockId);
    // a routine block you throw away should stay thrown away for that day
    if (block && block.routine && block.taskId) {
      var task = taskById(block.taskId);
      if (task) { task.skips = task.skips || {}; task.skips[block.date] = true; }
    }
    bury('blocks', function (b) { return b.id === blockId; });
    changed();
  }

  /* Repeating tasks live in the list, not on the timeline -- they turn up on
     each day they are due and you put them on the day yourself when you want
     them there. This sweeps up the blocks the older, automatic version left
     behind: only ones still machine-placed (moving one by hand clears the flag)
     and only from today on, so your past days stay as they were. */
  function ensureRoutine(key) {
    var today = dayKey();
    var stale = alive(state.blocks).some(function (b) {
      return b.routine && b.date >= today && !b.done;
    });
    if (!stale) return 0;                 // the usual case: nothing to do, nothing allocated
    bury('blocks', function (b) { return b.routine && b.date >= today && !b.done; });
    changed();
    return 0;
  }

  function blockById(blockId) {
    return alive(state.blocks).filter(function (b) { return b.id === blockId; })[0] || null;
  }

  function blocksOn(key) {
    return alive(state.blocks).filter(function (b) { return b.date === (key || dayKey()); })
      .sort(function (a, b) { return a.start - b.start; });
  }

  /* the block happening right now, if any */
  function currentBlock(atMinutes) {
    var at = typeof atMinutes === 'number' ? atMinutes : minutesNow();
    var today = blocksOn(dayKey());
    for (var i = 0; i < today.length; i++) {
      if (!today[i].done && at >= today[i].start && at < today[i].end) return today[i];
    }
    return null;
  }

  function nextBlock(atMinutes) {
    var at = typeof atMinutes === 'number' ? atMinutes : minutesNow();
    return blocksOn(dayKey()).filter(function (b) { return !b.done && b.start > at; })[0] || null;
  }

  /* One that should have finished just now and has not been ticked off. Anything
     older than OVERRUN_GRACE is simply an unfinished block from earlier in the day,
     not something you are still sitting in. */
  var OVERRUN_GRACE = 90;

  function overrunBlock(atMinutes) {
    var at = typeof atMinutes === 'number' ? atMinutes : minutesNow();
    var recent = blocksOn(dayKey()).filter(function (b) {
      return !b.done && b.end <= at && (at - b.end) <= OVERRUN_GRACE;
    });
    return recent.length ? recent[recent.length - 1] : null;
  }

  /* push everything after this block later by n minutes */
  /* how much of a day is spoken for */
  function daySummary(key) {
    var day = blocksOn(key);
    var planned = day.reduce(function (sum, b) { return sum + (b.end - b.start); }, 0);
    return { count: day.length, minutes: planned, done: day.filter(function (b) { return b.done; }).length };
  }

  function shiftAfter(blockId, minutes) {
    var block = blockById(blockId);
    if (!block) return;
    blocksOn(block.date).forEach(function (b) {
      if (b.start >= block.end && b.id !== block.id) {
        b.start = Math.min(1425, b.start + minutes);
        b.end = Math.min(1440, b.end + minutes);
      }
    });
    block.end = Math.min(1440, block.end + minutes);
    block.ranOver = (block.ranOver || 0) + minutes;
    changed();
  }

  /* first gap of `length` minutes from `from` onward */
  function findSlot(length, from, key) {
    var day = blocksOn(key || dayKey());
    var at = Math.ceil((typeof from === 'number' ? from : minutesNow()) / 15) * 15;
    for (var guard = 0; guard < 96; guard++) {
      var clash = day.filter(function (b) { return at < b.end && at + length > b.start; })[0];
      if (!clash) return Math.min(at, 1440 - length);
      at = Math.ceil(clash.end / 15) * 15;
    }
    return Math.min(at, 1440 - length);
  }

  /* ---------- time logs ---------- */

  function logTime(taskId, blockId, ms) {
    if (!ms || ms < 1000) return;
    state.logs.push({ id: id('s_'), taskId: taskId || null, blockId: blockId || null, date: dayKey(), ms: ms, at: Date.now() });
    if (state.logs.length > 2000) state.logs = state.logs.slice(-2000);
    changed();
  }

  function loggedOn(key, taskId) {
    return alive(state.logs).filter(function (l) {
      return l.date === (key || dayKey()) && (!taskId || l.taskId === taskId);
    }).reduce(function (sum, l) { return sum + l.ms; }, 0);
  }

  /* ---------- lists ---------- */

  function addList(name) {
    var list = { id: id('l_'), name: String(name || 'List').trim().slice(0, 40), order: alive(state.lists).length };
    state.lists.push(list);
    changed();
    return list;
  }

  function removeList(listId) {
    bury('lists', function (l) { return l.id === listId; });
    var home = alive(state.lists)[0];
    alive(state.tasks).forEach(function (t) {
      if (t.listId === listId) t.listId = home ? home.id : null;
    });
    changed();
  }

  function renameList(listId, name) {
    var list = alive(state.lists).filter(function (l) { return l.id === listId; })[0];
    if (list) { list.name = String(name).trim().slice(0, 40); changed(); }
  }

  /* ---------- the remote half, dormant until it is configured ---------- */

  /* ---------- the remote half, dormant until it is configured ---------- */

  /* Sync owns the wire; this is the small surface it needs of the data, plus
     the same names the rest of the app already calls. */
  var Remote = (function () {
    var statusText = 'off';

    function attach() {
      if (!window.Sync) return;
      Sync.init({
        rows: function (table) { return state[table]; },

        // the server agreed this row looks like this, so stop calling it changed
        markSynced: markSynced,

        // rows arrived from elsewhere: save them and redraw
        merged: function () {
          try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
          listeners.forEach(function (fn) { fn(state); });
        },

        // only stamps changed, so save but do not redraw
        stamped: function () {
          try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
        },

        adoptLegacy: adoptLegacy
      }, function (text) { statusText = text; listeners.forEach(function (fn) { fn(state); }); });
    }

    /* The old single document, turned into rows. Anything already here by the
       same id wins, so running this twice changes nothing, and the old row is
       left where it is as the way back. */
    function adoptLegacy(doc) {
      keepSafetyCopy(state);
      ROW_TABLES.forEach(function (table) {
        var incoming = doc[table] || [];
        if (!incoming.length) return;
        var have = {};
        state[table].forEach(function (row) { have[row.id] = true; });
        incoming.forEach(function (row) {
          if (have[row.id]) return;
          var copy = JSON.parse(JSON.stringify(row));
          copy.updated = 0;              // never seen by the server in this shape
          copy.deletedAt = copy.deletedAt || null;
          state[table].push(copy);
        });
      });
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      scanForChanges();                  // everything goes up as rows
      listeners.forEach(function (fn) { fn(state); });
    }

    return {
      attach: attach,
      connect: function () { return window.Sync ? Sync.connect() : Promise.resolve(false); },
      ready: function () { return !!window.Sync && Sync.ready(); },
      synced: function () { return !!window.Sync && Sync.ready(); },
      pending: function () { return window.Sync ? Sync.pending() : 0; },
      configured: function () { return !!window.Sync && Sync.configured(); },
      status: function () { return statusText; },
      client: function () { return window.Sync ? Sync.client() : null; },
      save: function (url, key) { return Sync.save(url, key); },
      signIn: function (email, password) { return Sync.signIn(email, password); },
      signUp: function (email, password) { return Sync.signUp(email, password); },
      signOut: function () { return Sync.signOut(); },

      backup: function () {
        try { return JSON.parse(localStorage.getItem(BACKUP) || 'null'); } catch (e) { return null; }
      },
      snapshots: snapshots,
      restore: function (doc) {
        if (!doc || !doc.version) return false;
        keepSafetyCopy(state);
        state = doc;
        normalise();
        ROW_TABLES.forEach(function (t) { shadow[t] = {}; });   // all of it goes back up
        changed();
        return true;
      },
      restoreBackup: function () {
        var kept = null;
        try { kept = JSON.parse(localStorage.getItem(BACKUP) || 'null'); } catch (e) { return false; }
        return kept && kept.data ? Remote.restore(kept.data) : false;
      }
    };
  })();


  /* ---------- boot ---------- */

  /* Everything a row needs to exist as a row, filled in for data written
     before rows existed. Safe to run over anything. */
  function normalise() {
    if (!state.logs) state.logs = [];
    if (!state.blocks) state.blocks = [];
    if (!state.tags) state.tags = [];
    if (!state.lists) state.lists = [];
    if (!state.tasks) state.tasks = [];
    state.tasks.forEach(function (t) {
      if (!t.skips) t.skips = {};
      if (!t.completions) t.completions = {};
      if (typeof t.at === 'undefined') t.at = null;
      if (!t.mins) t.mins = 30;
    });
    ROW_TABLES.forEach(function (table) {
      state[table].forEach(function (row) {
        if (typeof row.updated !== 'number') row.updated = 0;
        if (typeof row.deletedAt === 'undefined') row.deletedAt = null;
      });
    });
  }

  function init() {
    var saved = read();
    state = saved && saved.version ? saved : seed();
    normalise();
    snapshotDaily();
    Remote.attach();
    Remote.connect();
    return state;
  }

  return {
    init: init,
    state: function () { return state; },
    subscribe: function (fn) { listeners.push(fn); },
    notify: changed,
    quiet: save,      // save it, but do not make the whole planner redraw

    dayKey: dayKey,
    minutesNow: minutesNow,
    clockLabel: clockLabel,

    lists: function () { return alive(state.lists).sort(byOrder); },
    addList: addList, removeList: removeList, renameList: renameList,

    tags: function () { return alive(state.tags); },
    tagByName: tagByName,
    tagColors: function () { return TAG_COLORS.slice(); },
    sniffTag: sniffTag,
    tagUse: function (tagId) {
      return alive(state.tasks).filter(function (t) { return (t.tags || []).indexOf(tagId) !== -1; }).length;
    },
    renameTag: function (tagId, name) {
      var tag = alive(state.tags).filter(function (t) { return t.id === tagId; })[0];
      var clean = String(name || '').trim().slice(0, 16);
      if (!tag || !clean) return null;
      var clash = alive(state.tags).filter(function (t) {
        return t.id !== tagId && t.name.toLowerCase() === clean.toLowerCase();
      })[0];
      if (clash) return mergeTags(tagId, clash.id);   // renaming onto another tag is a merge
      tag.name = clean;
      changed();
      return tag;
    },
    recolourTag: function (tagId, colour) {
      var tag = alive(state.tags).filter(function (t) { return t.id === tagId; })[0];
      if (!tag || TAG_COLORS.indexOf(colour) === -1) return;
      tag.color = colour;
      changed();
    },
    removeTag: function (tagId) {
      bury('tags', function (t) { return t.id === tagId; });
      alive(state.tasks).forEach(function (t) {
        if (t.tags) t.tags = t.tags.filter(function (x) { return x !== tagId; });
      });
      changed();
    },
    mergeTags: mergeTags,
    addTag: function (name) {
      var tag = tagByName(name);
      if (tag) changed();
      return tag;
    },
    tagsOf: function (task) {
      var live = alive(state.tags);
      return (task.tags || []).map(function (tid) {
        return live.filter(function (t) { return t.id === tid; })[0];
      }).filter(Boolean);
    },
    setTaskTags: function (taskId, names) {
      var task = taskById(taskId);
      if (!task) return;
      task.tags = names.map(function (n) { var t = tagByName(n); return t && t.id; }).filter(Boolean);
      changed();
    },

    tasks: function () { return alive(state.tasks); },
    addTask: addTask, updateTask: updateTask, removeTask: removeTask,
    taskById: taskById, toggleDone: toggleDone, isDone: isDone, repeats: repeats, dueOn: dueOn,

    blocks: blocksOn, addBlock: addBlock, updateBlock: updateBlock, removeBlock: removeBlock,
    blockById: blockById, currentBlock: currentBlock, nextBlock: nextBlock, daySummary: daySummary,
    ensureRoutine: ensureRoutine,
    overrunBlock: overrunBlock, shiftAfter: shiftAfter, findSlot: findSlot,

    logTime: logTime, loggedOn: loggedOn,

    remote: Remote,
    pending: function () { return Remote.pending(); },

    /* a way out, whatever happens to the browser */
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) {
      var incoming = JSON.parse(text);
      if (!incoming || !incoming.version) throw new Error('not a pip export');
      if (!Remote.restore(incoming)) throw new Error('not a pip export');
    }
  };
})();
