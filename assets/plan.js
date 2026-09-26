/* The planner: lists and tags on one side, the day's timeline on the other.
   Everything is edited in place — no dialogs, no prompts. */
window.Plan = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var ui = {
    date: null,              // the day on the timeline; null means follow today
    view: 'all',             // 'all' | listId
    tags: [],
    showDone: false,
    expanded: false,
    pinned: false,
    editing: null,           // task id open for editing
    selected: null,          // block id open in the block bar
    adding: null,            // 'paste' | 'list' | null
    dueFor: null,            // the task whose deadline picker is open
    split: false,            // show two panes instead of one list
    top: [],                 // tag ids that belong in the upper pane
    find: '',                // what you are looking for
    week: false,             // the seven days, instead of one
    sort: 'due',             // due | added | tag | name | at
    desc: false,             // the other way round
    times: false,            // the hours, rather than a line saying where you are
    tagsView: false          // every tag at once, instead of the list
  };

  /* Which tags sit up top is a way of looking, not data, so it stays on this
     machine rather than riding along in the synced document. */
  var PREF = 'pip_view';
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREF) || '{}');
      ui.split = !!saved.split;
      ui.top = Array.isArray(saved.top) ? saved.top : [];
      if (saved.sort) ui.sort = saved.sort;
      ui.desc = !!saved.desc;
      ui.times = !!saved.times;
    } catch (e) { /* private mode, or nothing saved yet */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREF, JSON.stringify({
        split: ui.split, top: ui.top, sort: ui.sort, desc: ui.desc, times: ui.times
      }));
    } catch (e) {}
  }
  var hour12 = false;
  var hoverTimer = 0, collapseTimer = 0;
  var dwellAt = null;
  var dragging = null, pendingRender = false, pressed = false;

  var DAY_START = 5 * 60;   // both are yours to set in settings
  var DAY_END = 24 * 60;
  var OPEN_PPM = 1.15;
  var SHUT_MINUTES = 6 * 60;   // collapsed always shows your six local hours, +-3

  /* Collapsed, the scale bends to the box so the six hours always fit exactly;
     opened, the scale is fixed and the whole day scrolls past. */
  var reveal = null;   // a task whose editor should be scrolled into view on the next draw
  var boxTarget = 0;   // the height sizeTimeline just asked for, not the one mid-transition

  function ppm() {
    if (ui.expanded) return OPEN_PPM;
    var box = (boxTarget || el.timelineWrap.clientHeight || 240) - 16;
    return clamp(box / SHUT_MINUTES, 0.3, 1.6);
  }

  /* The timeline takes whatever room the window actually has, measured rather
     than guessed, and never so much that the task list is squeezed to nothing. */
  var TASK_FLOOR = 180;   // the list never shrinks below this
  var OPEN_FLOOR = 92;    // ...except while you are deliberately editing the day

  /* The timeline and the task list share one flexed column, so whatever the
     list can spare is exactly what the timeline can take. Measuring the list
     rather than adding up everything above it means this lands in one pass and
     stays right when the bar, the chips or the extras change height. */
  function sizeTimeline() {
    if (!el.timelineWrap || !el.planCard) return;
    if (!document.querySelector('.app')) return;

    // wide screens hand the timeline its own column row; the stylesheet fills it
    if (window.innerWidth >= 900) {
      el.timelineWrap.style.height = '';
      boxTarget = el.timelineWrap.clientHeight;
      return;
    }

    if (!ui.times) { el.timelineWrap.style.height = ''; boxTarget = 0; return; }
    var lists = el.taskList.clientHeight;
    var floor = ui.expanded ? OPEN_FLOOR : TASK_FLOOR;
    /* The day gives up room whenever the list needs it more: while a task
       editor is open, and while two panes are sharing what one used to have. */
    /* Six hours read fine in about a seventh of the window; anything more was
       just taking room the task list badly needs. */
    var share = ui.editing ? 0.13 : 0.16;
    var least = ui.editing ? 92 : 118;
    var shut = clamp(Math.round(window.innerHeight * share), least, 260);
    var want = el.timelineWrap.clientHeight + (lists - floor);

    boxTarget = ui.expanded ? clamp(Math.round(want), shut, 1100) : shut;
    el.timelineWrap.style.height = boxTarget + 'px';
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function label(mins) { return Store.clockLabel(mins, hour12); }
  function paint(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  function hhmm(mins) { return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }

  function viewDate() { return ui.date || Store.dayKey(); }
  function isToday() { return viewDate() === Store.dayKey(); }

  /* ---------- the day you are looking at ---------- */

  function shiftDay(days) {
    var d = new Date(viewDate() + 'T12:00');
    d.setDate(d.getDate() + days);
    var key = Store.dayKey(d);
    ui.date = key === Store.dayKey() ? null : key;
    ui.selected = null;
    render();
  }

  function dayName(key) {
    if (key === Store.dayKey()) return 'today';
    var d = new Date(key + 'T12:00');
    var diff = Math.round((d - new Date(Store.dayKey() + 'T12:00')) / 86400000);
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase();
  }

  function spanLabel(minutes) {
    if (minutes < 60) return minutes + 'm';
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  function renderDayHead() {
    var key = viewDate();
    paint(el.dayLabel, dayName(key));
    el.dayLabel.classList.toggle('is-away', !isToday());
    var sum = Store.daySummary(key);
    paint(el.daySum, sum.count ? sum.count + ' · ' + spanLabel(sum.minutes) : 'nothing planned');
  }

  /* ---------- tasks ---------- */

  /* Looking for something crosses every other filter: a search that only
     looked inside the list you happen to be on is a search you cannot trust. */
  function matches(task) {
    var hay = (task.title || '').toLowerCase() + ' ' +
      Store.tagsOf(task).map(function (t) { return t.name; }).join(' ').toLowerCase();
    return needles.every(function (n) { return hay.indexOf(n) !== -1; });
  }

  var needles = [];
  var hunting = false;

  function visibleTasks() {
    var today = new Date();
    var key = Store.dayKey(today);
    hunting = !!ui.find.trim();
    needles = ui.find.toLowerCase().split(/\s+/).filter(Boolean);
    return Store.tasks().filter(function (task) {
      if (hunting && !matches(task)) return false;
      if (ui.view !== 'all' && task.listId !== ui.view) return false;
      if (ui.tags.length && !ui.tags.some(function (t) { return (task.tags || []).indexOf(t) !== -1; })) return false;
      if (!hunting && Store.repeats(task) && !Store.dueOn(task, today) && ui.editing !== task.id) return false;
      if (!hunting && !ui.showDone && Store.isDone(task, key) && ui.editing !== task.id) return false;
      return true;
    }).sort(comparing(key));
  }

  /* ---------- the order they come in ---------- */

  var SORTS = [
    { id: 'due',   label: 'due' },
    { id: 'added', label: 'added' },
    { id: 'tag',   label: 'tag' },
    { id: 'name',  label: 'name' },
    { id: 'at',    label: 'time' }
  ];

  function firstTag(task) {
    var names = Store.tagsOf(task).map(function (t) { return t.name.toLowerCase(); }).sort();
    return names[0] || '';
  }

  /* Two rules sit outside whichever order you picked, because flipping them
     never makes sense: a finished task belongs at the bottom, and a task with
     nothing to sort on -- no due date, no tag, no time -- belongs after the
     ones that have one, whichever way round the rest is. */
  function comparing(key) {
    var mode = ui.sort;
    var flip = ui.desc ? -1 : 1;

    return function (a, b) {
      var doneA = Store.isDone(a, key) ? 1 : 0, doneB = Store.isDone(b, key) ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;

      var side = 0;
      if (mode === 'added') {
        side = (a.created || 0) - (b.created || 0);
      } else if (mode === 'name') {
        side = (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
      } else if (mode === 'tag') {
        var ta = firstTag(a), tb = firstTag(b);
        if (!ta !== !tb) return ta ? -1 : 1;
        side = ta.localeCompare(tb);
      } else if (mode === 'at') {
        var ha = typeof a.at === 'number', hb = typeof b.at === 'number';
        if (ha !== hb) return ha ? -1 : 1;
        side = ha ? a.at - b.at : 0;
      } else {
        if (!!a.due !== !!b.due) return a.due ? -1 : 1;
        side = a.due && b.due ? (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) : 0;
      }

      if (side) return side * flip;
      return (a.order || 0) - (b.order || 0);     // a stable tiebreak, always
    };
  }

  /* ---------- writing a task in one line ---------- */

  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  /* Adjacent letters swapped is the commonest typo by a distance -- firday,
     tuseday, mondya -- and plain edit distance scores a swap as two, so it is
     counted as one here. */
  function nearness(a, b) {
    var rows = [];
    for (var i = 0; i <= a.length; i++) rows.push([i]);
    for (var j = 0; j <= b.length; j++) rows[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
      }
    }
    return rows[a.length][b.length];
  }

  var SHORT_DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

  /* An abbreviation has to be exact -- "man" is one letter from "mon" and is
     usually just a word. A full day name may be misspelt by one. */
  function weekdayFrom(word) {
    var w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return -1;
    if (SHORT_DAYS[w] !== undefined) return SHORT_DAYS[w];
    var found = WEEKDAYS.indexOf(w);
    if (found !== -1) return found;
    if (w.length < 5) return -1;
    // a longer word can afford a looser guess: there are few real words within
    // two edits of "wednesday", and plenty within one of "mon"
    var best = -1, score = w.length >= 7 ? 3 : 2;
    WEEKDAYS.forEach(function (name, index) {
      var d = nearness(w, name);
      if (d < score) { score = d; best = index; }
    });
    return best;
  }

  function dayKeyFrom(date) { return Store.dayKey(date); }

  function nextWeekday(index) {
    var d = new Date();
    var ahead = (index - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (ahead || 7));
    return d;
  }

  /* "PHY essay tue 4pm 45m every week" -> a tagged task, due Tuesday, usually
     at 16:00, half an hour long, repeating. Anything it does not recognise is
     left in the title, so plain typing still works exactly as before. */
  function parseAdd(raw) {
    var text = String(raw || '').trim();
    var out = { title: text, due: null, at: null, mins: null, repeat: 'none', weekday: null, found: [] };
    if (!text) { out.title = ''; return out; }

    function take(re, apply) {
      var hit = text.match(re);
      if (!hit) return;
      if (apply(hit) === false) return;
      text = (text.slice(0, hit.index) + ' ' + text.slice(hit.index + hit[0].length)).replace(/\s{2,}/g, ' ').trim();
    }

    // repeats first: "every day", "weekdays", "every tuesday"
    take(/\b(every\s+day|daily|weekdays|every\s+week(?:day)?|every\s+(\w{3,10}))\b/i, function (hit) {
      var word = hit[0].toLowerCase();
      if (/every\s+day|daily/.test(word)) { out.repeat = 'daily'; out.found.push('every day'); return; }
      if (/weekdays|every\s+weekday/.test(word)) { out.repeat = 'weekdays'; out.found.push('weekdays'); return; }
      if (hit[2]) {
        var index = weekdayFrom(hit[2]);
        if (index === -1) return false;
        out.repeat = 'weekly';
        out.weekday = index;
        out.found.push('every ' + WEEKDAYS[index]);
        return;
      }
      out.repeat = 'weekly';
      out.found.push('weekly');
    });

    /* A length: "45m", "45 min", "1h", "1h30", "2h 30m". The minutes after an
       hour are their own optional run of digits -- requiring a trailing "m"
       meant 1h30 matched nothing at all. */
    take(/\b(\d{1,2})\s*h(?:ours?|rs?)?\s*(\d{1,2})?\s*m?(?:in(?:ute)?s?)?\b|\b(\d{1,3})\s*m(?:in(?:ute)?s?)?\b/i, function (hit) {
      var mins = hit[3] ? +hit[3] : (+hit[1]) * 60 + (hit[2] ? +hit[2] : 0);
      if (!mins || mins > 600) return false;
      out.mins = mins;
      out.found.push(mins >= 60 ? Math.floor(mins / 60) + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '') : mins + 'm');
    });

    // a time of day: "4pm", "16:30", "at 9"
    take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i, function (hit) {
      var h, m;
      if (hit[3]) {
        h = +hit[1] % 12;
        if (hit[3].toLowerCase() === 'pm') h += 12;
        m = hit[2] ? +hit[2] : 0;
      } else {
        h = +hit[4]; m = +hit[5];
      }
      if (h > 23 || m > 59) return false;
      out.at = h * 60 + m;
      out.found.push(label(out.at));
    });

    // a bare hour, but only when you said "at": "at 9", "at 4"
    if (out.at === null) {
      take(/\bat\s+(\d{1,2})\b/i, function (hit) {
        var h = +hit[1];
        if (h > 23) return false;
        if (h >= 1 && h <= 6) h += 12;     // nobody means four in the morning
        out.at = h * 60;
        out.found.push(label(out.at));
      });
    }

    // a day: today, tomorrow, a weekday name, or 12/3
    take(/\btoday\b|\btomorrow\b|\b(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b|\b(\d{1,2})\/(\d{1,2})\b/i, function (hit) {
      var word = hit[0].toLowerCase();
      if (word === 'today') { out.due = Store.dayKey(); out.found.push('due today'); return; }
      if (word === 'tomorrow') {
        var t = new Date(); t.setDate(t.getDate() + 1);
        out.due = dayKeyFrom(t); out.found.push('due tomorrow'); return;
      }
      if (hit[2] && hit[3]) {
        var made = new Date();
        made.setMonth(+hit[2] - 1, +hit[3]);
        if (made < new Date(Store.dayKey() + 'T00:00')) made.setFullYear(made.getFullYear() + 1);
        if (isNaN(made.getTime())) return false;
        out.due = dayKeyFrom(made);
        out.found.push('due ' + dueLabel(out.due));
        return;
      }
      if (hit[1]) {
        var index = weekdayFrom(hit[1]);
        if (index === -1) return false;
        // a weekday only sets a due date when it is not already the repeat
        if (out.repeat === 'weekly' && out.weekday === index) return false;
        out.due = dayKeyFrom(nextWeekday(index));
        out.found.push('due ' + WEEKDAYS[index]);
        return;
      }
      return false;
    });

    /* No pattern can enumerate the ways a day gets misspelt, so whatever is
       left is read word by word: "mondya" is a Monday, "monitor" is not. */
    if (!out.due && out.repeat === 'none') {
      var words = text.match(/[a-z]{5,10}/gi) || [];
      for (var w = 0; w < words.length; w++) {
        var guess = weekdayFrom(words[w]);
        if (guess === -1) continue;
        out.due = dayKeyFrom(nextWeekday(guess));
        out.found.push('due ' + WEEKDAYS[guess]);
        text = text.replace(new RegExp('\\b' + words[w] + '\\b', 'i'), ' ').replace(/\s{2,}/g, ' ').trim();
        break;
      }
    }

    out.title = text.replace(/\s{2,}/g, ' ').trim();
    var sniffed = Store.sniffTag ? Store.sniffTag(out.title) : null;
    if (sniffed) out.found.unshift(sniffed);
    return out;
  }

  /* "friday", "mondya", "tomorrow", "12/3", or nothing at all. The same
     reading the add box does, on a field of its own. */
  function readDue(text) {
    var clean = String(text || '').trim();
    if (!clean || /^(none|no|never|-)$/i.test(clean)) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    var read = parseAdd('x ' + clean);
    return read.due || null;
  }

  /* what it understood, shown under the box before you commit to it */
  function renderHint() {
    if (!el.addHint) return;
    var value = el.taskInput.value;
    var read = value.trim() ? parseAdd(value) : null;
    if (!read || !read.found.length) {
      el.addHint.hidden = true;
      el.addHint.textContent = '';
      return;
    }
    el.addHint.textContent = '';
    read.found.forEach(function (bit) {
      el.addHint.appendChild(node('span', 'add-bit', bit));
    });
    if (read.title) el.addHint.appendChild(node('span', 'add-rest', read.title));
    el.addHint.hidden = false;
  }

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function dueLabel(due) {
    if (!due) return '';
    var today = Store.dayKey();
    if (due === today) return 'today';
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (due === Store.dayKey(tomorrow)) return 'tomorrow';
    if (due < today) return 'overdue';
    return new Date(due + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toLowerCase();
  }

  function renderViews() {
    el.views.textContent = '';
    var key = Store.dayKey();
    var options = [{ id: 'all', name: 'everything' }].concat(Store.lists());
    options.forEach(function (option) {
      var count = Store.tasks().filter(function (t) {
        if (option.id !== 'all' && t.listId !== option.id) return false;
        return !Store.isDone(t, key) && (!Store.repeats(t) || Store.dueOn(t, new Date()));
      }).length;
      var button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '';
      button.appendChild(document.createTextNode(option.name));
      var tally = document.createElement('span');
      tally.className = 'view-count';
      tally.textContent = count;
      button.appendChild(tally);
      button.setAttribute('aria-current', String(ui.view === option.id));
      button.addEventListener('click', function () { ui.view = option.id; render(); });
      if (option.id !== 'all') {
        button.addEventListener('dblclick', function () { ui.adding = 'rename:' + option.id; render(); });
      }
      el.views.appendChild(button);
    });
  }

  var WHICH_WAY = {
    due:   ['soonest first', 'latest first'],
    added: ['oldest first', 'newest first'],
    tag:   ['a to z', 'z to a'],
    name:  ['a to z', 'z to a'],
    at:    ['earliest first', 'latest first']
  };

  function renderSort() {
    if (!el.sortRow) return;
    el.sortRow.hidden = !ui.sorting;
    el.sortBtn.setAttribute('aria-pressed', String(!!ui.sorting));
    if (!ui.sorting) return;

    el.sortPicks.textContent = '';
    SORTS.forEach(function (sort) {
      var chip = node('button', 'pick', sort.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(ui.sort === sort.id));
      chip.addEventListener('click', function () {
        // picking the one already chosen turns it round, which is what
        // clicking a column heading twice does everywhere else
        if (ui.sort === sort.id) ui.desc = !ui.desc;
        else { ui.sort = sort.id; ui.desc = false; }
        savePrefs();
        render();
      });
      el.sortPicks.appendChild(chip);
    });

    var ways = WHICH_WAY[ui.sort] || ['first', 'last'];
    el.sortDir.textContent = (ui.desc ? '\u2191 ' : '\u2193 ') + ways[ui.desc ? 1 : 0];
    el.sortDir.setAttribute('aria-pressed', String(ui.desc));
    el.sortDir.title = 'Turn the order round';
  }

  function renderChips() {
    el.tagChips.textContent = '';
    var tags = Store.tags();
    if (!tags.length) { el.tagChips.hidden = true; return; }
    el.tagChips.hidden = false;
    if (ui.split) {
      var hint = document.createElement('span');
      hint.className = 'chip-label';
      hint.textContent = 'top pane';
      el.tagChips.appendChild(hint);
    }
    tags.forEach(function (tag) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip tone-' + tag.color;
      chip.textContent = tag.name;
      var list = ui.split ? ui.top : ui.tags;
      chip.setAttribute('aria-pressed', String(list.indexOf(tag.id) !== -1));
      chip.addEventListener('click', function () {
        var into = ui.split ? ui.top : ui.tags;
        var at = into.indexOf(tag.id);
        if (at === -1) into.push(tag.id); else into.splice(at, 1);
        if (ui.split) savePrefs();
        render();
      });
      el.tagChips.appendChild(chip);
    });
    var chosen = ui.split ? ui.top : ui.tags;
    if (chosen.length) {
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'chip chip-clear';
      clear.textContent = 'clear';
      clear.addEventListener('click', function () {
        if (ui.split) { ui.top = []; savePrefs(); } else ui.tags = [];
        render();
      });
      el.tagChips.appendChild(clear);
    }
  }

  /* one row, or the editor it turns into */
  function taskRow(task, key, scheduled) {
    var done = Store.isDone(task, key);
    var item = document.createElement('li');
    item.className = 'task' + (done ? ' is-done' : '') + (ui.editing === task.id ? ' is-editing' : '');
    item.dataset.id = task.id;

    var tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'task-tick';
    tick.setAttribute('aria-pressed', String(done));
    tick.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
    tick.addEventListener('click', function () { Store.toggleDone(task.id, key); });
    item.appendChild(tick);

    if (ui.editing === task.id) {
      item.appendChild(taskEditor(task));
      return item;
    }

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'task-body';
    body.addEventListener('click', function () {
      ui.editing = task.id;
      ui.focusTask = task.id;
      ui.selected = null;
      reveal = task.id;
      render();
    });

    var title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;
    body.appendChild(title);

    if (task.progress > 0 && task.progress < 100) {
      var bar = node('span', 'task-bar');
      var fill = node('span', 'task-fill');
      fill.style.width = task.progress + '%';
      bar.appendChild(fill);
      bar.title = task.progress + '% done';
      body.appendChild(bar);
    }

    var meta = document.createElement('span');
    meta.className = 'task-meta';
    Store.tagsOf(task).forEach(function (tag) {
      // tapping the badge is the shortest way to "just this class"
      var badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'tag tone-' + tag.color;
      badge.textContent = tag.name;
      badge.title = 'Show only ' + tag.name;
      badge.addEventListener('click', function (event) {
        event.stopPropagation();
        if (ui.split) { ui.top = [tag.id]; savePrefs(); }
        else ui.tags = ui.tags.length === 1 && ui.tags[0] === tag.id ? [] : [tag.id];
        render();
      });
      meta.appendChild(badge);
    });
    if (Store.repeats(task)) {
      var rep = document.createElement('span');
      rep.className = 'task-flag';
      rep.textContent = (task.repeat === 'weekdays' ? 'weekdays' : task.repeat) +
        (typeof task.at === 'number' ? ' ' + label(task.at) : '');
      meta.appendChild(rep);
    }
    var slot = scheduled[task.id];
    if (slot) {
      var when = document.createElement('span');
      when.className = 'task-flag is-planned';
      when.textContent = label(slot.start);
      meta.appendChild(when);
    }
    if (meta.children.length) body.appendChild(meta);
    item.appendChild(body);

    var when = document.createElement('button');
    when.type = 'button';
    when.className = 'task-due' + (task.due ? (task.due < key ? ' is-late' : ' is-set') : '');
    when.textContent = task.due ? dueLabel(task.due) : 'due';
    when.title = 'Set a deadline';
    when.addEventListener('click', function (event) {
      event.stopPropagation();
      ui.dueFor = ui.dueFor === task.id ? null : task.id;
      render();
    });
    item.appendChild(when);

    var plan = document.createElement('button');
    plan.type = 'button';
    plan.className = 'task-plan';
    plan.title = scheduled[task.id]
      ? 'Already on ' + dayName(viewDate())
      : 'Put on ' + dayName(viewDate()) + ' — or drag me onto an hour';
    plan.textContent = scheduled[task.id] ? '✓' : '+';
    plan.addEventListener('pointerdown', function (event) {
      if (event.button === 2 || scheduled[task.id]) return;
      startTaskDrag(event, task);
    });

    plan.addEventListener('click', function (event) {
      event.stopPropagation();
      if (droppedAt && Date.now() - droppedAt < 400) { droppedAt = 0; return; }
      if (scheduled[task.id]) { selectBlock(scheduled[task.id].id); return; }
      var day = viewDate();
      var length = task.mins || 30;
      var from = isToday() ? Store.minutesNow() : 9 * 60;
      // a usual time is where it wants to go; findSlot only steps in if it is taken
      var wanted = typeof task.at === 'number' && task.at + length <= DAY_END ? task.at : from;
      var start = Store.findSlot(length, wanted, day);
      var block = Store.addBlock({ date: day, start: start, end: start + (task.mins || 30), taskId: task.id, title: task.title });
      selectBlock(block.id);
      peek();
    });
    item.appendChild(plan);
    if (ui.dueFor === task.id) item.appendChild(duePicker(task));
    return item;
  }

  /* Today, tomorrow, the next of each weekday, and a date for anything else.
     Deadlines are days, never times -- "friday" is the whole answer. */
  function duePicker(task) {
    var box = node('div', 'due-pick');
    var today = new Date();

    function set(value) {
      Store.updateTask(task.id, { due: value });
      ui.dueFor = null;
      render();
    }

    function chip(label, value, extra) {
      var b = node('button', 'pick' + (extra || ''), label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(task.due === value));
      b.addEventListener('click', function (event) { event.stopPropagation(); set(value); });
      return b;
    }

    var soon = node('div', 'pick-row');
    soon.appendChild(chip('today', Store.dayKey()));
    var t = new Date(); t.setDate(t.getDate() + 1);
    soon.appendChild(chip('tomorrow', Store.dayKey(t)));
    box.appendChild(soon);

    var days = node('div', 'pick-row');
    for (var i = 1; i <= 7; i++) {
      var d = new Date();
      d.setDate(d.getDate() + i);
      if (i <= 1) continue;                       // today and tomorrow are above
      days.appendChild(chip(d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase(), Store.dayKey(d)));
    }
    box.appendChild(days);

    var rest = node('div', 'pick-row');
    var exact = document.createElement('input');
    exact.type = 'date';
    exact.className = 'due-exact';
    exact.value = task.due || '';
    exact.addEventListener('click', function (event) { event.stopPropagation(); });
    exact.addEventListener('change', function () { set(exact.value || null); });
    rest.appendChild(exact);
    if (task.due) rest.appendChild(chip('no deadline', null, ' is-clear'));
    box.appendChild(rest);

    box.addEventListener('click', function (event) { event.stopPropagation(); });
    return box;
  }

  /* When does a repeat next come round? Walk forward a fortnight; nothing we
     support repeats less often than that. */
  function nextDueLabel(task) {
    var day = new Date();
    for (var i = 1; i <= 14; i++) {
      day.setDate(day.getDate() + 1);
      if (Store.dueOn(task, day)) {
        if (i === 1) return 'tomorrow';
        return day.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
      }
    }
    return 'later';
  }

  function field(labelText, control, wide) {
    var wrap = document.createElement('label');
    wrap.className = 'field' + (wide ? ' is-wide' : '');
    var span = document.createElement('span');
    span.textContent = labelText;
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  function taskEditor(task) {
    var box = document.createElement('div');
    box.className = 'task-edit';

    var title = document.createElement('input');
    title.type = 'text';
    title.className = 'edit-title';
    title.dataset.focusKey = 'task-title:' + task.id;
    title.value = task.title;
    // nothing else on screen shows this title while the editor is open, so
    // typing in it need not redraw the planner a character at a time
    title.addEventListener('input', function () { task.title = title.value.slice(0, 140); Store.quiet(); });
    title.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); closeEditor(); }
    });
    box.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'edit-grid';

    var tags = document.createElement('input');
    tags.type = 'text';
    tags.dataset.focusKey = 'task-tags:' + task.id;
    tags.placeholder = 'PHY MSB';
    tags.value = Store.tagsOf(task).map(function (t) { return t.name; }).join(' ');
    tags.addEventListener('change', function () {
      Store.setTaskTags(task.id, tags.value.split(/\s+/).filter(Boolean));
    });
    grid.appendChild(field('tags', tags, true));

    var due = document.createElement('input');
    due.type = 'text';
    due.className = 'due-words';
    due.dataset.focusKey = 'task-due:' + task.id;
    due.placeholder = 'friday, 12/3, none';
    due.value = task.due ? dueLabel(task.due) : '';
    due.title = 'A day in words, or a date';
    due.addEventListener('change', function () {
      var read = readDue(due.value);
      Store.updateTask(task.id, { due: read });
      render();
    });
    grid.appendChild(field('due', due));

    var doneRow = node('div', 'pick-row');
    [0, 25, 50, 75].forEach(function (step) {
      var chip = node('pick-tmp', 'pick', step ? step + '%' : 'not started');
      var real = document.createElement('button');
      real.type = 'button';
      real.className = 'pick';
      real.textContent = chip.textContent;
      real.setAttribute('aria-pressed', String((task.progress || 0) === step));
      real.addEventListener('click', function () {
        Store.updateTask(task.id, { progress: step });
        render();
      });
      doneRow.appendChild(real);
    });
    grid.appendChild(field('how far in', doneRow, true));

    var repeatRow = document.createElement('div');
    repeatRow.className = 'pick-row';
    [['none', 'once'], ['daily', 'every day'], ['weekdays', 'weekdays'], ['weekly', 'weekly']].forEach(function (pair) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pick';
      chip.textContent = pair[1];
      chip.setAttribute('aria-pressed', String((task.repeat || 'none') === pair[0]));
      chip.addEventListener('click', function () {
        Store.updateTask(task.id, {
          repeat: pair[0],
          weekday: pair[0] === 'weekly' ? new Date(viewDate() + 'T12:00').getDay() : null
        });
        render();
      });
      repeatRow.appendChild(chip);
    });
    grid.appendChild(field('repeat', repeatRow, true));

    if (Store.repeats(task)) {
      var at = document.createElement('input');
      at.type = 'time';
      at.value = typeof task.at === 'number' ? hhmm(task.at) : '';
      at.addEventListener('change', function () {
        var parts = at.value.split(':');
        var minutes = at.value ? (+parts[0]) * 60 + (+parts[1]) : null;
        Store.updateTask(task.id, { at: minutes });
        render();
      });
      grid.appendChild(field('usual time', at));

      if (!Store.dueOn(task, new Date())) {
        var away = document.createElement('p');
        away.className = 'edit-note';
        away.textContent = 'not on today\u2019s list \u2014 back ' + nextDueLabel(task);
        box.appendChild(away);
      }

      var mins = document.createElement('input');
      mins.type = 'number';
      mins.min = '5';
      mins.step = '5';
      mins.value = task.mins || 30;
      mins.addEventListener('change', function () {
        Store.updateTask(task.id, { mins: clamp(+mins.value || 30, 5, 600) });
      });
      grid.appendChild(field('for (min)', mins));
    }

    var lists = Store.lists();
    if (lists.length > 1) {
      var list = document.createElement('select');
      lists.forEach(function (one) {
        var option = document.createElement('option');
        option.value = one.id;
        option.textContent = one.name;
        if (one.id === task.listId) option.selected = true;
        list.appendChild(option);
      });
      list.addEventListener('change', function () { Store.updateTask(task.id, { listId: list.value }); });
      grid.appendChild(field('list', list, true));
    }

    box.appendChild(grid);

    var actions = document.createElement('div');
    actions.className = 'edit-actions';

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'edit-danger';
    remove.textContent = 'delete';
    remove.addEventListener('click', function () {
      ui.editing = null;
      Store.removeTask(task.id);
      offerUndo();
    });
    actions.appendChild(remove);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'edit-done';
    close.textContent = 'done';
    close.addEventListener('click', closeEditor);
    actions.appendChild(close);

    box.appendChild(actions);
    if (ui.focusTask === task.id) {
      setTimeout(function () {
        title.focus();
        title.setSelectionRange(title.value.length, title.value.length);
        if (document.activeElement === title) ui.focusTask = null;
      }, 0);
    }
    return box;
  }

  function closeEditor() {
    ui.editing = null;
    render();
  }

  function fillList(tasks, key, scheduled, emptyText) {
    if (!tasks.length) {
      var empty = document.createElement('li');
      empty.className = 'task-empty';
      empty.textContent = emptyText;
      el.taskList.appendChild(empty);
      return;
    }
    tasks.forEach(function (task) { el.taskList.appendChild(taskRow(task, key, scheduled)); });
  }

  /* A heading that stays put at the top of the list while you scroll past its
     group, so you always know which half you are looking at. */
  function section(name, count) {
    var head = document.createElement('li');
    head.className = 'pane-head';
    var strong = document.createElement('b');
    strong.textContent = name;
    head.appendChild(strong);
    var tally = document.createElement('span');
    tally.className = 'pane-count';
    tally.textContent = count;
    head.appendChild(tally);
    el.taskList.appendChild(head);
  }

  /* An editor opened near the bottom would hide the very fields you came for,
     so walk the list up until the whole of it is showing. */
  function revealEditor() {
    if (!reveal) return;
    reveal = null;
    var row = el.taskList.querySelector('.task.is-editing');
    if (!row) return;
    var pane = el.taskList;
    var box = pane.getBoundingClientRect();
    var seat = row.getBoundingClientRect();
    // an editor taller than the list can only ever show its top, so go there
    if (seat.height >= box.height - 8) {
      pane.scrollTop += (seat.top - box.top) - 8;
      return;
    }
    if (seat.bottom > box.bottom) pane.scrollTop += (seat.bottom - box.bottom) + 8;
    seat = row.getBoundingClientRect();
    if (seat.top < box.top) pane.scrollTop -= (box.top - seat.top) + 8;
  }

  function paneName(ids) {
    var names = Store.tags()
      .filter(function (t) { return ids.indexOf(t.id) !== -1; })
      .map(function (t) { return t.name; });
    return names.length ? names.join(' \u00b7 ') : '';
  }

  /* Split is a grouping, not a second window. One list scrolls, the two groups
     sit in it under headings that stick -- so a long group is never crushed to
     make room for a short one, and nothing is capped at a row and a half. */
  function renderTasks() {
    var key = Store.dayKey();
    var tasks = visibleTasks();

    var scheduled = {};
    Store.blocks(viewDate()).forEach(function (b) { if (b.taskId) scheduled[b.taskId] = b; });

    document.body.classList.toggle('split', ui.split);
    el.splitBtn.setAttribute('aria-pressed', String(ui.split));
    el.taskList.textContent = '';

    if (hunting) {
      section('found', tasks.length);
      fillList(tasks, key, scheduled, 'nothing matches \u201c' + ui.find.trim() + '\u201d');
    } else if (!ui.split) {
      fillList(tasks, key, scheduled, ui.tags.length ? 'nothing with those tags' : 'nothing here yet');
    } else {
      var up = [], down = [];
      tasks.forEach(function (task) {
        var mine = (task.tags || []).some(function (t) { return ui.top.indexOf(t) !== -1; });
        (mine ? up : down).push(task);
      });
      var name = paneName(ui.top);
      section(name || 'top of the list', up.length);
      fillList(up, key, scheduled, name ? 'nothing tagged ' + name + ' today' : 'tap a tag above to fill this');
      section(name ? 'everything else' : 'everything', down.length);
      fillList(down, key, scheduled, 'nothing here yet');
    }

    revealEditor();

    var open = Store.tasks().filter(function (t) { return !Store.isDone(t, key); }).length;
    paint(el.taskCount, open + ' open');
  }

  /* ---------- the timeline ---------- */

  function viewWindow() {
    // opened means the whole day, scrolled to where you are — not a bigger peephole
    if (ui.expanded) return { from: DAY_START, to: DAY_END };
    var minutes = SHUT_MINUTES;
    var centre;
    if (isToday()) centre = Store.minutesNow();
    else {
      var day = Store.blocks(viewDate());
      centre = day.length ? day[0].start + minutes / 3 : 10 * 60 + minutes / 2;
    }
    var from = clamp(Math.round((centre - minutes / 2) / 15) * 15, DAY_START, DAY_END - minutes);
    return { from: from, to: from + minutes };
  }

  function renderTimeline() {
    var span = viewWindow();
    var scale = ppm();
    el.timeline.style.height = ((span.to - span.from) * scale) + 'px';
    el.timeline.textContent = '';
    el.timeline.dataset.from = span.from;

    for (var hour = Math.ceil(span.from / 60); hour * 60 <= span.to; hour++) {
      var line = document.createElement('div');
      line.className = 'hour';
      line.style.top = ((hour * 60 - span.from) * scale) + 'px';
      var tick = document.createElement('span');
      tick.textContent = label(hour * 60);
      line.appendChild(tick);
      el.timeline.appendChild(line);
    }

    var key = viewDate();
    var now = isToday() ? Store.minutesNow() : -1;
    Store.blocks(key).forEach(function (block) {
      if (block.end < span.from || block.start > span.to) return;
      el.timeline.appendChild(blockNode(block, span, scale, now));
    });

    if (isToday()) {
      var nowLine = document.createElement('div');
      nowLine.className = 'now-line';
      nowLine.style.top = ((now - span.from) * scale) + 'px';
      el.timeline.appendChild(nowLine);
    }
  }

  function blockNode(block, span, scale, now) {
    var task = block.taskId ? Store.taskById(block.taskId) : null;
    var tag = task ? Store.tagsOf(task)[0] : null;
    var running = now >= block.start && now < block.end && !block.done;
    var over = !block.done && now >= 0 && now >= block.end;
    var height = Math.max(18, (block.end - block.start) * scale - 2);

    var node = document.createElement('div');
    node.className = 'block' + (tag ? ' tone-' + tag.color : '') +
      (block.done ? ' is-done' : '') + (running ? ' is-now' : '') + (over ? ' is-over' : '') +
      (height < 34 ? ' is-tight' : '') + (ui.selected === block.id ? ' is-picked' : '');
    node.dataset.id = block.id;
    node.style.top = ((block.start - span.from) * scale) + 'px';
    node.style.height = height + 'px';

    var name = block.title || (task ? task.title : '');
    var title = document.createElement('span');
    title.className = 'block-title' + (name ? '' : ' is-unnamed');
    title.textContent = name || 'name it below…';
    node.appendChild(title);

    var when = document.createElement('span');
    when.className = 'block-when';
    when.textContent = label(block.start) + '–' + label(block.end) + (block.ranOver ? ' +' + block.ranOver + 'm' : '');
    node.appendChild(when);

    var grip = document.createElement('span');
    grip.className = 'block-grip';
    node.appendChild(grip);

    node.addEventListener('pointerdown', function (event) {
      startDrag(event, block, node, event.target === grip ? 'resize' : 'move');
    });
    return node;
  }

  function startDrag(event, block, node, mode) {
    if (event.button === 2) return;
    event.preventDefault();
    var scale = ppm();
    var from = +el.timeline.dataset.from;
    var startY = event.clientY;
    var origin = { start: block.start, end: block.end };
    var latest = { start: origin.start, end: origin.end };
    var moved = false;
    clearTimeout(hoverTimer);
    clearTimeout(collapseTimer);
    node.classList.add('is-dragging');
    dragging = block.id;

    function onMove(e) {
      var delta = Math.round(((e.clientY - startY) / scale) / 15) * 15;
      if (Math.abs(e.clientY - startY) > 4) moved = true;
      if (mode === 'move') {
        var length = origin.end - origin.start;
        latest.start = clamp(origin.start + delta, DAY_START, DAY_END - length);
        latest.end = latest.start + length;
      } else {
        latest.end = clamp(origin.end + delta, origin.start + 15, DAY_END);
      }
      node.style.top = ((latest.start - from) * scale) + 'px';
      node.style.height = Math.max(18, (latest.end - latest.start) * scale - 2) + 'px';
      node.querySelector('.block-when').textContent = label(latest.start) + '–' + label(latest.end);
    }

    function onUp(e) {
      if (e && typeof e.clientY === 'number') onMove(e);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      node.classList.remove('is-dragging');
      dragging = null;
      if (moved && (latest.start !== origin.start || latest.end !== origin.end)) {
        Store.updateBlock(block.id, { start: latest.start, end: latest.end });
      } else if (!moved) {
        selectBlock(block.id);
      }
      if (pendingRender) { pendingRender = false; render(); }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /* Drawing on open timeline: press and drag to sketch out the length with a live
     preview, or just tap for half an hour. Either way you watch it appear. */
  /* A mouse draw ends in a synthetic click on the same spot. That one click is
     the gesture's own and must be swallowed -- but only that one. The old
     half-second window also ate the next real click, which is why getting out
     of the block bar took two goes. */
  var lastDraw = 0;

  /* One rule for a press on empty timeline, so it is never a surprise:
       something open -> put it away; getting out of an editor is not a new block
       otherwise      -> a new half hour where you pressed, and the day opens so
                         you can see it and drag it about                         */
  function onTimelineTap(event) {
    if (event.target !== el.timeline) return;
    if (lastDraw && Date.now() - lastDraw < 400) { lastDraw = 0; return; }
    if (ui.selected || ui.editing) { ui.selected = null; ui.editing = null; render(); return; }
    var scale = ppm();
    var from = +el.timeline.dataset.from;
    var box = el.timeline.getBoundingClientRect();
    var at = clamp(Math.round((from + (event.clientY - box.top) / scale) / 15) * 15, DAY_START, DAY_END - 30);
    var block = Store.addBlock({ date: viewDate(), start: at, end: at + 30, title: '' });
    if (!ui.expanded) openTimeline(true, true);
    selectBlock(block.id, true);
  }

  /* Drag the + straight onto an hour. A plain click still drops the task at its
     usual time, so nothing is lost by not knowing this is here; the day opens
     as soon as you start dragging, because you cannot aim at what you cannot
     see. */
  var droppedAt = 0;

  function startTaskDrag(event, task) {
    var from = { x: event.clientX, y: event.clientY };
    var length = task.mins || 30;
    var live = false, ghost = null, hover = null, at = null;

    function timeUnder(y) {
      var box = el.timeline.getBoundingClientRect();
      if (y < box.top - 4 || y > box.bottom + 4) return null;
      var scale = ppm();
      var top = +el.timeline.dataset.from;
      return clamp(Math.round((top + (y - box.top) / scale) / 15) * 15, DAY_START, DAY_END - length);
    }

    function begin() {
      live = true;
      dragging = 'task';
      if (!ui.expanded) openTimeline(true, true);
      ghost = document.createElement('div');
      ghost.className = 'drag-chip';
      ghost.textContent = task.title;
      document.body.appendChild(ghost);
      document.body.classList.add('dragging-task');
    }

    function move(e) {
      if (!live) {
        if (Math.abs(e.clientX - from.x) < 5 && Math.abs(e.clientY - from.y) < 5) return;
        begin();
      }
      ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 14) + 'px)';

      at = timeUnder(e.clientY);
      if (hover) { hover.remove(); hover = null; }
      ghost.classList.toggle('is-over', at !== null);
      if (at === null) return;
      var scale = ppm();
      hover = document.createElement('div');
      hover.className = 'block is-ghost';
      hover.style.top = ((at - (+el.timeline.dataset.from)) * scale) + 'px';
      hover.style.height = Math.max(16, length * scale - 2) + 'px';
      hover.innerHTML = '<span class="block-title"></span><span class="block-when"></span>';
      hover.querySelector('.block-title').textContent = task.title;
      hover.querySelector('.block-when').textContent = label(at) + '\u2013' + label(at + length);
      hover.classList.toggle('is-tight', length * scale < 34);
      el.timeline.appendChild(hover);
    }

    function up(e) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (hover) hover.remove();
      if (ghost) ghost.remove();
      document.body.classList.remove('dragging-task');
      if (!live) return;                       // never became a drag: the click stands
      dragging = null;
      droppedAt = Date.now();
      var landed = e && typeof e.clientY === 'number' ? timeUnder(e.clientY) : at;
      if (landed === null) { render(); return; }
      var block = Store.addBlock({
        date: viewDate(), start: landed, end: Math.min(DAY_END, landed + length),
        taskId: task.id, title: task.title
      });
      selectBlock(block.id);
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  function onTimelineDraw(event) {
    if (event.target !== el.timeline || event.button === 2) return;
    if (event.pointerType === 'touch') return;        // let a finger scroll instead
    // the click handler owns both of these; drawing here would pre-empt it
    if (ui.selected || ui.editing) return;
    if (!ui.expanded) return;          // shut, a press is a tap: the click handler has it
    event.preventDefault();

    var scale = ppm();
    var from = +el.timeline.dataset.from;
    var box = el.timeline.getBoundingClientRect();
    var anchor = clamp(Math.round((from + (event.clientY - box.top) / scale) / 15) * 15, DAY_START, DAY_END - 15);
    var start = anchor, end = anchor + 30;
    var drew = false;

    var ghost = document.createElement('div');
    ghost.className = 'block is-ghost';
    ghost.innerHTML = '<span class="block-title">new block</span><span class="block-when"></span>';
    el.timeline.appendChild(ghost);
    dragging = 'draw';

    function paintGhost() {
      ghost.style.top = ((start - from) * scale) + 'px';
      ghost.style.height = Math.max(16, (end - start) * scale - 2) + 'px';
      ghost.querySelector('.block-when').textContent = label(start) + '–' + label(end);
      ghost.classList.toggle('is-tight', (end - start) * scale < 34);
    }

    function onMove(e) {
      var at = clamp(Math.round((from + (e.clientY - box.top) / scale) / 15) * 15, DAY_START, DAY_END);
      if (Math.abs(e.clientY - event.clientY) > 5) drew = true;
      if (drew) {
        start = Math.min(anchor, at);
        end = Math.max(anchor + 15, Math.max(anchor, at));
      }
      paintGhost();
    }

    function onUp(e) {
      if (e && typeof e.clientY === 'number') onMove(e);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      ghost.remove();
      dragging = null;
      lastDraw = Date.now();
      var block = Store.addBlock({ date: viewDate(), start: start, end: Math.min(DAY_END, end), title: '' });
      selectBlock(block.id, true);
    }

    paintGhost();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function selectBlock(blockId, fresh) {
    ui.selected = blockId;
    ui.editing = null;
    ui.focusBlock = !!fresh;      // the store renders on a tick, so the bar focuses itself
    render();
    setTimeout(function () {
      var node = el.timeline.querySelector('[data-id="' + blockId + '"]');
      if (!node || !ui.expanded) return;
      var top = node.offsetTop, bottom = top + node.offsetHeight;
      var view = el.timelineWrap.scrollTop, height = el.timelineWrap.clientHeight;
      if (top < view + 10) el.timelineWrap.scrollTop = Math.max(0, top - 20);
      else if (bottom > view + height - 10) el.timelineWrap.scrollTop = bottom - height + 20;
    }, 30);
  }

  /* ---------- the bar that edits the picked block ---------- */

  function renderBlockBar() {
    var block = ui.selected ? Store.blockById(ui.selected) : null;
    el.blockBar.hidden = !block;
    if (!block) return;

    el.blockBar.textContent = '';

    var title = document.createElement('input');
    title.type = 'text';
    title.className = 'block-input';
    title.dataset.focusKey = 'block-title:' + block.id;
    title.value = block.title || '';
    title.placeholder = 'what is this?';
    title.addEventListener('input', function () { Store.updateBlock(block.id, { title: title.value.slice(0, 140) }); });
    title.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); title.blur(); ui.selected = null; render(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!(block.title || '').trim() && !block.taskId) Store.removeBlock(block.id);
        ui.selected = null;
        render();
      }
    });
    el.blockBar.appendChild(title);
    el.blockTitle = title;
    if (ui.focusBlock) {
      setTimeout(function () {
        title.focus();
        title.select();
        if (document.activeElement === title) ui.focusBlock = false;
      }, 0);
    }

    var when = document.createElement('span');
    when.className = 'block-bar-when';
    when.textContent = label(block.start) + '–' + label(block.end);
    el.blockBar.appendChild(when);

    function tool(text, title2, fn, className) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'block-tool' + (className ? ' ' + className : '');
      button.textContent = text;
      button.title = title2;
      button.addEventListener('click', fn);
      el.blockBar.appendChild(button);
    }

    tool('−', 'Fifteen minutes shorter', function () {
      Store.updateBlock(block.id, { end: Math.max(block.start + 15, block.end - 15) });
    });
    tool('+', 'Fifteen minutes longer', function () {
      Store.updateBlock(block.id, { end: Math.min(DAY_END, block.end + 15) });
    });
    tool(block.done ? '✓' : '○', block.done ? 'Not finished' : 'Finished', function () {
      Store.updateBlock(block.id, { done: !block.done });
    }, block.done ? 'is-on' : '');
    tool('✕', 'Remove from the day', function () {
      Store.removeBlock(block.id);
      offerUndo();
      ui.selected = null;
    }, 'is-danger');
  }

  /* ---------- now ---------- */

  function renderNow() {
    if (!isToday()) {
      var sum = Store.daySummary(viewDate());
      el.nowStrip.classList.remove('is-over');
      el.nowShift.hidden = false;
      el.nowShift.textContent = 'back to today';
      el.nowShift.onclick = function () { ui.date = null; ui.selected = null; render(); };
      paint(el.nowTitle, 'planning ' + dayName(viewDate()));
      paint(el.nowWhen, sum.count
        ? sum.count + (sum.count === 1 ? ' block' : ' blocks') + ' · ' + spanLabel(sum.minutes)
        : 'tap + on a task, or tap the timeline');
      return;
    }

    var now = Store.minutesNow();
    var block = Store.currentBlock(now);
    var over = block ? null : Store.overrunBlock(now);
    var next = Store.nextBlock(now);

    el.nowStrip.classList.toggle('is-over', !!over);
    el.nowShift.hidden = true;

    if (block) {
      var task = block.taskId ? Store.taskById(block.taskId) : null;
      paint(el.nowTitle, block.title || (task ? task.title : 'block'));
      paint(el.nowWhen, 'until ' + label(block.end) + ' · ' + (block.end - now) + 'm left');
    } else if (over) {
      var late = now - over.end;
      paint(el.nowTitle, over.title || 'unfinished');
      paint(el.nowWhen, late + 'm over — still going?');
      el.nowShift.hidden = false;
      el.nowShift.textContent = 'push the rest ' + late + 'm';
      el.nowShift.onclick = function () { Store.shiftAfter(over.id, late); };
    } else if (next) {
      paint(el.nowTitle, 'free until ' + label(next.start));
      paint(el.nowWhen, 'next: ' + (next.title || 'block') + ' at ' + label(next.start));
    } else {
      paint(el.nowTitle, 'nothing planned');
      paint(el.nowWhen, 'tap + on a task to put it on the day');
    }
  }

  /* ---------- opening and closing ---------- */

  function openTimeline(open, pin) {
    if (dragging) return;
    if (ui.expanded === open && typeof pin !== 'boolean') return;
    ui.expanded = open;
    if (typeof pin === 'boolean') ui.pinned = pin;
    el.planCard.classList.toggle('is-open', open);
    document.body.classList.toggle('planning', open);
    el.pinBtn.setAttribute('aria-pressed', String(ui.expanded));
    el.pinBtn.title = ui.expanded ? 'Back to the next few hours' : 'Open the whole day';
    sizeTimeline();
    // let the height transition run, then redraw at the new scale
    setTimeout(function () { if (!dragging) { renderTimeline(); scrollToNow(); } }, open ? 170 : 0);
    renderTimeline();
    scrollToNow();
  }

  function scrollToNow() {
    if (!ui.expanded) { el.timelineWrap.scrollTop = 0; return; }
    var focus = isToday() ? Store.minutesNow() : (Store.blocks(viewDate())[0] || { start: 9 * 60 }).start;
    var middle = el.timelineWrap.clientHeight / 2;
    el.timelineWrap.scrollTop = Math.max(0, (focus - DAY_START) * ppm() - middle);
  }

  /* Nothing closes under you while you are in the middle of something. */
  function busy() {
    return ui.pinned || dragging || ui.selected || ui.editing ||
           el.planCard.contains(document.activeElement);
  }

  function collapseSoon(delay) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(function () {
      if (!busy()) openTimeline(false);
    }, delay === undefined ? 180 : delay);
  }

  function peek() {
    openTimeline(true, true);
  }

  /* opens when the pointer settles, not when it is passing through */
  function wireHover() {
    document.addEventListener('pointerdown', function () { pressed = true; clearTimeout(hoverTimer); }, true);
    document.addEventListener('pointerup', function () { pressed = false; });

    el.timelineWrap.addEventListener('pointermove', function (event) {
      if (!ui.times) return;
      if (event.pointerType === 'touch' || ui.pinned || ui.expanded || dragging || pressed) return;
      if (dwellAt && Math.abs(event.clientY - dwellAt.y) < 7 && Math.abs(event.clientX - dwellAt.x) < 7) return;
      dwellAt = { x: event.clientX, y: event.clientY };
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        if (!pressed && !dragging && !ui.expanded) openTimeline(true);
      }, 320);
    });

    /* Leaving the card is the whole signal -- no document-wide slop box second
       guessing where the pointer went, which is what made it linger. */
    el.planCard.addEventListener('pointerenter', function () { clearTimeout(collapseTimer); });
    el.planCard.addEventListener('pointerleave', function (event) {
      clearTimeout(hoverTimer);
      dwellAt = null;
      if (event.pointerType === 'touch') return;      // a finger has no hover to lose
      collapseSoon();
    });

    el.timeline.addEventListener('pointerdown', onTimelineDraw);
    el.timeline.addEventListener('click', onTimelineTap);

    el.pinBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = !ui.expanded;
      openTimeline(open, open);
    });

    /* Clicking away is the other way out of the block bar. */
    document.addEventListener('pointerdown', function (event) {
      if (ui.dueFor && !event.target.closest('.due-pick, .task-due')) {
        ui.dueFor = null;
        render();
        return;
      }
      if (!ui.selected || dragging) return;
      if (el.planCard.contains(event.target)) return;
      ui.selected = null;
      render();
    });

    el.dayPrev.addEventListener('click', function () { shiftDay(-1); });
    el.dayNext.addEventListener('click', function () { shiftDay(1); });
    el.dayLabel.addEventListener('click', function () { ui.date = null; ui.selected = null; render(); });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var inField = /^(input|textarea|select)$/.test((event.target.tagName || '').toLowerCase());
      var mine = el.planCard.contains(event.target) || el.taskList.contains(event.target);
      if (inField && !mine) return;                 // somebody else's field, leave it alone
      if (inField) event.target.blur();
      if (ui.selected) { ui.selected = null; render(); return; }
      if (ui.editing) { closeEditor(); return; }
      if (ui.expanded) openTimeline(false, false);
    });
  }

  /* ---------- adding things ---------- */

  function renderAdders() {
    el.addPanel.textContent = '';
    el.addPanel.hidden = !ui.adding;
    if (!ui.adding) return;

    if (ui.adding === 'paste') {
      var area = document.createElement('textarea');
      area.dataset.focusKey = 'paste';
      area.rows = 5;
      area.placeholder = 'One task per line.\nA capitalised first word (PHY, MSB) becomes a tag.';
      el.addPanel.appendChild(area);

      var row = document.createElement('div');
      row.className = 'panel-row';
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'go small';
      add.textContent = 'add them';
      add.addEventListener('click', function () {
        var listId = ui.view !== 'all' ? ui.view : (Store.lists()[0] || {}).id;
        area.value.split('\n').forEach(function (line) {
          if (line.trim()) Store.addTask({ title: line.trim(), listId: listId });
        });
        ui.adding = null;
        render();
      });
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ghost';
      cancel.textContent = 'cancel';
      cancel.addEventListener('click', function () { ui.adding = null; render(); });
      row.appendChild(add);
      row.appendChild(cancel);
      el.addPanel.appendChild(row);
      setTimeout(function () { area.focus(); }, 0);
      return;
    }

    if (ui.adding === 'list' || ui.adding.indexOf('rename:') === 0) {
      var renaming = ui.adding.indexOf('rename:') === 0 ? ui.adding.slice(7) : null;
      var current = renaming ? (Store.lists().filter(function (l) { return l.id === renaming; })[0] || {}).name : '';
      var input = document.createElement('input');
      input.type = 'text';
      input.dataset.focusKey = 'list-name';
      input.placeholder = renaming ? 'rename the list' : 'new list name';
      input.value = current || '';
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          var name = input.value.trim();
          if (name && renaming) Store.renameList(renaming, name);
          else if (name) { var made = Store.addList(name); ui.view = made.id; }
          ui.adding = null;
          render();
        }
        if (event.key === 'Escape') { ui.adding = null; render(); }
      });
      el.addPanel.appendChild(input);

      var tools = document.createElement('div');
      tools.className = 'panel-row';
      if (renaming && Store.lists().length > 1) {
        var drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'ghost is-danger';
        drop.textContent = 'delete list';
        drop.addEventListener('click', function () {
          Store.removeList(renaming);
          ui.view = 'all';
          ui.adding = null;
          render();
        });
        tools.appendChild(drop);
      }
      var shut = document.createElement('button');
      shut.type = 'button';
      shut.className = 'ghost';
      shut.textContent = 'cancel';
      shut.addEventListener('click', function () { ui.adding = null; render(); });
      tools.appendChild(shut);
      el.addPanel.appendChild(tools);
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }
  }

  function wireAdding() {
    el.taskAdd.addEventListener('submit', function (event) {
      event.preventDefault();
      var read = parseAdd(el.taskInput.value);
      if (!read.title) return;
      var listId = ui.view !== 'all' ? ui.view : (Store.lists()[0] || {}).id;
      Store.addTask({
        title: read.title, listId: listId,
        due: read.due, at: read.at, mins: read.mins,
        repeat: read.repeat, weekday: read.weekday
      });
      el.taskInput.value = '';
      renderHint();
    });

    el.taskInput.addEventListener('input', renderHint);
    el.taskInput.addEventListener('blur', function () { setTimeout(renderHint, 120); });

    el.bulkBtn.addEventListener('click', function () {
      ui.adding = ui.adding === 'paste' ? null : 'paste';
      render();
    });

    el.listBtn.addEventListener('click', function () {
      ui.adding = ui.adding === 'list' ? null : 'list';
      render();
    });

    el.doneBtn.addEventListener('click', function () {
      ui.showDone = !ui.showDone;
      el.doneBtn.setAttribute('aria-pressed', String(ui.showDone));
      render();
    });

    function setFind(text) {
      ui.find = text || '';
      el.findRow.hidden = !ui.find && !findOpen;
      el.findBtn.setAttribute('aria-pressed', String(findOpen));
      render();
    }

    var findOpen = false;
    el.findBtn.addEventListener('click', function () {
      findOpen = !findOpen;
      el.findRow.hidden = !findOpen;
      el.findBtn.setAttribute('aria-pressed', String(findOpen));
      if (findOpen) el.findInput.focus();
      else { el.findInput.value = ''; setFind(''); }
    });

    el.findInput.dataset.focusKey = 'find';
    el.findInput.addEventListener('input', function () { setFind(el.findInput.value); });
    el.findInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      el.findInput.value = '';
      findOpen = false;
      setFind('');
    });
    el.findClear.addEventListener('click', function () {
      el.findInput.value = '';
      findOpen = false;
      setFind('');
    });

    el.tagsBtn.addEventListener('click', function () {
      ui.tagsView = !ui.tagsView;
      render();
    });

    el.sortBtn.addEventListener('click', function () {
      ui.sorting = !ui.sorting;
      render();
    });

    el.sortDir.addEventListener('click', function () {
      ui.desc = !ui.desc;
      savePrefs();
      render();
    });

    el.timesBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      ui.times = !ui.times;
      if (!ui.times) openTimeline(false, false);
      savePrefs();
      render();
      if (ui.times) { sizeTimeline(); renderTimeline(); scrollToNow(); }
    });

    el.weekBtn.addEventListener('click', function () {
      ui.week = !ui.week;
      if (ui.week) { ui.selected = null; openTimeline(false, false); }
      render();
    });

    el.splitBtn.addEventListener('click', function () {
      ui.split = !ui.split;
      // the chips mean something different in each mode, so never carry a
      // filter across and leave tasks quietly hidden in the other one
      ui.tags = [];
      savePrefs();
      render();
    });
  }

  /* ---------- every tag at once ---------- */

  /* The point is seeing all of them together, so this never scrolls: the
     tiles get smaller as there are more of them, and drop what they cannot
     fit -- the count survives longest, because it is the thing you are
     scanning for. */
  function renderTagGrid() {
    if (!el.tagGrid) return;
    el.tagGrid.hidden = !ui.tagsView;
    el.taskList.hidden = ui.tagsView;
    el.tagsBtn.setAttribute('aria-pressed', String(!!ui.tagsView));
    if (!ui.tagsView) return;

    var key = Store.dayKey();
    var tags = Store.tags();
    var seen = recentByTag();
    var open = Store.tasks().filter(function (t) { return !Store.isDone(t, key); });

    var tiles = tags.map(function (tag) {
      var mine = open.filter(function (t) { return (t.tags || []).indexOf(tag.id) !== -1; });
      var dated = mine.filter(function (t) { return t.due; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
      return {
        tag: tag,
        count: mine.length,
        next: dated[0] ? dated[0].due : null,
        late: dated.filter(function (t) { return t.due < key; }).length,
        mins: Math.round(seen[tag.id] || 0)
      };
    });

    var loose = open.filter(function (t) { return !(t.tags || []).length; });
    if (loose.length) {
      tiles.push({ tag: { id: null, name: 'no tag', color: 'blue' }, count: loose.length, next: null, late: 0, mins: 0 });
    }

    // more tiles, smaller tiles: three across from seven, two below that
    var across = tiles.length > 6 ? 3 : 2;
    el.tagGrid.style.setProperty('--across', across);
    el.tagGrid.classList.toggle('is-tight', tiles.length > 6);
    el.tagGrid.textContent = '';

    if (!tiles.length) {
      el.tagGrid.appendChild(node('p', 'set-empty', 'no tags yet \u2014 start a task with a word like PHY'));
      return;
    }

    tiles.forEach(function (tile) {
      var cell = node('button', 'tag-tile tone-' + tile.tag.color + (tile.late ? ' is-late' : ''));
      cell.type = 'button';
      cell.appendChild(node('b', 'tile-name', tile.tag.name));
      cell.appendChild(node('span', 'tile-count', String(tile.count)));
      cell.appendChild(node('span', 'tile-when',
        tile.late ? tile.late + ' late' : tile.next ? dueLabel(tile.next) : tile.count ? 'no deadline' : 'clear'));
      var bar = node('span', 'tile-bar');
      var fill = node('span', 'tile-fill');
      fill.style.width = Math.min(100, Math.round(tile.mins / 180 * 100)) + '%';
      bar.appendChild(fill);
      cell.appendChild(bar);
      cell.title = tile.tag.name + ' \u00b7 ' + tile.count + ' open \u00b7 ' +
        (tile.mins ? spanLabel(tile.mins) + ' this week' : 'nothing logged this week');

      cell.addEventListener('click', function () {
        // a tile is a way in: it takes you to that tag's tasks
        ui.tagsView = false;
        ui.tags = tile.tag.id ? [tile.tag.id] : [];
        ui.find = '';
        render();
      });
      el.tagGrid.appendChild(cell);
    });
  }

  /* ---------- what to do now ---------- */

  /* What a task still needs, rather than what it needed at the start. Three
     quarters through an hour is fifteen minutes, and fifteen minutes fits a
     gap an hour never would. */
  function leftOf(task) {
    var whole = task.mins || 30;
    var done = Math.min(100, Math.max(0, task.progress || 0));
    return Math.max(5, Math.round(whole * (1 - done / 100) / 5) * 5);
  }

  /* How long you have before something else is supposed to start. No next
     block means the rest of the day, capped so it stays a useful number. */
  function gapNow() {
    if (!isToday()) return 120;
    var at = Store.minutesNow();
    var next = Store.nextBlock(at);
    var until = next ? next.start - at : DAY_END - at;
    return clamp(until, 0, 180);
  }

  /* Minutes logged against each tag over the last seven days, so a class that
     has been quietly ignored can be nudged up. */
  function recentByTag() {
    var out = {}, since = Date.now() - 7 * 86400000;
    Store.state().logs.forEach(function (log) {
      if (log.deletedAt || (log.at || 0) < since) return;
      var task = log.taskId ? Store.taskById(log.taskId) : null;
      if (!task) return;
      Store.tagsOf(task).forEach(function (tag) {
        out[tag.id] = (out[tag.id] || 0) + (log.ms || 0) / 60000;
      });
    });
    return out;
  }

  /* The ranking, in the order the four things were asked for:
       - what is closest to due, overdue hardest of all;
       - whether it fits the time there actually is;
       - a class left alone all week, so one does not swallow everything;
       - and none of it matters if the plan already says what to do.        */
  function suggestions() {
    var key = Store.dayKey();
    var gap = gapNow();
    var seen = recentByTag();
    var planned = {};
    Store.blocks(viewDate()).forEach(function (b) { if (b.taskId) planned[b.taskId] = true; });

    var ranked = Store.tasks().filter(function (task) {
      if (Store.isDone(task, key)) return false;
      if (planned[task.id]) return false;                 // already on the day
      if (Store.repeats(task) && !Store.dueOn(task, new Date())) return false;
      return true;
    }).map(function (task) {
      var score = 0, why = '';
      var length = leftOf(task);

      if (task.due) {
        var days = Math.round((new Date(task.due + 'T12:00') - new Date(key + 'T12:00')) / 86400000);
        if (days < 0) { score += 100; why = 'overdue'; }
        else if (days === 0) { score += 70; why = 'due today'; }
        else if (days === 1) { score += 45; why = 'due tomorrow'; }
        else if (days <= 7) { score += 30 - days; why = 'due ' + dueLabel(task.due); }
        else { score += 4; why = 'due ' + dueLabel(task.due); }
      }

      var fits = gap === 0 || length <= gap + 5;

      var quiet = Store.tagsOf(task).some(function (tag) { return (seen[tag.id] || 0) < 30; });
      if (quiet) {
        score += 12;
        if (!why) why = 'not touched this week';
      }

      // something already begun is worth finishing before something begun
      if (task.progress > 0 && task.progress < 100) {
        score += 10 + task.progress / 10;
        why = task.progress + '% done';
      }

      return { task: task, score: score, why: why || 'nothing else pressing', fits: fits, mins: length };
    }).sort(function (a, b) {
      /* Fitting the gap is not one consideration among several -- a four hour
         essay is not the answer to twenty minutes, however overdue it is. So
         anything that fits is ranked above anything that does not, and only
         then does urgency decide. */
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return (a.task.order || 0) - (b.task.order || 0);
    });

    return { gap: gap, list: ranked };
  }

  function renderQueue() {
    if (!el.queue) return;
    var now = isToday() ? Store.currentBlock() : null;
    var made = suggestions();

    // the plan already answered the question
    if (now || !made.list.length || ui.week) {
      el.queue.hidden = true;
      el.queue.textContent = '';
      return;
    }

    var head = node('p', 'queue-head', '');
    head.appendChild(node('b', null, 'up next'));
    head.appendChild(node('span', null, made.gap
      ? made.gap >= 180 ? 'the rest of the day' : spanLabel(made.gap) + ' free'
      : 'no gap right now'));

    el.queue.textContent = '';
    el.queue.appendChild(head);
    el.queue.hidden = false;

    made.list.slice(0, 3).forEach(function (pick) {
      var row = node('button', 'queue-row' + (pick.fits ? '' : ' is-long'));
      row.type = 'button';
      row.title = 'Put it on the day now';

      var name = node('span', 'queue-title', pick.task.title);
      row.appendChild(name);
      var tags = Store.tagsOf(pick.task);
      if (tags.length) {
        var badge = node('span', 'queue-tag tone-' + tags[0].color, tags[0].name);
        row.appendChild(badge);
      }
      row.appendChild(node('span', 'queue-why' + (pick.why === 'overdue' ? ' is-late' : ''),
        pick.fits ? pick.why : 'needs ' + spanLabel(pick.mins)));
      row.appendChild(node('span', 'queue-mins', spanLabel(pick.mins) +
        (pick.task.progress > 0 && pick.task.progress < 100 ? ' left' : '')));

      row.addEventListener('click', function () {
        var day = viewDate();
        var from = isToday() ? Store.minutesNow() : 9 * 60;
        var start = Store.findSlot(pick.mins, from, day);
        var block = Store.addBlock({
          date: day, start: start, end: Math.min(DAY_END, start + pick.mins),
          taskId: pick.task.id, title: pick.task.title
        });
        selectBlock(block.id);
      });
      el.queue.appendChild(row);
    });
  }

  /* ---------- the week ---------- */

  function weekDays() {
    var out = [];
    var start = new Date(viewDate() + 'T12:00');
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));    // monday
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(d.getDate() + i);
      out.push(Store.dayKey(d));
    }
    return out;
  }

  /* Seven narrow days at a glance. The same blocks, the same drag: dropping
     one on another day moves it there, which is the whole reason to look at a
     week rather than step through it. */
  function renderWeek() {
    if (!el.week) return;
    el.weekWrap.hidden = !ui.week;
    /* The hours are a detail. Most of the time the line above -- free until
       four, next thing at four -- is the whole answer, and the room the strip
       was taking goes to what to do with the gap. */
    el.timelineWrap.hidden = ui.week || !ui.times;
    el.timesBtn.hidden = ui.week;
    el.timesBtn.setAttribute('aria-pressed', String(ui.times));
    el.timesBtn.textContent = ui.times ? 'times \u25b4' : 'times \u25be';
    el.pinBtn.hidden = ui.week || !ui.times;
    el.weekBtn.setAttribute('aria-pressed', String(ui.week));
    if (!ui.week) return;

    var days = weekDays();
    var today = Store.dayKey();
    var busiest = 1;
    days.forEach(function (key) {
      busiest = Math.max(busiest, Store.daySummary(key).minutes || 1);
    });

    el.week.textContent = '';
    days.forEach(function (key) {
      var when = new Date(key + 'T12:00');
      var column = document.createElement('div');
      column.className = 'week-day' +
        (key === today ? ' is-today' : '') +
        (key === viewDate() ? ' is-here' : '');
      column.dataset.date = key;

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'week-head';
      head.appendChild(node('b', null, when.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase()));
      head.appendChild(node('span', null, String(when.getDate())));
      head.addEventListener('click', function () {
        ui.date = key === today ? null : key;
        ui.selected = null;
        ui.week = false;
        render();
      });
      column.appendChild(head);

      var stack = document.createElement('div');
      stack.className = 'week-stack';
      var day = Store.blocks(key);
      day.forEach(function (block) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'week-block' + (block.done ? ' is-done' : '');
        chip.dataset.id = block.id;
        chip.style.height = Math.max(14, Math.round((block.end - block.start) / busiest * 120)) + 'px';
        chip.appendChild(node('span', 'week-when', label(block.start)));
        chip.appendChild(node('span', 'week-title', block.title || 'untitled'));
        chip.title = block.title + ' · ' + label(block.start) + '–' + label(block.end);
        chip.addEventListener('pointerdown', function (event) { startWeekDrag(event, block); });
        chip.addEventListener('click', function () {
          if (movedBlockAt && Date.now() - movedBlockAt < 400) { movedBlockAt = 0; return; }
          ui.date = key === today ? null : key;
          ui.week = false;
          selectBlock(block.id);
        });
        stack.appendChild(chip);
      });
      if (!day.length) stack.appendChild(node('p', 'week-empty', ''));
      column.appendChild(stack);

      var sum = Store.daySummary(key);
      column.appendChild(node('span', 'week-sum', sum.count ? spanLabel(sum.minutes) : ''));
      el.week.appendChild(column);
    });
  }

  /* Drag a block from one day to another. It keeps its time; only the date
     changes, which is what moving something to Thursday means. */
  var movedBlockAt = 0;

  function startWeekDrag(event, block) {
    if (event.button === 2) return;
    var from = { x: event.clientX, y: event.clientY };
    var live = false, ghost = null, over = null;

    function columnUnder(x, y) {
      var found = null;
      Array.prototype.forEach.call(el.week.children, function (col) {
        var box = col.getBoundingClientRect();
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) found = col;
      });
      return found;
    }

    function move(e) {
      if (!live) {
        if (Math.abs(e.clientX - from.x) < 5 && Math.abs(e.clientY - from.y) < 5) return;
        live = true;
        dragging = 'week';
        ghost = document.createElement('div');
        ghost.className = 'drag-chip';
        ghost.textContent = block.title || 'block';
        document.body.appendChild(ghost);
        document.body.classList.add('dragging-task');
      }
      ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 14) + 'px)';
      if (over) over.classList.remove('is-target');
      over = columnUnder(e.clientX, e.clientY);
      if (over && over.dataset.date !== block.date) over.classList.add('is-target');
      else if (over) { over.classList.remove('is-target'); }
      ghost.classList.toggle('is-over', !!over && over.dataset.date !== block.date);
    }

    function up(e) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (ghost) ghost.remove();
      if (over) over.classList.remove('is-target');
      document.body.classList.remove('dragging-task');
      if (!live) return;
      dragging = null;
      movedBlockAt = Date.now();
      var landed = e && typeof e.clientX === 'number' ? columnUnder(e.clientX, e.clientY) : over;
      if (landed && landed.dataset.date !== block.date) {
        Store.updateBlock(block.id, { date: landed.dataset.date });
      }
      render();
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  /* ---------- putting something back ---------- */

  var undoTimer = 0;

  /* A line that appears where you were looking, says what went, and offers it
     back. It leaves on its own, because a bar that needs dismissing is a
     second thing to do after the thing you just did. */
  function offerUndo() {
    var last = Store.undoable();
    if (!last) return;
    clearTimeout(undoTimer);
    var old = document.querySelector('.undo-bar');
    if (old) old.remove();

    var bar = document.createElement('div');
    bar.className = 'undo-bar';
    var said = node('span', 'undo-what', last.label ? '\u201c' + last.label + '\u201d deleted' : 'deleted');
    bar.appendChild(said);
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'undo-go';
    back.textContent = 'undo';
    back.addEventListener('click', function () {
      Store.undo();
      bar.remove();
    });
    bar.appendChild(back);
    document.body.appendChild(bar);
    undoTimer = setTimeout(function () { bar.remove(); }, 7000);
  }

  /* ---------- api ---------- */

  /* A redraw throws away the very field being typed into and the scroll
     position you were reading at, so both go back afterwards. Without the
     scroll part the list jumps to the top every time anything changes --
     ticking one task threw away where you were in twenty-six of them. */
  function keepingFocus(draw) {
    var active = document.activeElement;
    var key = active && active.dataset ? active.dataset.focusKey : null;
    var start = null, end = null;
    if (key) {
      try { start = active.selectionStart; end = active.selectionEnd; } catch (e) { /* not a text field */ }
    }
    var listAt = el.taskList ? el.taskList.scrollTop : 0;
    var dayAt = el.timelineWrap ? el.timelineWrap.scrollTop : 0;

    draw();

    if (el.taskList && listAt) {
      el.taskList.scrollTop = Math.min(listAt, Math.max(0, el.taskList.scrollHeight - el.taskList.clientHeight));
    }
    if (el.timelineWrap && dayAt) {
      el.timelineWrap.scrollTop = Math.min(dayAt, Math.max(0, el.timeline.offsetHeight - el.timelineWrap.clientHeight));
    }
    if (!key) return;
    var next = document.querySelector('[data-focus-key="' + key + '"]');
    if (!next || next === document.activeElement) return;
    next.focus();
    if (start !== null && next.setSelectionRange) {
      try { next.setSelectionRange(start, end); } catch (e) { /* not a text field */ }
    }
  }

  function render() {
    if (!el.timeline) return;
    if (dragging) { pendingRender = true; return; }
    keepingFocus(function () {
      sizeTimeline();
      Store.ensureRoutine(viewDate());
      renderDayHead();
      renderViews();
      renderChips();
      renderSort();
      renderAdders();
      renderTasks();
      renderTagGrid();
      renderTimeline();
      renderWeek();
      renderQueue();
      renderBlockBar();
      renderNow();
    });
  }

  function tick() {
    if (!el.timeline || dragging) return;
    Store.ensureRoutine(Store.dayKey());
    renderTimeline();
    renderNow();
    renderDayHead();
  }

  function init(prefs) {
    el = {
      views: $('views'), tagChips: $('tagChips'), taskList: $('taskList'), taskCount: $('taskCount'),
      taskAdd: $('taskAdd'), taskInput: $('taskInput'), bulkBtn: $('bulkBtn'), listBtn: $('listBtn'),
      doneBtn: $('doneBtn'), addPanel: $('addPanel'), splitBtn: $('splitBtn'), addHint: $('addHint'),
      findBtn: $('findBtn'), findRow: $('findRow'), findInput: $('findInput'), findClear: $('findClear'),
      sortBtn: $('sortBtn'), sortRow: $('sortRow'), sortPicks: $('sortPicks'), sortDir: $('sortDir'),
      weekBtn: $('weekBtn'), weekWrap: $('weekWrap'), week: $('week'),
      timesBtn: $('timesBtn'), queue: $('queue'),
      tagsBtn: $('tagsBtn'), tagGrid: $('tagGrid'),
      timelineWrap: $('timelineWrap'), timeline: $('timeline'), pinBtn: $('pinBtn'), blockBar: $('blockBar'),
      nowStrip: $('nowStrip'), nowTitle: $('nowTitle'), nowWhen: $('nowWhen'), nowShift: $('nowShift'),
      dayPrev: $('dayPrev'), dayNext: $('dayNext'), dayLabel: $('dayLabel'), daySum: $('daySum'),
      planCard: document.querySelector('.plan-card')
    };
    if (!el.timeline) return;
    hour12 = !!(prefs && prefs.hour12);
    loadPrefs();

    Store.init();
    Store.subscribe(render);
    wireHover();
    wireAdding();
    sizeTimeline();
    window.addEventListener('resize', function () { sizeTimeline(); renderTimeline(); });
    render();
  }

  return {
    init: init,
    setDay: function (start, end) {
      DAY_START = clamp(start, 0, 1380);
      DAY_END = clamp(end, DAY_START + 120, 1440);
      render();
    },
    dayStart: function () { return DAY_START; },
    dayEnd: function () { return DAY_END; },
    render: render,
    tick: tick,
    setHour12: function (on) { if (hour12 !== !!on) { hour12 = !!on; render(); } },
    day: viewDate,
    goToDay: function (key) { ui.date = key === Store.dayKey() ? null : key; render(); },
    currentBlock: function () { return Store.currentBlock(); },
    openTimeline: openTimeline
  };
})();
