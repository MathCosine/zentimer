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

  function hasContent(doc) {
    return !!(doc && ((doc.tasks && doc.tasks.length) ||
                      (doc.blocks && doc.blocks.length) ||
                      (doc.logs && doc.logs.length)));
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
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    if (Remote.ready()) Remote.push(state);
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
    var found = state.tags.filter(function (t) { return t.name.toLowerCase() === clean.toLowerCase(); })[0];
    if (found) return found;
    var tag = { id: id('g_'), name: clean, color: TAG_COLORS[state.tags.length % TAG_COLORS.length] };
    state.tags.push(tag);
    return tag;
  }

  /* Two names for the same class: everything wearing one ends up wearing the
     other, and the emptied tag goes. */
  function mergeTags(fromId, intoId) {
    if (fromId === intoId) return null;
    var into = state.tags.filter(function (t) { return t.id === intoId; })[0];
    if (!into) return null;
    state.tasks.forEach(function (task) {
      if (!task.tags || task.tags.indexOf(fromId) === -1) return;
      task.tags = task.tags.filter(function (x) { return x !== fromId; });
      if (task.tags.indexOf(intoId) === -1) task.tags.push(intoId);
    });
    state.tags = state.tags.filter(function (t) { return t.id !== fromId; });
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
      state.blocks = state.blocks.filter(function (b) {
        return !(b.routine && b.taskId === taskId && b.date >= today);
      });
      if (task.skips) Object.keys(task.skips).forEach(function (d) { if (d >= today) delete task.skips[d]; });
    }
    changed();
    return task;
  }

  function removeTask(taskId) {
    state.tasks = state.tasks.filter(function (t) { return t.id !== taskId; });
    state.blocks.forEach(function (b) { if (b.taskId === taskId) b.taskId = null; });
    changed();
  }

  function taskById(taskId) {
    return state.tasks.filter(function (t) { return t.id === taskId; })[0] || null;
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
    state.blocks = state.blocks.filter(function (b) { return b.id !== blockId; });
    changed();
  }

  /* Repeating tasks live in the list, not on the timeline -- they turn up on
     each day they are due and you put them on the day yourself when you want
     them there. This sweeps up the blocks the older, automatic version left
     behind: only ones still machine-placed (moving one by hand clears the flag)
     and only from today on, so your past days stay as they were. */
  function ensureRoutine(key) {
    var today = dayKey();
    var stale = state.blocks.some(function (b) {
      return b.routine && b.date >= today && !b.done;
    });
    if (!stale) return 0;                 // the usual case: nothing to do, nothing allocated
    state.blocks = state.blocks.filter(function (b) {
      return !(b.routine && b.date >= today && !b.done);
    });
    changed();
    return 0;
  }

  function blockById(blockId) {
    return state.blocks.filter(function (b) { return b.id === blockId; })[0] || null;
  }

  function blocksOn(key) {
    return state.blocks.filter(function (b) { return b.date === (key || dayKey()); })
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
    return state.logs.filter(function (l) {
      return l.date === (key || dayKey()) && (!taskId || l.taskId === taskId);
    }).reduce(function (sum, l) { return sum + l.ms; }, 0);
  }

  /* ---------- lists ---------- */

  function addList(name) {
    var list = { id: id('l_'), name: String(name || 'List').trim().slice(0, 40), order: state.lists.length };
    state.lists.push(list);
    changed();
    return list;
  }

  function removeList(listId) {
    state.lists = state.lists.filter(function (l) { return l.id !== listId; });
    state.tasks.forEach(function (t) {
      if (t.listId === listId) t.listId = state.lists[0] ? state.lists[0].id : null;
    });
    changed();
  }

  function renameList(listId, name) {
    var list = state.lists.filter(function (l) { return l.id === listId; })[0];
    if (list) { list.name = String(name).trim().slice(0, 40); changed(); }
  }

  /* ---------- the remote half, dormant until it is configured ---------- */

  var Remote = (function () {
    var client = null, status = 'off', config = null, pushTimer = 0;
    var synced = false;    // has this device reconciled with the server yet?

    function usable(where) {
      return where && typeof where.url === 'string' && typeof where.key === 'string' &&
             where.url.trim().length > 8 && where.key.trim().length > 8;
    }

    function creds() {
      if (config) return config;
      try {
        var saved = JSON.parse(localStorage.getItem('pip.supabase') || 'null');
        if (usable(saved)) return (config = { url: saved.url.trim(), key: saved.key.trim() });
      } catch (e) { /* ignore */ }
      var baked = window.PIP_CONFIG && window.PIP_CONFIG.supabase;
      if (usable(baked)) return (config = { url: baked.url.trim(), key: baked.key.trim() });
      return null;
    }

    function connect() {
      var where = creds();
      if (!where) { status = 'off'; return Promise.resolve(false); }
      status = 'connecting';
      return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
        .then(function (mod) {
          client = mod.createClient(where.url, where.key);
          return client.auth.getSession();
        })
        .then(function (res) {
          status = res && res.data && res.data.session ? 'on' : 'signed-out';
          return status === 'on' ? pull() : false;
        })
        .catch(function (err) {
          var why = (err && err.message ? err.message : String(err));
          // say something a person can act on rather than the raw failure
          if (/dynamically imported module|Failed to fetch/i.test(why)) status = 'no connection — working locally';
          else if (/Invalid API key|JWT/i.test(why)) status = 'that key was not accepted';
          else if (/not confirmed/i.test(why)) status = 'confirm the email, or switch confirmation off';
          else status = why.slice(0, 70);
          return false;
        });
    }

    /* Deciding which copy wins, in the order that keeps data:
         the server has something and this device is empty -> take the server,
           whatever the stamps say. A fresh browser has nothing to lose and
           everything to gain, and this is the case that used to go wrong.
         both have something -> the later stamp wins, and the loser is kept
           in a local backup first.
         only this device has something -> ours goes up. */
    function pull() {
      return client.from('pip_state').select('data, updated').eq('id', 'plan').maybeSingle()
        .then(function (res) {
          var row = res && res.data;
          var theirs = row && row.data;
          var mine = state;

          if (hasContent(theirs) && (!hasContent(mine) || (theirs.updated || 0) > (mine.updated || 0))) {
            keepSafetyCopy(mine);
            state = theirs;
            synced = true;
            persist();
            listeners.forEach(function (fn) { fn(state); });
            return true;
          }

          synced = true;
          if (!hasContent(theirs)) push(mine);   // the server has nothing worth keeping
          return true;
        })
        .catch(function () {
          // a failed read must never look like an empty server
          synced = false;
          status = 'could not read your data — working locally';
          return false;
        });
    }

    function push(snapshot) {
      // pushing before the first pull is how a blank device overwrites a full one
      if (!client || status !== 'on' || !synced) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(function () {
        client.from('pip_state')
          .upsert({ id: 'plan', data: snapshot, updated: snapshot.updated }, { onConflict: 'user_id,id' })
          .then(function () {}, function () {});
      }, 900);
    }

    return {
      connect: connect,
      push: push,
      ready: function () { return status === 'on'; },
      configured: function () { return !!creds(); },
      status: function () { return status; },
      client: function () { return client; },
      save: function (url, key) {
        config = { url: url, key: key };
        try { localStorage.setItem('pip.supabase', JSON.stringify(config)); } catch (e) {}
        return connect();
      },
      signIn: function (email, password) {
        if (!client) return Promise.reject(new Error('not connected'));
        return client.auth.signInWithPassword({ email: email, password: password })
          .then(function (res) {
            if (res.error) throw res.error;
            status = 'on';
            synced = false;       // this account's copy has not been seen yet
            return pull();
          });
      },
      synced: function () { return synced; },
      backup: function () {
        try { return JSON.parse(localStorage.getItem(BACKUP) || 'null'); } catch (e) { return null; }
      },
      restoreBackup: function () {
        var kept = null;
        try { kept = JSON.parse(localStorage.getItem(BACKUP) || 'null'); } catch (e) { return false; }
        if (!kept || !kept.data || !kept.data.version) return false;
        state = kept.data;
        state.updated = Date.now();       // deliberately the newest thing there is
        changed();
        return true;
      },
      signUp: function (email, password) {
        if (!client) return Promise.reject(new Error('not connected'));
        var here = location.origin + location.pathname;
        return client.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: here }     // not supabase's default localhost
        }).then(function (res) {
          if (res.error) throw res.error;
          if (res.data && res.data.session) { status = 'on'; return pull(); }
          status = 'check your email to confirm';
          return false;
        });
      }
    };
  })();

  /* ---------- boot ---------- */

  function init() {
    var saved = read();
    state = saved && saved.version ? saved : seed();
    if (!state.logs) state.logs = [];
    if (!state.blocks) state.blocks = [];
    state.tasks.forEach(function (t) {
      if (!t.skips) t.skips = {};
      if (typeof t.at === 'undefined') t.at = null;
      if (!t.mins) t.mins = 30;
    });
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

    lists: function () { return state.lists.slice().sort(byOrder); },
    addList: addList, removeList: removeList, renameList: renameList,

    tags: function () { return state.tags.slice(); },
    tagByName: tagByName,
    tagColors: function () { return TAG_COLORS.slice(); },
    sniffTag: sniffTag,
    tagUse: function (tagId) {
      return state.tasks.filter(function (t) { return (t.tags || []).indexOf(tagId) !== -1; }).length;
    },
    renameTag: function (tagId, name) {
      var tag = state.tags.filter(function (t) { return t.id === tagId; })[0];
      var clean = String(name || '').trim().slice(0, 16);
      if (!tag || !clean) return null;
      var clash = state.tags.filter(function (t) {
        return t.id !== tagId && t.name.toLowerCase() === clean.toLowerCase();
      })[0];
      if (clash) return mergeTags(tagId, clash.id);   // renaming onto another tag is a merge
      tag.name = clean;
      changed();
      return tag;
    },
    recolourTag: function (tagId, colour) {
      var tag = state.tags.filter(function (t) { return t.id === tagId; })[0];
      if (!tag || TAG_COLORS.indexOf(colour) === -1) return;
      tag.color = colour;
      changed();
    },
    removeTag: function (tagId) {
      state.tags = state.tags.filter(function (t) { return t.id !== tagId; });
      state.tasks.forEach(function (t) {
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
      return (task.tags || []).map(function (tid) {
        return state.tags.filter(function (t) { return t.id === tid; })[0];
      }).filter(Boolean);
    },
    setTaskTags: function (taskId, names) {
      var task = taskById(taskId);
      if (!task) return;
      task.tags = names.map(function (n) { var t = tagByName(n); return t && t.id; }).filter(Boolean);
      changed();
    },

    tasks: function () { return state.tasks.slice(); },
    addTask: addTask, updateTask: updateTask, removeTask: removeTask,
    taskById: taskById, toggleDone: toggleDone, isDone: isDone, repeats: repeats, dueOn: dueOn,

    blocks: blocksOn, addBlock: addBlock, updateBlock: updateBlock, removeBlock: removeBlock,
    blockById: blockById, currentBlock: currentBlock, nextBlock: nextBlock, daySummary: daySummary,
    ensureRoutine: ensureRoutine,
    overrunBlock: overrunBlock, shiftAfter: shiftAfter, findSlot: findSlot,

    logTime: logTime, loggedOn: loggedOn,

    remote: Remote,

    /* a way out, whatever happens to the browser */
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) {
      var incoming = JSON.parse(text);
      if (!incoming || !incoming.version) throw new Error('not a pip export');
      state = incoming;
      changed();
    }
  };
})();
