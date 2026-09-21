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
    split: false,            // show two panes instead of one list
    top: []                  // tag ids that belong in the upper pane
  };

  /* Which tags sit up top is a way of looking, not data, so it stays on this
     machine rather than riding along in the synced document. */
  var PREF = 'pip_view';
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREF) || '{}');
      ui.split = !!saved.split;
      ui.top = Array.isArray(saved.top) ? saved.top : [];
    } catch (e) { /* private mode, or nothing saved yet */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF, JSON.stringify({ split: ui.split, top: ui.top })); } catch (e) {}
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

  function visibleTasks() {
    var today = new Date();
    var key = Store.dayKey(today);
    return Store.tasks().filter(function (task) {
      if (ui.view !== 'all' && task.listId !== ui.view) return false;
      if (ui.tags.length && !ui.tags.some(function (t) { return (task.tags || []).indexOf(t) !== -1; })) return false;
      if (Store.repeats(task) && !Store.dueOn(task, today) && ui.editing !== task.id) return false;
      if (!ui.showDone && Store.isDone(task, key) && ui.editing !== task.id) return false;
      return true;
    }).sort(function (a, b) {
      var doneA = Store.isDone(a, key) ? 1 : 0, doneB = Store.isDone(b, key) ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
      return (a.order || 0) - (b.order || 0);
    });
  }

  /* ---------- writing a task in one line ---------- */

  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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
    take(/\b(every\s+day|daily|weekdays|every\s+week(?:day)?|every\s+(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday))\b/i, function (hit) {
      var word = hit[0].toLowerCase();
      if (/every\s+day|daily/.test(word)) { out.repeat = 'daily'; out.found.push('every day'); return; }
      if (/weekdays|every\s+weekday/.test(word)) { out.repeat = 'weekdays'; out.found.push('weekdays'); return; }
      if (hit[2]) {
        var index = WEEKDAYS.map(function (d) { return d.slice(0, 3); }).indexOf(hit[2].toLowerCase().slice(0, 3));
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
        var index = WEEKDAYS.map(function (d) { return d.slice(0, 3); }).indexOf(hit[1].toLowerCase().slice(0, 3));
        if (index === -1) return false;
        // a weekday only sets a due date when it is not already the repeat
        if (out.repeat === 'weekly' && out.weekday === index) return false;
        out.due = dayKeyFrom(nextWeekday(index));
        out.found.push('due ' + WEEKDAYS[index]);
        return;
      }
      return false;
    });

    out.title = text.replace(/\s{2,}/g, ' ').trim();
    var sniffed = Store.sniffTag ? Store.sniffTag(out.title) : null;
    if (sniffed) out.found.unshift(sniffed);
    return out;
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
    if (task.due) {
      var due = document.createElement('span');
      due.className = 'task-flag' + (task.due < key ? ' is-late' : '');
      due.textContent = dueLabel(task.due);
      meta.appendChild(due);
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

    var plan = document.createElement('button');
    plan.type = 'button';
    plan.className = 'task-plan';
    plan.title = scheduled[task.id] ? 'Already on ' + dayName(viewDate()) : 'Put on ' + dayName(viewDate());
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
    return item;
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
    due.type = 'date';
    due.value = task.due || '';
    due.addEventListener('change', function () { Store.updateTask(task.id, { due: due.value || null }); });
    grid.appendChild(field('due', due));

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
    remove.addEventListener('click', function () { ui.editing = null; Store.removeTask(task.id); });
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

    if (!ui.split) {
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

    el.splitBtn.addEventListener('click', function () {
      ui.split = !ui.split;
      // the chips mean something different in each mode, so never carry a
      // filter across and leave tasks quietly hidden in the other one
      ui.tags = [];
      savePrefs();
      render();
    });
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
      renderAdders();
      renderTasks();
      renderTimeline();
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
