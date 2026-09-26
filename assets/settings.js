/* The settings page: one place for everything that used to be scattered across
   the tool row, plus the things there was never anywhere to put — editing tags,
   choosing your own timer lengths, saying when your day starts, and seeing
   where the week's hours went. It is a page, not a dialog: it takes the place
   of the plan and the list, and a back button returns you. */
window.Panel = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var api = null;
  var open = false;
  var merging = null;      // a tag id waiting to be merged into another

  /* ---------- small builders ---------- */

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function section(title, note) {
    var box = node('section', 'set-group');
    var head = node('h3', 'set-title', title);
    box.appendChild(head);
    if (note) box.appendChild(node('p', 'set-note', note));
    el.body.appendChild(box);
    return box;
  }

  function row(box, label, control, note) {
    var line = node('div', 'set-row');
    var name = node('div', 'set-label');
    name.appendChild(node('span', null, label));
    if (note) name.appendChild(node('small', null, note));
    line.appendChild(name);
    line.appendChild(control);
    box.appendChild(line);
    return line;
  }

  function toggle(on, onChange) {
    var button = node('button', 'set-toggle');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(!!on));
    button.appendChild(node('span', 'set-knob'));
    button.addEventListener('click', function () {
      var next = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(next));
      onChange(next);
    });
    return button;
  }

  function choice(options, value, onPick) {
    var wrap = node('div', 'pick-row');
    options.forEach(function (option) {
      var chip = node('button', 'pick', option.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(option.value === value));
      chip.addEventListener('click', function () { onPick(option.value); });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function number(value, min, max, step, onChange) {
    var input = node('input', 'set-number');
    input.type = 'number';
    input.min = min; input.max = max; input.step = step;
    input.value = value;
    input.addEventListener('change', function () {
      var n = Math.max(min, Math.min(max, +input.value || min));
      input.value = n;
      onChange(n);
    });
    return input;
  }

  function hhmm(mins) {
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  /* ---------- the sections ---------- */

  function drawTimer() {
    var box = section('timer', 'the lengths you actually use');

    var lengths = node('div', 'set-lengths');
    api.presets().forEach(function (mins, index) {
      var field = node('label', 'set-length');
      var input = node('input');
      input.type = 'number';
      input.min = 1; input.max = 600; input.step = 5;
      input.value = mins;
      input.setAttribute('aria-label', 'Preset ' + (index + 1) + ' in minutes');
      input.addEventListener('change', function () {
        var list = api.presets().slice();
        list[index] = Math.max(1, Math.min(600, +input.value || mins));
        api.setPresets(list);
        draw();
      });
      field.appendChild(input);
      var drop = node('button', 'set-drop', '×');
      drop.type = 'button';
      drop.title = 'Remove this length';
      drop.addEventListener('click', function () {
        var list = api.presets().filter(function (_, i) { return i !== index; });
        if (list.length) { api.setPresets(list); draw(); }
      });
      field.appendChild(drop);
      lengths.appendChild(field);
    });
    if (api.presets().length < 8) {
      var add = node('button', 'set-add', '+');
      add.type = 'button';
      add.title = 'Another length';
      add.addEventListener('click', function () {
        var list = api.presets().slice();
        list.push(25);
        api.setPresets(list);
        draw();
      });
      lengths.appendChild(add);
    }
    row(box, 'session lengths', lengths, 'minutes');

    row(box, 'break', number(Math.round(api.breakMs() / 60000), 1, 120, 1, function (n) {
      api.setBreakMs(n * 60000);
    }), 'minutes between sessions');

    row(box, 'chime', toggle(api.sound(), api.setSound), 'a sound when time is up');
    row(box, 'notify', toggle(api.notify(), function (on) { api.setNotify(on); }),
      'a system notification too');
  }

  function drawLoad() {
    var box = section('a full day', 'the point at which today is asking too much');
    var caps = window.Plan ? Plan.caps() : { work: 330, practice: 240 };

    row(box, 'homework', number(caps.work / 60, 0.5, 15, 0.5, function (h) {
      api.setLoad(Math.round(h * 60), Plan.caps().practice);
    }), 'hours in a day');

    row(box, 'practice', number(caps.practice / 60, 0, 15, 0.5, function (h) {
      api.setLoad(Plan.caps().work, Math.round(h * 60));
    }), 'hours in a day');

    box.appendChild(node('p', 'set-note',
      'Work is spread to finish two days before it is due. When that asks for ' +
      'more than this, today says so rather than pretending.'));
  }

  function drawDay() {
    var box = section('your day', 'the hours the timeline covers');
    var starts = node('input', 'set-time');
    starts.type = 'time';
    starts.value = hhmm(api.dayStart());
    starts.addEventListener('change', function () {
      var parts = starts.value.split(':');
      if (starts.value) api.setDay((+parts[0]) * 60 + (+parts[1]), api.dayEnd());
      draw();
    });
    row(box, 'day starts', starts);

    var ends = node('input', 'set-time');
    ends.type = 'time';
    ends.value = api.dayEnd() >= 1440 ? '23:59' : hhmm(api.dayEnd());
    ends.addEventListener('change', function () {
      var parts = ends.value.split(':');
      if (ends.value) api.setDay(api.dayStart(), (+parts[0]) * 60 + (+parts[1]));
      draw();
    });
    row(box, 'day ends', ends);

    row(box, 'clock', choice(
      [{ label: '24 hour', value: false }, { label: '12 hour', value: true }],
      api.hour12(), function (v) { api.setHour12(v); draw(); }));
  }

  function drawTags() {
    var box = section('tags', 'rename one and every task wearing it follows');
    var list = node('div', 'tag-rows');
    var tags = Store.tags();

    if (!tags.length) {
      list.appendChild(node('p', 'set-empty', 'no tags yet — start a task with a word like PHY'));
    }

    tags.forEach(function (tag) {
      var line = node('div', 'tag-row' + (merging === tag.id ? ' is-merging' : ''));

      var swatch = node('button', 'tag-swatch tone-' + tag.color);
      swatch.type = 'button';
      swatch.title = 'Next colour';
      swatch.addEventListener('click', function () {
        var colours = Store.tagColors();
        Store.recolourTag(tag.id, colours[(colours.indexOf(tag.color) + 1) % colours.length]);
        draw();
      });
      line.appendChild(swatch);

      var name = node('input', 'tag-name');
      name.type = 'text';
      name.value = tag.name;
      name.dataset.focusKey = 'tag:' + tag.id;
      name.addEventListener('change', function () {
        Store.renameTag(tag.id, name.value);
        draw();
      });
      line.appendChild(name);

      line.appendChild(node('span', 'tag-use', Store.tagUse(tag.id)));

      /* What a tag is for. A subject has real deadlines; practice is something
         you do most days, where doing most of it is the point. */
      var isPractice = tag.kind === 'practice';
      var kind = node('button', 'tag-act tag-kind' + (isPractice ? ' is-practice' : ''),
        isPractice ? 'practice' : 'subject');
      kind.type = 'button';
      kind.title = isPractice
        ? 'Doing most of it is enough; it never crowds out real deadlines'
        : 'Deadlines on this tag are real';
      kind.addEventListener('click', function () {
        Store.setTagKind(tag.id, isPractice ? 'work' : 'practice');
        draw();
      });
      line.appendChild(kind);

      var merge = node('button', 'tag-act', merging === tag.id ? 'cancel' : 'merge');
      merge.type = 'button';
      merge.title = merging === tag.id ? 'Stop merging' : 'Merge this into another tag';
      merge.addEventListener('click', function () {
        merging = merging === tag.id ? null : tag.id;
        draw();
      });
      line.appendChild(merge);

      var drop = node('button', 'tag-act is-drop', 'delete');
      drop.type = 'button';
      drop.addEventListener('click', function () {
        Store.removeTag(tag.id);
        if (merging === tag.id) merging = null;
        draw();
      });
      drop.title = 'It goes to the bin, below, for ' + Store.binDays + ' days';
      line.appendChild(drop);

      // while a merge is armed, every other row becomes the destination
      if (merging && merging !== tag.id) {
        var into = node('button', 'tag-into', 'merge into this');
        into.type = 'button';
        into.addEventListener('click', function () {
          Store.mergeTags(merging, tag.id);
          merging = null;
          draw();
        });
        line.appendChild(into);
      }

      list.appendChild(line);

      if (isPractice) {
        var how = Store.practiceToday(tag.id);
        var note = node('div', 'tag-sub');
        note.appendChild(node('span', null, 'a day\u2019s worth is'));
        var many = number(how.want, 1, 20, 1, function (n) {
          Store.setTagKind(tag.id, 'practice', n);
          draw();
        });
        many.className = 'set-number tag-daily';
        note.appendChild(many);
        note.appendChild(node('span', 'tag-of', 'of ' + how.of +
          ' \u00b7 ' + how.done + ' done today' + (how.enough ? ' \u2713' : '')));
        list.appendChild(note);
      }
    });

    box.appendChild(list);
    if (merging) box.appendChild(node('p', 'set-note', 'pick the tag to merge into, or cancel'));
  }

  function drawLists() {
    var box = section('lists', 'the groups your tasks live in');
    var rows = node('div', 'tag-rows');
    var lists = Store.lists();

    lists.forEach(function (entry) {
      var line = node('div', 'tag-row');
      var name = node('input', 'tag-name');
      name.type = 'text';
      name.value = entry.name;
      name.dataset.focusKey = 'list:' + entry.id;
      name.addEventListener('change', function () { Store.renameList(entry.id, name.value); draw(); });
      line.appendChild(name);

      var count = Store.tasks().filter(function (t) { return t.listId === entry.id; }).length;
      line.appendChild(node('span', 'tag-use', count));

      if (lists.length > 1) {
        var drop = node('button', 'tag-act is-drop', 'delete');
        drop.type = 'button';
        drop.title = count ? 'Its tasks move to the first list' : 'Remove this list';
        drop.title = (count ? 'Its tasks move to the first list. ' : '') +
          'It goes to the bin for ' + Store.binDays + ' days';
        drop.addEventListener('click', function () { Store.removeList(entry.id); draw(); });
        line.appendChild(drop);
      }
      rows.appendChild(line);
    });

    var add = node('button', 'set-add wide', '+ new list');
    add.type = 'button';
    add.addEventListener('click', function () { Store.addList('New list'); draw(); });
    rows.appendChild(add);
    box.appendChild(rows);
  }

  /* ---------- where the week went ---------- */

  function weekStats() {
    var days = [], total = 0, byTag = {}, streak = 0, keys = {};
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = Store.dayKey(d);
      var mins = Math.round(Store.loggedOn(key) / 60000);
      keys[key] = true;
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), mins: mins });
      total += mins;
    }

    // consecutive days with anything logged, counting back; today still being
    // empty does not break a run that is otherwise going
    for (var j = 0; j < 400; j++) {
      var back = new Date();
      back.setDate(back.getDate() - j);
      if (Store.loggedOn(Store.dayKey(back)) > 0) streak++;
      else if (j > 0) break;
    }

    Store.state().logs.forEach(function (log) {
      if (!keys[log.date]) return;
      var task = log.taskId ? Store.taskById(log.taskId) : null;
      var names = task ? Store.tagsOf(task).map(function (t) { return t.name; }) : [];
      var name = names[0] || (task ? 'untagged' : 'unplanned');
      byTag[name] = (byTag[name] || 0) + Math.round((log.ms || 0) / 60000);
    });

    return { days: days, total: total, byTag: byTag, streak: streak };
  }

  function spanLabel(mins) {
    if (!mins) return '0m';
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm';
  }

  function drawStats() {
    var box = section('this week', 'measured from the sessions you ran');
    var week = weekStats();

    var top = node('div', 'stat-heads');
    [['focused', spanLabel(week.total)], ['streak', week.streak + (week.streak === 1 ? ' day' : ' days')],
     ['a day', spanLabel(Math.round(week.total / 7))]].forEach(function (pair) {
      var tile = node('div', 'stat-tile');
      tile.appendChild(node('strong', null, pair[1]));
      tile.appendChild(node('span', null, pair[0]));
      top.appendChild(tile);
    });
    box.appendChild(top);

    var most = Math.max.apply(null, week.days.map(function (d) { return d.mins; }).concat([30]));
    var chart = node('div', 'stat-bars');
    week.days.forEach(function (day) {
      var col = node('div', 'stat-bar');
      var fill = node('span', 'stat-fill');
      fill.style.height = Math.round((day.mins / most) * 100) + '%';
      if (!day.mins) fill.classList.add('is-empty');
      col.appendChild(fill);
      col.appendChild(node('small', null, day.label));
      col.title = day.label + ' · ' + spanLabel(day.mins);
      chart.appendChild(col);
    });
    box.appendChild(chart);

    var names = Object.keys(week.byTag).sort(function (a, b) { return week.byTag[b] - week.byTag[a]; });
    if (names.length) {
      var split = node('div', 'stat-split');
      names.slice(0, 6).forEach(function (name) {
        var line = node('div', 'stat-line');
        line.appendChild(node('span', 'stat-name', name));
        var track = node('span', 'stat-track');
        var bar = node('span', 'stat-of');
        bar.style.width = Math.round((week.byTag[name] / Math.max(1, week.total)) * 100) + '%';
        track.appendChild(bar);
        line.appendChild(track);
        line.appendChild(node('span', 'stat-mins', spanLabel(week.byTag[name])));
        split.appendChild(line);
      });
      box.appendChild(split);
    } else {
      box.appendChild(node('p', 'set-empty', 'run a session against a planned block and it shows up here'));
    }
  }

  function drawBin() {
    var gone = Store.binned();
    if (!gone.length) return;
    var box = section('the bin', 'deleted things wait ' + Store.binDays + ' days before they really go');
    var rows = node('div', 'tag-rows');
    var naming = { tasks: 'task', blocks: 'block', tags: 'tag', lists: 'list', logs: 'session' };

    gone.slice(0, 20).forEach(function (item) {
      var line = node('div', 'tag-row');
      var name = node('div', 'set-label');
      name.appendChild(node('span', null, item.what));
      var days = Math.max(0, Store.binDays - Math.floor((Date.now() - item.at) / 86400000));
      name.appendChild(node('small', null, naming[item.table] + ' \u00b7 ' +
        (days ? days + ' days left' : 'going today')));
      line.appendChild(name);
      var back = node('button', 'tag-act', 'put back');
      back.type = 'button';
      back.addEventListener('click', function () { Store.unbury(item.table, item.id); draw(); });
      line.appendChild(back);
      rows.appendChild(line);
    });

    if (gone.length > 20) rows.appendChild(node('p', 'set-note', 'and ' + (gone.length - 20) + ' more'));
    box.appendChild(rows);
  }

  function drawRest() {
    var box = section('desk');
    row(box, 'pets', toggle(api.pet(), api.setPet), 'pip and pop along the bottom');
    row(box, 'theme', choice(
      [{ label: 'auto', value: 'auto' }, { label: 'light', value: 'light' }, { label: 'dark', value: 'dark' }],
      api.theme(), function (v) { api.setTheme(v); draw(); }));

    var data = section('data', 'your tasks and days, as a file');
    var buttons = node('div', 'set-actions');
    var out = node('button', 'ghost', 'export');
    out.type = 'button';
    out.addEventListener('click', api.exportData);
    buttons.appendChild(out);
    var back = node('button', 'ghost', 'import');
    back.type = 'button';
    back.addEventListener('click', api.importData);
    buttons.appendChild(back);
    var sync = node('button', 'ghost', 'sync…');
    sync.type = 'button';
    sync.addEventListener('click', api.openSync);
    buttons.appendChild(sync);
    data.appendChild(buttons);
    data.appendChild(node('p', 'set-note', api.syncStatus()));

    /* If syncing ever replaced what was on this device, the old copy is still
       here and can be put back. */
    /* Daily snapshots, plus whatever syncing replaced. A backup you have to
       remember to take is a backup you do not have. */
    var saves = Store.remote.snapshots().slice().reverse();
    var kept = Store.remote.backup();
    if (kept && kept.data) saves.unshift({ day: 'replaced by sync', at: kept.at, data: kept.data });
    if (saves.length) {
      data.appendChild(node('p', 'set-note', 'kept on this device, in case'));
      saves.slice(0, 6).forEach(function (snap) {
        var when = new Date(snap.at || 0);
        var line = node('div', 'set-row');
        var name = node('div', 'set-label');
        name.appendChild(node('span', null, snap.day === 'replaced by sync' ? snap.day
          : when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })));
        name.appendChild(node('small', null,
          (snap.data.tasks || []).filter(function (t) { return !t.deletedAt; }).length + ' tasks, ' +
          (snap.data.blocks || []).filter(function (b) { return !b.deletedAt; }).length + ' blocks'));
        line.appendChild(name);
        var put = node('button', 'ghost', 'restore');
        put.type = 'button';
        put.addEventListener('click', function () {
          if (Store.remote.restore(snap.data)) draw();
        });
        line.appendChild(put);
        data.appendChild(line);
      });
    }
  }

  /* ---------- drawing and opening ---------- */

  function draw() {
    if (!open || !el.body) return;
    var active = document.activeElement;
    var key = active && active.dataset ? active.dataset.focusKey : null;
    var caret = null;
    if (key) { try { caret = active.selectionStart; } catch (e) { /* not text */ } }

    el.body.textContent = '';
    drawStats();
    drawTimer();
    drawDay();
    drawLoad();
    drawTags();
    drawLists();
    drawBin();
    drawRest();

    if (!key) return;
    var next = el.body.querySelector('[data-focus-key="' + key + '"]');
    if (next) {
      next.focus();
      if (caret !== null && next.setSelectionRange) {
        try { next.setSelectionRange(caret, caret); } catch (e) { /* not text */ }
      }
    }
  }

  function show(on) {
    open = !!on;
    merging = null;
    document.body.classList.toggle('settings-open', open);
    el.card.hidden = !open;
    el.settingsBtn.setAttribute('aria-pressed', String(open));
    if (open) { draw(); el.card.scrollTop = 0; }
  }

  function init(hooks) {
    api = hooks;
    el = {
      card: $('settingsCard'), body: $('settingsBody'),
      close: $('settingsClose'), settingsBtn: $('settingsBtn')
    };
    if (!el.card) return;
    el.close.addEventListener('click', function () { show(false); });
    el.settingsBtn.addEventListener('click', function () { show(!open); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && open) { show(false); }
    });
    Store.subscribe(function () { if (open) draw(); });
  }

  return { init: init, show: show, isOpen: function () { return open; }, refresh: draw };
})();
