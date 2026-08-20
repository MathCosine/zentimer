/* zen — a quiet clock, timer and alarms. No accounts, no network, nothing but localStorage. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    body: document.body,
    clock: $('clock'), clockTime: $('clockTime'), clockSecs: $('clockSecs'), meridiem: $('meridiem'),
    dateLabel: $('dateLabel'), zoneLabel: $('zoneLabel'),
    dial: document.querySelector('.dial'), ring: $('ringProgress'),
    countdown: $('countdown'), input: $('durationInput'), phase: $('phase'),
    presets: $('presets'), startPause: $('startPause'), reset: $('reset'),
    minus: $('minus'), plus: $('plus'), stats: $('stats'),
    alarmList: $('alarmList'), alarmAdd: $('alarmAdd'), alarmInput: $('alarmInput'),
    soundBtn: $('soundBtn'), notifyBtn: $('notifyBtn'),
    themeBtn: $('themeBtn'), fullBtn: $('fullBtn')
  };

  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var MIN_DURATION = 5000, MAX_DURATION = 12 * HOUR;
  var KEY_STATE = 'zen.state.v1', KEY_STATS = 'zen.stats.v1', KEY_ALARMS = 'zen.alarms.v1';

  var settings = {
    hour12: false, sound: true, notify: false, theme: 'auto',
    focusMs: 30 * MIN, breakMs: 10 * MIN
  };
  var timer = { mode: 'focus', duration: settings.focusMs, remaining: settings.focusMs, endAt: null, status: 'idle' };
  var stats = { day: dayKey(), sessions: 0, focused: 0 };
  var alarms = [];

  var lastAccrual = Date.now();
  var lastSave = 0;
  var wakeLock = null;
  var audio = null;
  var painted = {};

  /* ---------- storage ---------- */

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function save() {
    lastSave = Date.now();
    write(KEY_STATE, {
      settings: settings, mode: timer.mode,
      duration: timer.duration, remaining: timer.remaining,
      endAt: timer.endAt, status: timer.status, lastAccrual: lastAccrual
    });
    write(KEY_STATS, stats);
    write(KEY_ALARMS, alarms);
  }

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------- formatting ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function clockFace(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function humanSpan(ms) {
    var mins = Math.floor(ms / MIN);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm';
  }

  function timeOfDay(when) {
    var d = new Date(when);
    var h = d.getHours(), suffix = '';
    if (settings.hour12) { suffix = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; }
    return (settings.hour12 ? h : pad(h)) + ':' + pad(d.getMinutes()) + suffix;
  }

  function untilLabel(ms) {
    if (ms <= 0) return 'now';
    if (ms < MIN) return 'in ' + Math.ceil(ms / 1000) + 's';
    var mins = Math.ceil(ms / MIN);
    if (mins < 60) return 'in ' + mins + 'm';
    return 'in ' + Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm';
  }

  /* a length: 25, 50:00, 1h30, 90m, 45s, 1:05:00 */
  function parseDuration(raw) {
    var text = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!text) return null;

    var colons = text.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (colons) {
      var a = +colons[1], b = +colons[2], c = colons[3] === undefined ? null : +colons[3];
      return c === null ? (a * MIN + b * 1000) : (a * HOUR + b * MIN + c * 1000);
    }

    var hoursMinutes = text.match(/^(\d+(?:\.\d+)?)h(\d+(?:\.\d+)?)(?:m|min)?$/);
    if (hoursMinutes) return parseFloat(hoursMinutes[1]) * HOUR + parseFloat(hoursMinutes[2]) * MIN;

    var units = text.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s(?:ec)?)?$/);
    if (units && (units[1] || units[2] || units[3])) {
      return parseFloat(units[1] || 0) * HOUR + parseFloat(units[2] || 0) * MIN + parseFloat(units[3] || 0) * 1000;
    }

    if (/^\d+(\.\d+)?$/.test(text)) return parseFloat(text) * MIN;
    return null;
  }

  /* a moment: 16:30, 4:30pm, 930, 16 — or a length ("45m"), meaning that far from now */
  function parseMoment(raw) {
    var text = String(raw || '').trim().toLowerCase().replace(/[\s.]/g, '');
    if (!text) return null;

    var clock = text.match(/^(\d{1,2}):(\d{2})(am|pm)?$/) || text.match(/^(\d{1,2})(am|pm)$/);
    if (clock) {
      var h = +clock[1];
      var m = clock[2] && /^\d+$/.test(clock[2]) ? +clock[2] : 0;
      var meridiem = clock[3] || (clock[2] && !/^\d+$/.test(clock[2]) ? clock[2] : '');
      return atClock(h, m, meridiem);
    }

    var compact = text.match(/^(\d{3,4})(am|pm)?$/);
    if (compact) {
      var digits = compact[1];
      return atClock(+digits.slice(0, digits.length - 2), +digits.slice(-2), compact[2] || '');
    }

    var bare = text.match(/^(\d{1,2})$/);
    if (bare) return atClock(+bare[1], 0, '');

    var span = parseDuration(text);
    return span ? Date.now() + span : null;
  }

  function atClock(h, m, meridiem) {
    if (m > 59) return null;
    if (meridiem) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (meridiem === 'pm' ? 12 : 0);
    } else if (h > 23) return null;

    var d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setTime(d.getTime() + DAY);   // already gone — tomorrow, then
    return d.getTime();
  }

  function clampDuration(ms) {
    return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(ms)));
  }

  /* ---------- today ---------- */

  function rollDay() {
    var today = dayKey();
    if (stats.day !== today) stats = { day: today, sessions: 0, focused: 0 };
  }

  function accrue(now) {
    // only time spent in focus counts; breaks are not study
    if (timer.status !== 'running' || timer.mode !== 'focus' || !timer.endAt) { lastAccrual = now; return; }
    var upTo = Math.min(now, timer.endAt);
    if (upTo > lastAccrual) { rollDay(); stats.focused += upTo - lastAccrual; }
    lastAccrual = now;
  }

  /* ---------- timer ---------- */

  function storedLength() { return timer.mode === 'break' ? settings.breakMs : settings.focusMs; }

  function rememberLength(ms) {
    if (timer.mode === 'break') settings.breakMs = ms; else settings.focusMs = ms;
  }

  function setDuration(ms, restart) {
    var value = clampDuration(ms);
    rememberLength(value);
    timer.duration = value;
    if (timer.status === 'running') {
      if (!restart) { save(); render(); return; }
      timer.endAt = Date.now() + value;
      timer.remaining = value;
    } else {
      timer.status = 'idle';
      timer.endAt = null;
      timer.remaining = value;
    }
    save(); render();
  }

  function adjust(deltaMs) {
    var now = Date.now();
    var value = clampDuration(timer.duration + deltaMs);
    rememberLength(value);
    timer.duration = value;
    if (timer.status === 'running') {
      timer.endAt = Math.max(now + 1000, timer.endAt + deltaMs);
      timer.remaining = timer.endAt - now;
    } else {
      timer.status = 'idle';
      timer.endAt = null;
      timer.remaining = value;
    }
    save(); render();
  }

  function start() {
    var now = Date.now();
    if (timer.status === 'done' || timer.remaining <= 0) timer.remaining = timer.duration;
    timer.endAt = now + timer.remaining;
    timer.status = 'running';
    lastAccrual = now;
    unlockAudio();
    requestWakeLock();
    save(); render();
  }

  function pause() {
    var now = Date.now();
    accrue(now);
    timer.remaining = Math.max(0, timer.endAt - now);
    timer.endAt = null;
    timer.status = 'paused';
    releaseWakeLock();
    save(); render();
  }

  function toggle() {
    if (timer.status === 'running') pause(); else start();
  }

  /* back to a fresh focus session; during a break this ends the break early */
  function reset() {
    accrue(Date.now());
    timer.mode = 'focus';
    timer.duration = settings.focusMs;
    timer.remaining = settings.focusMs;
    timer.endAt = null;
    timer.status = 'idle';
    releaseWakeLock();
    save(); render();
  }

  function complete(quiet) {
    var finished = timer.mode;
    if (finished === 'focus') {
      rollDay();
      stats.sessions += 1;
      // straight into the break, so the rest is taken rather than skipped
      timer.mode = 'break';
      timer.duration = settings.breakMs;
      timer.remaining = settings.breakMs;
      timer.endAt = Date.now() + settings.breakMs;
      timer.status = 'running';
      lastAccrual = Date.now();
    } else {
      timer.mode = 'focus';
      timer.duration = settings.focusMs;
      timer.remaining = settings.focusMs;
      timer.endAt = null;
      timer.status = 'idle';
      releaseWakeLock();
    }
    if (!quiet) {
      chime(finished === 'focus' ? 'focus' : 'break');
      notify(finished === 'focus' ? 'session complete' : 'break over',
             finished === 'focus' ? humanSpan(settings.breakMs) + ' break' : 'ready when you are');
      bloom();
    }
    save(); render();
  }

  function bloom() {
    if (!el.dial) return;
    el.dial.classList.remove('bloom');
    void el.dial.offsetWidth;
    el.dial.classList.add('bloom');
    setTimeout(function () { el.dial.classList.remove('bloom'); }, 2800);
  }

  /* ---------- alarms ---------- */

  function addAlarm(at) {
    if (!at) return false;
    if (alarms.some(function (a) { return Math.abs(a.at - at) < MIN; })) return false;  // already set
    alarms.push({ id: 'a' + at + Math.random().toString(36).slice(2, 6), at: at, ringing: false });
    alarms.sort(function (a, b) { return a.at - b.at; });
    unlockAudio();
    save(); renderAlarms(Date.now(), true);
    return true;
  }

  function removeAlarm(id) {
    alarms = alarms.filter(function (a) { return a.id !== id; });
    save(); renderAlarms(Date.now(), true);
  }

  var RECALL_EVERY = 30000, RECALLS = 3;

  function checkAlarms(now) {
    var changed = false;
    alarms.forEach(function (alarm) {
      if (now < alarm.at) return;
      if (!alarm.ringing) {
        alarm.ringing = true;
        alarm.calls = 1;
        alarm.lastCall = now;
        changed = true;
        chime('alarm');
        notify('alarm', timeOfDay(alarm.at));
      } else if ((alarm.calls || 1) < RECALLS && now - (alarm.lastCall || now) >= RECALL_EVERY) {
        alarm.calls = (alarm.calls || 1) + 1;
        alarm.lastCall = now;
        chime('alarm');
      }
    });
    if (changed) save();
  }

  function anyRinging() {
    return alarms.some(function (a) { return a.ringing; });
  }

  /* ---------- sound ---------- */

  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
      return audio;
    } catch (e) { return null; }
  }

  var CHIMES = {
    focus: { notes: [528, 660, 792], gap: 0.85, decay: 3 },
    break: { notes: [660, 528, 396], gap: 0.7, decay: 2.6 },
    alarm: { notes: [660, 880, 660, 880], gap: 0.42, decay: 1.6 }
  };

  function chime(kind) {
    if (!settings.sound) return;
    var ctx = unlockAudio();
    if (!ctx) return;
    var shape = CHIMES[kind] || CHIMES.focus;
    var begin = ctx.currentTime + 0.05;
    shape.notes.forEach(function (freq, i) {
      var at = begin + i * shape.gap;
      [[freq, 0.16], [freq * 2, 0.03]].forEach(function (voice) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = voice[0];
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(voice[1], at + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + shape.decay);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + shape.decay + 0.1);
      });
    });
  }

  function notify(title, body) {
    if (!settings.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification('zen — ' + title, { body: body, silent: true }); }
    catch (e) { /* some browsers require a service worker */ }
  }

  /* ---------- screen wake lock ---------- */

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* not allowed — no matter */ });
  }

  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }

  /* ---------- render ---------- */

  function paint(node, prop, value) {
    var key = node.id + '.' + prop;
    if (painted[key] === value) return;
    painted[key] = value;
    node[prop] = value;
  }

  var dateFormatter = null, lastMinute = -1;

  function renderClock(now) {
    var d = new Date(now);
    var h = d.getHours(), meridiem = '';
    if (settings.hour12) { meridiem = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; }
    paint(el.clockTime, 'textContent', (settings.hour12 ? h : pad(h)) + ':' + pad(d.getMinutes()));
    paint(el.clockSecs, 'textContent', pad(d.getSeconds()));
    paint(el.meridiem, 'textContent', meridiem);

    // the date and the zone only ever change on a minute boundary
    if (d.getMinutes() === lastMinute) return;
    lastMinute = d.getMinutes();

    if (!dateFormatter) {
      try {
        dateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      } catch (e) { dateFormatter = { format: function (x) { return x.toDateString(); } }; }
    }
    paint(el.dateLabel, 'textContent', dateFormatter.format(d));
    renderZone(d);
  }

  function renderZone(d) {
    var zone = '', offset = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }).formatToParts(d)
        .forEach(function (part) { if (part.type === 'timeZoneName') offset = part.value; });
    } catch (e) { /* older browsers */ }
    if (!offset) {
      var mins = -d.getTimezoneOffset();
      var rest = Math.abs(mins) % 60;
      offset = 'GMT' + (mins < 0 ? '-' : '+') + Math.floor(Math.abs(mins) / 60) + (rest ? ':' + pad(rest) : '');
    }
    paint(el.zoneLabel, 'textContent', zone ? zone.replace(/_/g, ' ') + ' (' + offset + ')' : offset);
  }

  var measuredRing = 0;
  function ringLength() {
    if (!measuredRing) {
      try { measuredRing = el.ring.getTotalLength(); } catch (e) {}
      if (!measuredRing) measuredRing = 2 * Math.PI * 92;
    }
    return measuredRing;
  }

  var PHASES = {
    focus: { idle: 'ready', running: 'focus', paused: 'paused', done: 'complete' },
    break: { idle: 'break', running: 'break', paused: 'break paused', done: 'break over' }
  };

  function renderTimer(now) {
    var remaining = timer.status === 'running' ? timer.endAt - now : timer.remaining;
    var overtime = timer.status === 'done' && timer.endAt ? Math.max(0, now - timer.endAt) : 0;

    paint(el.countdown, 'textContent', timer.status === 'done'
      ? (overtime >= 1000 ? '+' + clockFace(overtime) : '0:00')
      : clockFace(Math.max(0, remaining)));

    var fraction = timer.status === 'done' ? 0
      : Math.max(0, Math.min(1, remaining / Math.max(1, timer.duration)));
    if (fraction > 0.9995) {
      el.ring.style.strokeDasharray = 'none';   // whole circle, no seam
    } else {
      var length = ringLength();
      el.ring.style.strokeDasharray = length;
      el.ring.style.strokeDashoffset = length * (1 - fraction);
    }

    if (el.body.dataset.status !== timer.status) el.body.dataset.status = timer.status;
    if (el.body.dataset.mode !== timer.mode) el.body.dataset.mode = timer.mode;

    paint(el.phase, 'textContent', PHASES[timer.mode][timer.status]);

    var labels = { idle: 'begin', running: 'pause', paused: 'resume', done: 'again' };
    paint(el.startPause, 'textContent', labels[timer.status]);

    paint(el.reset, 'textContent', timer.mode === 'break' ? 'end break' : 'reset');
    var resettable = timer.status !== 'idle' || timer.mode === 'break';
    el.reset.classList.toggle('is-gone', !resettable);
    el.reset.setAttribute('aria-hidden', resettable ? 'false' : 'true');
    el.reset.tabIndex = resettable ? 0 : -1;

    var title = anyRinging() ? 'alarm · zen'
      : timer.status === 'running'
      ? clockFace(Math.max(0, remaining)) + (timer.mode === 'break' ? ' break · zen' : ' · zen')
      : timer.status === 'paused' ? 'paused · zen'
      : timer.status === 'done' ? 'complete · zen' : 'zen';
    if (document.title !== title) document.title = title;

    Array.prototype.forEach.call(el.presets.children, function (button) {
      var active = Math.round(settings.focusMs / MIN) === +button.dataset.min;
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  function renderStats() {
    rollDay();
    var sessions = stats.sessions + (stats.sessions === 1 ? ' session' : ' sessions');
    var text;
    if (stats.sessions === 0 && stats.focused < MIN) text = 'a clear day';
    else if (stats.focused < MIN) text = sessions + ' today';
    else text = sessions + ' · ' + humanSpan(stats.focused) + ' focused today';
    paint(el.stats, 'textContent', text);
  }

  var alarmSignature = '';

  function renderAlarms(now, force) {
    var signature = alarms.map(function (a) {
      return a.id + ':' + (a.ringing ? 'ring' : untilLabel(a.at - now));
    }).join('|') + '|' + settings.hour12;
    if (!force && signature === alarmSignature) return;
    alarmSignature = signature;

    el.alarmList.textContent = '';
    alarms.forEach(function (alarm) {
      var item = document.createElement('li');
      item.className = 'alarm' + (alarm.ringing ? ' is-ringing' : '');

      var face = document.createElement('button');
      face.type = 'button';
      face.className = 'alarm-face';
      face.dataset.id = alarm.id;
      face.title = alarm.ringing ? 'Dismiss' : 'Alarm at ' + timeOfDay(alarm.at);

      var when = document.createElement('span');
      when.className = 'alarm-time';
      when.textContent = timeOfDay(alarm.at);

      var note = document.createElement('span');
      note.className = 'alarm-in';
      note.textContent = alarm.ringing ? 'ringing' : untilLabel(alarm.at - now);

      face.appendChild(when);
      face.appendChild(note);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'alarm-x';
      remove.dataset.remove = alarm.id;
      remove.setAttribute('aria-label', 'Remove the ' + timeOfDay(alarm.at) + ' alarm');
      remove.textContent = '×';

      item.appendChild(face);
      item.appendChild(remove);
      el.alarmList.appendChild(item);
    });

    el.alarmAdd.textContent = alarms.length ? '+' : '+ alarm';
    el.alarmAdd.title = 'Add an alarm (a)';
  }

  function render() {
    var now = Date.now();
    renderClock(now);
    renderTimer(now);
    renderStats();
    renderAlarms(now);
  }

  /* ---------- loop ---------- */

  function tick() {
    var now = Date.now();
    checkAlarms(now);
    if (timer.status === 'running') {
      accrue(now);
      timer.remaining = timer.endAt - now;
      if (timer.remaining <= 0) { complete(false); return; }
      if (now - lastSave > 10000) save();
    }
    render();
  }

  setInterval(tick, 200);

  /* ---------- editing the length ---------- */

  function beginEdit() {
    if (timer.status === 'running') return;
    el.input.value = clockFace(timer.duration);
    el.countdown.hidden = true;
    el.input.hidden = false;
    el.input.focus();
    el.input.select();
  }

  function endEdit(commit) {
    if (el.input.hidden) return;
    if (commit) {
      var parsed = parseDuration(el.input.value);
      if (parsed) setDuration(parsed, false);
    }
    el.input.hidden = true;
    el.countdown.hidden = false;
    render();
  }

  el.countdown.addEventListener('click', beginEdit);
  el.input.addEventListener('blur', function () { endEdit(true); });
  el.input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); endEdit(true); }
    if (event.key === 'Escape') { event.preventDefault(); endEdit(false); }
  });

  /* ---------- adding an alarm ---------- */

  function beginAlarm() {
    el.alarmInput.value = '';
    el.alarmInput.hidden = false;
    el.alarmAdd.hidden = true;
    el.alarmInput.focus();
  }

  function endAlarm(commit) {
    if (el.alarmInput.hidden) return;
    if (commit) addAlarm(parseMoment(el.alarmInput.value));
    el.alarmInput.hidden = true;
    el.alarmAdd.hidden = false;
  }

  el.alarmAdd.addEventListener('click', beginAlarm);
  el.alarmInput.addEventListener('blur', function () { endAlarm(true); });
  el.alarmInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); endAlarm(true); }
    if (event.key === 'Escape') { event.preventDefault(); endAlarm(false); }
  });

  el.alarmList.addEventListener('click', function (event) {
    var remove = event.target.closest('[data-remove]');
    if (remove) { removeAlarm(remove.dataset.remove); return; }
    var face = event.target.closest('.alarm-face');
    if (face) removeAlarm(face.dataset.id);   // tapping an alarm dismisses it
  });

  /* ---------- controls ---------- */

  el.startPause.addEventListener('click', toggle);
  el.reset.addEventListener('click', reset);
  el.minus.addEventListener('click', function () { adjust(-5 * MIN); });
  el.plus.addEventListener('click', function () { adjust(5 * MIN); });

  el.presets.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-min]');
    if (!button) return;
    var length = +button.dataset.min * MIN;
    if (timer.mode === 'break') {
      // choose the next focus length without cutting the break short
      settings.focusMs = clampDuration(length);
      save(); render();
    } else {
      setDuration(length, true);
    }
  });

  el.clock.addEventListener('click', function () {
    settings.hour12 = !settings.hour12;
    painted = {};
    lastMinute = -1;
    save(); render();
  });

  el.soundBtn.addEventListener('click', function () {
    settings.sound = !settings.sound;
    el.soundBtn.setAttribute('aria-pressed', String(settings.sound));
    if (settings.sound) { unlockAudio(); chime('focus'); }
    save();
  });

  el.notifyBtn.addEventListener('click', function () {
    if (!('Notification' in window)) return;
    if (settings.notify) {
      settings.notify = false;
      el.notifyBtn.setAttribute('aria-pressed', 'false');
      save();
      return;
    }
    Notification.requestPermission().then(function (result) {
      settings.notify = result === 'granted';
      el.notifyBtn.setAttribute('aria-pressed', String(settings.notify));
      save();
    });
  });

  function effectiveTheme() {
    if (settings.theme !== 'auto') return settings.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }

  el.themeBtn.addEventListener('click', function () {
    settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  el.fullBtn.addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    switch (event.key) {
      case ' ': case 'Spacebar':
        event.preventDefault(); toggle(); break;
      case 'Enter':
        if (document.activeElement === document.body) { event.preventDefault(); toggle(); }
        break;
      case 'r': case 'R': reset(); break;
      case 'a': case 'A': event.preventDefault(); beginAlarm(); break;
      case 'e': case 'E': event.preventDefault(); beginEdit(); break;
      case 'f': case 'F': el.fullBtn.click(); break;
      case 's': case 'S': el.soundBtn.click(); break;
      case 't': case 'T': el.themeBtn.click(); break;
      case 'ArrowUp': event.preventDefault(); adjust(MIN); break;
      case 'ArrowDown': event.preventDefault(); adjust(-MIN); break;
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { accrue(Date.now()); save(); }
    else { if (timer.status === 'running') requestWakeLock(); render(); }
  });

  window.addEventListener('pagehide', function () { accrue(Date.now()); save(); });

  /* ---------- restore ---------- */

  (function restore() {
    var storedStats = read(KEY_STATS);
    if (storedStats && storedStats.day) {
      stats = { day: storedStats.day, sessions: storedStats.sessions || 0, focused: storedStats.focused || 0 };
      rollDay();
    }

    var storedAlarms = read(KEY_ALARMS);
    if (storedAlarms && storedAlarms.length) {
      var cutoff = Date.now() - HOUR;   // anything older than an hour has had its moment
      alarms = storedAlarms.filter(function (a) { return a && a.at > cutoff; })
        .map(function (a) { return { id: a.id, at: a.at, ringing: a.at <= Date.now(), calls: RECALLS, lastCall: Date.now() }; })
        .sort(function (a, b) { return a.at - b.at; });
    }

    var stored = read(KEY_STATE);
    if (stored) {
      if (stored.settings) {
        settings.hour12 = !!stored.settings.hour12;
        settings.sound = stored.settings.sound !== false;
        settings.notify = !!stored.settings.notify;
        settings.theme = stored.settings.theme || 'auto';
        settings.focusMs = clampDuration(stored.settings.focusMs || stored.duration || settings.focusMs);
        settings.breakMs = clampDuration(stored.settings.breakMs || settings.breakMs);
      }
      timer.mode = stored.mode === 'break' ? 'break' : 'focus';
      timer.duration = clampDuration(stored.duration || storedLength());
      timer.remaining = typeof stored.remaining === 'number' ? stored.remaining : timer.duration;
      timer.endAt = stored.endAt || null;
      timer.status = stored.status || 'idle';
      lastAccrual = stored.lastAccrual || Date.now();

      var now = Date.now();
      if (timer.status === 'running' && timer.endAt) {
        if (now >= timer.endAt) {
          accrue(now);
          // it ran out while the page was closed
          if (now - timer.endAt > HOUR) reset();
          else complete(true);
        }
      } else if (timer.status === 'running') {
        timer.status = 'paused';
      }
      if (timer.status === 'done' && timer.endAt && now - timer.endAt > HOUR) reset();
    }

    if (settings.notify && (!('Notification' in window) || Notification.permission !== 'granted')) {
      settings.notify = false;
    }

    applyTheme();
    el.soundBtn.setAttribute('aria-pressed', String(settings.sound));
    el.notifyBtn.setAttribute('aria-pressed', String(settings.notify));
    if (timer.status === 'running') requestWakeLock();
    render();
  })();
})();
