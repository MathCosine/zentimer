/* The planner: lists and tags on one side, the day's timeline on the other.
   Reads and writes everything through Store. */
window.Plan = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var ui = {
    view: 'all',             // 'all' | listId
    tags: [],                // tag ids being filtered on
    showDone: false,
    expanded: false,
    pinned: false,
    editing: null            // block id being renamed
  };
  var hour12 = false;
  var hoverTimer = 0;
  var collapseTimer = 0;
  var peekTimer = 0;
  var dragging = null;
  var pendingRender = false;
  var pressed = false;

  var DAY_START = 5 * 60;    // the timeline runs 05:00 → midnight
  var DAY_END = 24 * 60;
  var COMPACT_PPM = 0.8;     // pixels per minute when tucked away
  var OPEN_PPM = 1.15;

  function ppm() { return ui.expanded ? OPEN_PPM : COMPACT_PPM; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function label(mins) { return Store.clockLabel(mins, hour12); }

  /* ---------- tasks ---------- */

  function visibleTasks() {
    var today = new Date();
    var key = Store.dayKey(today);
    return Store.tasks().filter(function (task) {
      if (ui.view !== 'all' && task.listId !== ui.view) return false;
      if (ui.tags.length && !ui.tags.some(function (t) { return (task.tags || []).indexOf(t) !== -1; })) return false;
      if (Store.repeats(task) && !Store.dueOn(task, today)) return false;
      if (!ui.showDone && Store.isDone(task, key)) return false;
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
    var d = new Date(due + 'T00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toLowerCase();
  }

  function renderViews() {
    el.views.textContent = '';
    var options = [{ id: 'all', name: 'everything' }].concat(Store.lists());
    options.forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.name;
      button.setAttribute('aria-current', String(ui.view === option.id));
      button.addEventListener('click', function () { ui.view = option.id; render(); });
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

  function renderTasks() {
    var key = Store.dayKey();
    var tasks = visibleTasks();
    el.taskList.textContent = '';

    if (!tasks.length) {
      var empty = document.createElement('li');
      empty.className = 'task-empty';
      empty.textContent = ui.tags.length ? 'nothing with those tags' : 'nothing here yet';
      el.taskList.appendChild(empty);
    }

    var scheduled = {};
    Store.blocks(key).forEach(function (b) { if (b.taskId) scheduled[b.taskId] = b; });

    tasks.forEach(function (task) {
      var done = Store.isDone(task, key);
      var item = document.createElement('li');
      item.className = 'task' + (done ? ' is-done' : '');
      item.dataset.id = task.id;

      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'task-tick';
      tick.setAttribute('aria-pressed', String(done));
      tick.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
      tick.addEventListener('click', function () { Store.toggleDone(task.id, key); });

      var body = document.createElement('div');
      body.className = 'task-body';

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
        rep.textContent = task.repeat === 'weekdays' ? 'weekdays' : task.repeat;
        meta.appendChild(rep);
      }
      if (task.due) {
        var due = document.createElement('span');
        due.className = 'task-flag' + (task.due < key ? ' is-late' : '');
        due.textContent = dueLabel(task.due);
        meta.appendChild(due);
      }
      if (scheduled[task.id]) {
        var when = document.createElement('span');
        when.className = 'task-flag is-planned';
        when.textContent = label(scheduled[task.id].start);
        meta.appendChild(when);
      }
      if (meta.children.length) body.appendChild(meta);

      var plan = document.createElement('button');
      plan.type = 'button';
      plan.className = 'task-plan';
      plan.title = scheduled[task.id] ? 'Already on the timeline' : 'Put on the timeline';
      plan.textContent = scheduled[task.id] ? '·' : '+';
      plan.addEventListener('click', function () {
        if (scheduled[task.id]) { flashBlock(scheduled[task.id].id); return; }
        var start = Store.findSlot(30, Store.minutesNow());
        Store.addBlock({ start: start, end: start + 30, taskId: task.id, title: task.title });
        peek();
      });

      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'task-more';
      more.setAttribute('aria-label', 'Task options');
      more.textContent = '⋯';
      more.addEventListener('click', function (event) { event.stopPropagation(); openTaskMenu(task, more); });

      item.appendChild(tick);
      item.appendChild(body);
      item.appendChild(plan);
      item.appendChild(more);
      el.taskList.appendChild(item);
    });

    var count = Store.tasks().filter(function (t) { return !Store.isDone(t, key); }).length;
    el.taskCount.textContent = count + (count === 1 ? ' open' : ' open');
  }

  /* ---------- the task menu ---------- */

  function openTaskMenu(task, anchor) {
    closeMenus();
    var menu = document.createElement('div');
    menu.className = 'menu';

    function row(text, fn, danger) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      if (danger) button.className = 'is-danger';
      button.addEventListener('click', function () { closeMenus(); fn(); });
      menu.appendChild(button);
    }

    row('rename', function () {
      var next = window.prompt('Task', task.title);
      if (next !== null && next.trim()) Store.updateTask(task.id, { title: next.trim().slice(0, 140) });
    });
    row('tags…', function () {
      var current = Store.tagsOf(task).map(function (t) { return t.name; }).join(' ');
      var next = window.prompt('Tags, separated by spaces', current);
      if (next !== null) Store.setTaskTags(task.id, next.split(/\s+/).filter(Boolean));
    });
    row(task.due ? 'due date (' + dueLabel(task.due) + ')' : 'due date…', function () {
      var next = window.prompt('Due date as YYYY-MM-DD, or blank to clear', task.due || Store.dayKey());
      if (next === null) return;
      Store.updateTask(task.id, { due: /^\d{4}-\d{2}-\d{2}$/.test(next.trim()) ? next.trim() : null });
    });
    row('repeat: ' + (task.repeat || 'none'), function () {
      var order = ['none', 'daily', 'weekdays', 'weekly'];
      var next = order[(order.indexOf(task.repeat || 'none') + 1) % order.length];
      Store.updateTask(task.id, { repeat: next, weekday: next === 'weekly' ? new Date().getDay() : null });
    });
    Store.lists().forEach(function (list) {
      if (list.id === task.listId) return;
      row('move to ' + list.name, function () { Store.updateTask(task.id, { listId: list.id }); });
    });
    row('delete', function () { Store.removeTask(task.id); }, true);

    document.body.appendChild(menu);
    var box = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.right - menu.offsetWidth)) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, box.bottom + 6) + 'px';
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('.menu'), function (m) { m.remove(); });
  }

  /* ---------- the timeline ---------- */

  function viewWindow() {
    if (ui.expanded) return { from: DAY_START, to: DAY_END };
    var box = el.timelineWrap.clientHeight - 16;
    var minutes = clamp(Math.round((box / COMPACT_PPM) / 30) * 30, 120, 480);
    var now = Store.minutesNow();
    var from = clamp(Math.round((now - minutes / 2) / 15) * 15, DAY_START, DAY_END - minutes);
    return { from: from, to: from + minutes };
  }

  function renderTimeline() {
    var span = viewWindow();
    var scale = ppm();
    var height = (span.to - span.from) * scale;
    el.timeline.style.height = height + 'px';
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

    var key = Store.dayKey();
    var now = Store.minutesNow();
    Store.blocks(key).forEach(function (block) {
      if (block.end < span.from || block.start > span.to) return;
      el.timeline.appendChild(blockNode(block, span, scale, now));
    });

    var nowLine = document.createElement('div');
    nowLine.className = 'now-line';
    nowLine.style.top = ((now - span.from) * scale) + 'px';
    el.timeline.appendChild(nowLine);

    if (!ui.expanded) el.timeline.parentNode.scrollTop = 0;
  }

  function blockNode(block, span, scale, now) {
    var task = block.taskId ? Store.taskById(block.taskId) : null;
    var tag = task ? Store.tagsOf(task)[0] : null;
    var node = document.createElement('div');
    var running = now >= block.start && now < block.end && !block.done;
    var over = !block.done && now >= block.end;

    node.className = 'block' + (tag ? ' tone-' + tag.color : '') +
      (block.done ? ' is-done' : '') + (running ? ' is-now' : '') + (over ? ' is-over' : '');
    node.dataset.id = block.id;
    node.style.top = ((block.start - span.from) * scale) + 'px';
    node.style.height = Math.max(18, (block.end - block.start) * scale - 2) + 'px';

    var title = document.createElement('span');
    title.className = 'block-title';
    title.textContent = block.title || (task ? task.title : 'block');
    node.appendChild(title);

    var when = document.createElement('span');
    when.className = 'block-when';
    when.textContent = label(block.start) + '–' + label(block.end) + (block.ranOver ? ' (+' + block.ranOver + 'm)' : '');
    node.appendChild(when);

    var grip = document.createElement('span');
    grip.className = 'block-grip';
    node.appendChild(grip);

    node.addEventListener('pointerdown', function (event) {
      if (event.target === grip) startDrag(event, block, node, 'resize');
      else startDrag(event, block, node, 'move');
    });
    node.addEventListener('dblclick', function () { renameBlock(block); });
    node.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      openBlockMenu(block, node);
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
    var moved = false;
    var latest = { start: origin.start, end: origin.end };
    clearTimeout(hoverTimer);          // no expanding out from under the gesture
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
      if (e && typeof e.clientY === 'number') onMove(e);   // settle on where the pointer really ended up
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      node.classList.remove('is-dragging');
      dragging = null;
      if (moved && (latest.start !== origin.start || latest.end !== origin.end)) {
        Store.updateBlock(block.id, { start: latest.start, end: latest.end });
      } else if (!moved) {
        openBlockMenu(block, node);
      }
      if (pendingRender) { pendingRender = false; render(); }
    }

    /* on the document, so a coalesced or fast gesture cannot slip past the node */
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function renameBlock(block) {
    var next = window.prompt('Block', block.title || '');
    if (next !== null) Store.updateBlock(block.id, { title: next.trim().slice(0, 140) });
  }

  function openBlockMenu(block, node) {
    closeMenus();
    var menu = document.createElement('div');
    menu.className = 'menu';

    function row(text, fn, danger) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      if (danger) button.className = 'is-danger';
      button.addEventListener('click', function () { closeMenus(); fn(); });
      menu.appendChild(button);
    }

    row(block.done ? 'not finished' : 'finished', function () {
      Store.updateBlock(block.id, { done: !block.done });
      if (!block.done && block.taskId) {
        var task = Store.taskById(block.taskId);
        if (task && !Store.isDone(task)) Store.toggleDone(task.id);
      }
    });
    row('rename', function () { renameBlock(block); });
    row('+15 min', function () { Store.updateBlock(block.id, { end: Math.min(DAY_END, block.end + 15) }); });
    row('−15 min', function () { Store.updateBlock(block.id, { end: Math.max(block.start + 15, block.end - 15) }); });
    row('push the rest 15m later', function () { Store.shiftAfter(block.id, 15); });
    row('remove', function () { Store.removeBlock(block.id); }, true);

    document.body.appendChild(menu);
    var box = node.getBoundingClientRect();
    menu.style.left = clamp(box.left, 8, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = clamp(box.bottom + 6, 8, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }

  function flashBlock(blockId) {
    peek();
    setTimeout(function () {
      var node = el.timeline.querySelector('[data-id="' + blockId + '"]');
      if (!node) return;
      node.classList.add('is-flash');
      setTimeout(function () { node.classList.remove('is-flash'); }, 900);
    }, 60);
  }

  /* clicking empty space plans something of your own */
  function onTimelineClick(event) {
    if (event.target !== el.timeline) return;
    var from = +el.timeline.dataset.from;
    var minutes = Math.round((from + (event.offsetY / ppm())) / 15) * 15;
    var title = window.prompt('What are you doing at ' + label(minutes) + '?', '');
    if (title === null || !title.trim()) return;
    Store.addBlock({ start: minutes, end: minutes + 30, title: title.trim() });
  }

  /* ---------- the now strip ---------- */

  function renderNow() {
    var now = Store.minutesNow();
    var block = Store.currentBlock(now);
    var over = block ? null : Store.overrunBlock(now);
    var next = Store.nextBlock(now);

    el.nowStrip.classList.toggle('is-over', !!over);
    el.nowShift.hidden = true;

    if (block) {
      var task = block.taskId ? Store.taskById(block.taskId) : null;
      el.nowTitle.textContent = block.title || (task ? task.title : 'block');
      el.nowWhen.textContent = 'until ' + label(block.end) + ' · ' + (block.end - now) + 'm left';
    } else if (over) {
      var late = now - over.end;
      el.nowTitle.textContent = over.title || 'unfinished';
      el.nowWhen.textContent = late + 'm over — still going?';
      el.nowShift.hidden = false;
      el.nowShift.textContent = 'push the rest ' + late + 'm';
      el.nowShift.onclick = function () { Store.shiftAfter(over.id, late); };
    } else if (next) {
      el.nowTitle.textContent = 'free until ' + label(next.start);
      el.nowWhen.textContent = 'next: ' + (next.title || 'block') + ' at ' + label(next.start);
    } else {
      el.nowTitle.textContent = 'nothing planned';
      el.nowWhen.textContent = 'tap + on a task to drop it on the timeline';
    }
  }

  /* ---------- opening and closing the timeline ---------- */

  function openTimeline(open, pin) {
    if (dragging) return;
    ui.expanded = open;
    if (typeof pin === 'boolean') ui.pinned = pin;
    el.planCard.classList.toggle('is-open', open);
    el.planCard.classList.toggle('is-pinned', ui.pinned && open);
    renderTimeline();
    if (open) {
      var now = Store.minutesNow();
      el.timelineWrap.scrollTop = Math.max(0, (now - DAY_START - 110) * ppm());
    }
  }

  function collapseSoon(delay) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(function () {
      if (!ui.pinned && !dragging && !document.querySelector('.menu')) openTimeline(false);
    }, delay || 260);
  }

  /* a look at where something landed, then it tucks itself away again */
  function peek() {
    openTimeline(true);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () { if (!ui.pinned) collapseSoon(60); }, 1600);
  }

  function wireTimelineHover() {
    document.addEventListener('pointerdown', function () { pressed = true; clearTimeout(hoverTimer); }, true);
    document.addEventListener('pointerup', function () { pressed = false; });

    el.timelineWrap.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'touch' || ui.pinned || ui.expanded || dragging || pressed) return;
      clearTimeout(collapseTimer);
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { if (!pressed && !dragging) openTimeline(true); }, 320);
    });

    /* while it is open, watch the pointer against its real box — the box moves
       when it expands, so pointerleave on its own is not to be trusted */
    document.addEventListener('pointermove', function (event) {
      if (!ui.expanded || ui.pinned || dragging) return;
      var box = el.planCard.getBoundingClientRect();
      var outside = event.clientX < box.left - 28 || event.clientX > box.right + 28 ||
                    event.clientY < box.top - 28 || event.clientY > box.bottom + 28;
      if (outside) collapseSoon(); else clearTimeout(collapseTimer);
    });

    el.timelineWrap.addEventListener('pointerleave', function (event) {
      clearTimeout(hoverTimer);
      if (!ui.expanded && event.pointerType !== 'touch') return;
      if (!ui.pinned && !dragging) collapseSoon(400);
    });

    el.timeline.addEventListener('click', onTimelineClick);

    el.pinBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      ui.pinned = !ui.pinned;
      el.pinBtn.setAttribute('aria-pressed', String(ui.pinned));
      openTimeline(ui.pinned || ui.expanded, ui.pinned);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !ui.expanded) return;
      if (document.querySelector('.menu')) return;
      ui.pinned = false;
      el.pinBtn.setAttribute('aria-pressed', 'false');
      openTimeline(false);
    });

    document.addEventListener('pointerdown', function (event) {
      if (!ui.expanded) return;
      if (el.planCard.contains(event.target) || event.target.closest('.menu')) return;
      ui.pinned = false;
      el.pinBtn.setAttribute('aria-pressed', 'false');
      openTimeline(false);
    }, true);
  }

  /* ---------- adding ---------- */

  function wireAdding() {
    el.taskAdd.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = el.taskInput.value.trim();
      if (!value) return;
      var listId = ui.view !== 'all' ? ui.view : (Store.lists()[0] || {}).id;
      value.split('\n').forEach(function (line) {
        if (line.trim()) Store.addTask({ title: line.trim(), listId: listId });
      });
      el.taskInput.value = '';
    });

    el.bulkBtn.addEventListener('click', function () {
      var text = window.prompt('Paste tasks, one per line.\nA capitalised first word (PHY, MSB) becomes a tag.', '');
      if (!text) return;
      var listId = ui.view !== 'all' ? ui.view : (Store.lists()[0] || {}).id;
      text.split('\n').forEach(function (line) {
        if (line.trim()) Store.addTask({ title: line.trim(), listId: listId });
      });
    });

    el.listBtn.addEventListener('click', function () {
      var name = window.prompt('New list name', '');
      if (name && name.trim()) { var list = Store.addList(name.trim()); ui.view = list.id; render(); }
    });

    el.doneBtn.addEventListener('click', function () {
      ui.showDone = !ui.showDone;
      el.doneBtn.setAttribute('aria-pressed', String(ui.showDone));
      render();
    });
  }

  /* ---------- api ---------- */

  function render() {
    if (!el.timeline) return;           // before init, there is nothing to draw
    if (dragging) { pendingRender = true; return; }
    renderViews();
    renderChips();
    renderTasks();
    renderTimeline();
    renderNow();
  }

  function tick() {
    if (!el.timeline || dragging) return;
    renderTimeline();
    renderNow();
  }

  function init(prefs) {
    el = {
      views: $('views'), tagChips: $('tagChips'), taskList: $('taskList'), taskCount: $('taskCount'),
      taskAdd: $('taskAdd'), taskInput: $('taskInput'), bulkBtn: $('bulkBtn'), listBtn: $('listBtn'),
      doneBtn: $('doneBtn'), timelineWrap: $('timelineWrap'), timeline: $('timeline'), pinBtn: $('pinBtn'),
      nowStrip: $('nowStrip'), nowTitle: $('nowTitle'), nowWhen: $('nowWhen'), nowShift: $('nowShift'),
      planCard: document.querySelector('.plan-card')
    };
    if (!el.timeline) return;
    hour12 = !!(prefs && prefs.hour12);

    Store.init();
    Store.subscribe(render);
    wireTimelineHover();
    wireAdding();
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.menu')) closeMenus();
    });
    render();
  }

  return {
    init: init,
    render: render,
    tick: tick,
    setHour12: function (on) { if (hour12 !== !!on) { hour12 = !!on; render(); } },
    currentBlock: function () { return Store.currentBlock(); },
    openTimeline: openTimeline
  };
})();
