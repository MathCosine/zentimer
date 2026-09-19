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
    adding: null             // 'paste' | 'list' | null
  };
  var hour12 = false;
  var hoverTimer = 0, collapseTimer = 0, peekTimer = 0;
  var dwellAt = null;
  var dragging = null, pendingRender = false, pressed = false;

  var DAY_START = 5 * 60;
  var DAY_END = 24 * 60;
  var COMPACT_PPM = 0.8;
  var OPEN_PPM = 1.15;

  function ppm() { return ui.expanded ? OPEN_PPM : COMPACT_PPM; }

  /* The timeline takes whatever room the window actually has, measured rather
     than guessed, and never so much that the task list is squeezed to nothing. */
  var TASK_FLOOR = 180;   // the list never shrinks below this

  function sizeTimeline() {
    if (!el.timelineWrap || !el.planCard) return;
    var app = document.querySelector('.app');
    var bar = document.querySelector('.bar');
    var extras = document.querySelector('.extras');
    if (!app) return;

    // wide screens hand the timeline its own column row; the stylesheet fills it
    if (window.innerWidth >= 900) { el.timelineWrap.style.height = ''; return; }

    var tall = window.innerHeight;
    var style = getComputedStyle(app);
    var frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 9 * 3;
    var chrome = el.planCard.offsetHeight - el.timelineWrap.offsetHeight;
    var tasks = document.querySelector('.tasks-card');
    var list = document.querySelector('.task-list');
    var taskFloor = (tasks && list ? tasks.offsetHeight - list.offsetHeight : 103) + TASK_FLOOR;
    var used = (bar ? bar.offsetHeight : 140) + (extras ? extras.offsetHeight : 76) + chrome + frame;

    var room = tall - used;
    var shut = clamp(Math.round(tall * 0.20), 126, 320);
    // opened on purpose, so the list gives up more of the room
    var open = clamp(room - Math.round(taskFloor * 0.8), 220, 1100);
    if (open < shut) open = shut;

    el.timelineWrap.style.height = (ui.expanded ? open : shut) + 'px';
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
      if (Store.repeats(task) && !Store.dueOn(task, today)) return false;
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
    tags.forEach(function (tag) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip tone-' + tag.color;
      chip.textContent = tag.name;
      chip.setAttribute('aria-pressed', String(ui.tags.indexOf(tag.id) !== -1));
      chip.addEventListener('click', function () {
        var at = ui.tags.indexOf(tag.id);
        if (at === -1) ui.tags.push(tag.id); else ui.tags.splice(at, 1);
        render();
      });
      el.tagChips.appendChild(chip);
    });
    if (ui.tags.length) {
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'chip chip-clear';
      clear.textContent = 'clear';
      clear.addEventListener('click', function () { ui.tags = []; render(); });
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
      render();
    });

    var title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;
    body.appendChild(title);

    var meta = document.createElement('span');
    meta.className = 'task-meta';
    Store.tagsOf(task).forEach(function (tag) {
      var badge = document.createElement('span');
      badge.className = 'tag tone-' + tag.color;
      badge.textContent = tag.name;
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
    // a routine sitting at its usual time already says so above
    if (slot && !(slot.routine && slot.start === task.at)) {
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
    plan.addEventListener('click', function (event) {
      event.stopPropagation();
      if (scheduled[task.id]) { selectBlock(scheduled[task.id].id); return; }
      var day = viewDate();
      var from = isToday() ? Store.minutesNow() : 9 * 60;
      var start = Store.findSlot(task.mins || 30, from, day);
      var block = Store.addBlock({ date: day, start: start, end: start + (task.mins || 30), taskId: task.id, title: task.title });
      selectBlock(block.id);
      peek();
    });
    item.appendChild(plan);
    return item;
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
    title.addEventListener('input', function () { task.title = title.value.slice(0, 140); Store.notify(); });
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

    var repeat = document.createElement('select');
    [['none', 'never'], ['daily', 'every day'], ['weekdays', 'weekdays'], ['weekly', 'weekly']].forEach(function (pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      if ((task.repeat || 'none') === pair[0]) option.selected = true;
      repeat.appendChild(option);
    });
    repeat.addEventListener('change', function () {
      Store.updateTask(task.id, {
        repeat: repeat.value,
        weekday: repeat.value === 'weekly' ? new Date(viewDate() + 'T12:00').getDay() : null
      });
      render();
    });
    grid.appendChild(field('repeat', repeat));

    if (Store.repeats(task)) {
      var at = document.createElement('input');
      at.type = 'time';
      at.value = typeof task.at === 'number' ? hhmm(task.at) : '';
      at.addEventListener('change', function () {
        var parts = at.value.split(':');
        var minutes = at.value ? (+parts[0]) * 60 + (+parts[1]) : null;
        Store.updateTask(task.id, { at: minutes });
        if (minutes !== null) Store.ensureRoutine(viewDate());
        render();
      });
      grid.appendChild(field('at', at));

      var mins = document.createElement('input');
      mins.type = 'number';
      mins.min = '5';
      mins.step = '5';
      mins.value = task.mins || 30;
      mins.addEventListener('change', function () {
        Store.updateTask(task.id, { mins: clamp(+mins.value || 30, 5, 600) });
      });
      grid.appendChild(field('minutes', mins));
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

  function renderTasks() {
    var key = Store.dayKey();
    var tasks = visibleTasks();
    el.taskList.textContent = '';

    var scheduled = {};
    Store.blocks(viewDate()).forEach(function (b) { if (b.taskId) scheduled[b.taskId] = b; });

    if (!tasks.length) {
      var empty = document.createElement('li');
      empty.className = 'task-empty';
      empty.textContent = ui.tags.length ? 'nothing with those tags' : 'nothing here yet';
      el.taskList.appendChild(empty);
    }

    tasks.forEach(function (task) { el.taskList.appendChild(taskRow(task, key, scheduled)); });

    var open = Store.tasks().filter(function (t) { return !Store.isDone(t, key); }).length;
    paint(el.taskCount, open + ' open');
  }

  /* ---------- the timeline ---------- */

  function viewWindow() {
    // opened means the whole day, scrolled to where you are — not a bigger peephole
    if (ui.expanded) return { from: DAY_START, to: DAY_END };
    var box = el.timelineWrap.clientHeight - 16;
    var scale = ppm();
    var minutes = clamp(Math.round((box / scale) / 30) * 30, 120, DAY_END - DAY_START);
    if (minutes >= DAY_END - DAY_START) return { from: DAY_START, to: DAY_END };
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
  function onTimelineDraw(event) {
    if (event.target !== el.timeline || event.button === 2) return;
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
    el.pinBtn.setAttribute('aria-pressed', String(ui.pinned));
    sizeTimeline();
    // let the height transition run, then redraw at the new scale
    setTimeout(function () { if (!dragging) { renderTimeline(); scrollToNow(); } }, open ? 300 : 0);
    renderTimeline();
    scrollToNow();
  }

  function scrollToNow() {
    if (!ui.expanded) { el.timelineWrap.scrollTop = 0; return; }
    var focus = isToday() ? Store.minutesNow() : (Store.blocks(viewDate())[0] || { start: 9 * 60 }).start;
    var target = (focus - DAY_START - 90) * ppm();
    el.timelineWrap.scrollTop = Math.max(0, target);
  }

  function collapseSoon(delay) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(function () {
      if (!ui.pinned && !dragging && !ui.selected && !el.timelineWrap.contains(document.activeElement)) openTimeline(false);
    }, delay || 320);
  }

  function peek() {
    openTimeline(true);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () { if (!ui.pinned && !ui.selected) collapseSoon(60); }, 2200);
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
      }, 260);
    });

    el.timelineWrap.addEventListener('pointerleave', function () {
      clearTimeout(hoverTimer);
      dwellAt = null;
    });

    document.addEventListener('pointermove', function (event) {
      if (!ui.expanded || ui.pinned || dragging) return;
      var box = el.planCard.getBoundingClientRect();
      var outside = event.clientX < box.left - 40 || event.clientX > box.right + 40 ||
                    event.clientY < box.top - 40 || event.clientY > box.bottom + 40;
      if (outside) collapseSoon(); else clearTimeout(collapseTimer);
    });

    el.timeline.addEventListener('pointerdown', onTimelineDraw);

    el.pinBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      ui.pinned = !ui.pinned;
      openTimeline(ui.pinned || ui.expanded, ui.pinned);
    });

    el.dayPrev.addEventListener('click', function () { shiftDay(-1); });
    el.dayNext.addEventListener('click', function () { shiftDay(1); });
    el.dayLabel.addEventListener('click', function () { ui.date = null; ui.selected = null; render(); });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var tag = (event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (ui.selected) { ui.selected = null; render(); return; }
      if (ui.editing) { closeEditor(); return; }
      if (ui.expanded) { ui.pinned = false; openTimeline(false, false); }
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
      var value = el.taskInput.value.trim();
      if (!value) return;
      var listId = ui.view !== 'all' ? ui.view : (Store.lists()[0] || {}).id;
      Store.addTask({ title: value, listId: listId });
      el.taskInput.value = '';
    });

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
  }

  /* ---------- api ---------- */

  /* a redraw replaces the very field being typed into, so put the caret back */
  function keepingFocus(draw) {
    var active = document.activeElement;
    var key = active && active.dataset ? active.dataset.focusKey : null;
    var start = null, end = null;
    if (key) {
      try { start = active.selectionStart; end = active.selectionEnd; } catch (e) { /* not a text field */ }
    }
    draw();
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
      doneBtn: $('doneBtn'), addPanel: $('addPanel'),
      timelineWrap: $('timelineWrap'), timeline: $('timeline'), pinBtn: $('pinBtn'), blockBar: $('blockBar'),
      nowStrip: $('nowStrip'), nowTitle: $('nowTitle'), nowWhen: $('nowWhen'), nowShift: $('nowShift'),
      dayPrev: $('dayPrev'), dayNext: $('dayNext'), dayLabel: $('dayLabel'), daySum: $('daySum'),
      planCard: document.querySelector('.plan-card')
    };
    if (!el.timeline) return;
    hour12 = !!(prefs && prefs.hour12);

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
    render: render,
    tick: tick,
    setHour12: function (on) { if (hour12 !== !!on) { hour12 = !!on; render(); } },
    day: viewDate,
    goToDay: function (key) { ui.date = key === Store.dayKey() ? null : key; render(); },
    currentBlock: function () { return Store.currentBlock(); },
    openTimeline: openTimeline
  };
})();
