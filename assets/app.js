/* zen — a quiet clock and timer. No accounts, no network, nothing but localStorage. */
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
    soundBtn: $('soundBtn'), notifyBtn: $('notifyBtn'),
    themeBtn: $('themeBtn'), fullBtn: $('fullBtn')
  };

  var MIN = 60000, HOUR = 3600000;
  var MIN_DURATION = 5000, MAX_DURATION = 12 * HOUR;
  var KEY_STATE = 'zen.state.v1', KEY_STATS = 'zen.stats.v1';

  var settings = { hour12: false, sound: true, notify: false, theme: 'auto' };
  var timer = { duration: 25 * MIN, remaining: 25 * MIN, endAt: null, status: 'idle' };
  var stats = { day: dayKey(), sessions: 0, focused: 0 };

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
      settings: settings,
      duration: timer.duration, remaining: timer.remaining,
      endAt: timer.endAt, status: timer.status, lastAccrual: lastAccrual
    });
    write(KEY_STATS, stats);
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

  function clampDuration(ms) {
    return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(ms)));
  }

  /* ---------- stats ---------- */

  function rollDay() {
    var today = dayKey();
    if (stats.day !== today) { stats = { day: today, sessions: 0, focused: 0 }; }
  }

  function addFocus(ms) {
    if (ms <= 0) return;
    rollDay();
    stats.focused += ms;
  }

  function accrue(now) {
    if (timer.status !== 'running' || !timer.endAt) { lastAccrual = now; return; }
    var upTo = Math.min(now, timer.endAt);
    if (upTo > lastAccrual) addFocus(upTo - lastAccrual);
    lastAccrual = now;
  }

  /* ---------- timer ---------- */

  function setDuration(ms, restart) {
    timer.duration = clampDuration(ms);
    if (timer.status === 'running' && !restart) return;
    if (timer.status === 'running' && restart) {
      timer.endAt = Date.now() + timer.duration;
      timer.remaining = timer.duration;
    } else {
      timer.status = 'idle';
      timer.endAt = null;
      timer.remaining = timer.duration;
    }
    save(); render();
  }

  function adjust(deltaMs) {
    var now = Date.now();
    timer.duration = clampDuration(timer.duration + deltaMs);
    if (timer.status === 'running') {
      timer.endAt = Math.max(now + 1000, timer.endAt + deltaMs);
      timer.remaining = timer.endAt - now;
    } else {
      timer.status = 'idle';
      timer.endAt = null;
      timer.remaining = timer.duration;
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

  function reset() {
    accrue(Date.now());
    timer.status = 'idle';
    timer.endAt = null;
    timer.remaining = timer.duration;
    releaseWakeLock();
    save(); render();
  }

  function complete(quiet) {
    timer.status = 'done';
    timer.remaining = 0;
    rollDay();
    stats.sessions += 1;
    releaseWakeLock();
    if (!quiet) {
      chime();
      notify();
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

  function chime() {
    if (!settings.sound) return;
    var ctx = unlockAudio();
    if (!ctx) return;
    var start = ctx.currentTime + 0.05;
    [528, 660, 792].forEach(function (freq, i) {
      var at = start + i * 0.85;
      [[freq, 0.16], [freq * 2, 0.03]].forEach(function (voice) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = voice[0];
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(voice[1], at + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 3.1);
      });
    });
  }

  function notify() {
    if (!settings.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('zen', { body: humanSpan(timer.duration) + ' complete', silent: true });
    } catch (e) { /* some browsers require a service worker */ }
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
    var key = (node.id || node.className) + '.' + prop;
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

  function renderTimer(now) {
    var remaining = timer.remaining;
    var overtime = 0;

    if (timer.status === 'running') remaining = timer.endAt - now;
    if (timer.status === 'done' && timer.endAt) overtime = Math.max(0, now - timer.endAt);

    var face = timer.status === 'done'
      ? (overtime >= 1000 ? '+' + clockFace(overtime) : '0:00')
      : clockFace(Math.max(0, remaining));

    paint(el.countdown, 'textContent', face);

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

    var phases = { idle: 'ready', running: 'focus', paused: 'paused', done: 'complete' };
    paint(el.phase, 'textContent', phases[timer.status]);

    var labels = { idle: 'begin', running: 'pause', paused: 'resume', done: 'again' };
    paint(el.startPause, 'textContent', labels[timer.status]);

    var restable = timer.status !== 'idle';
    el.reset.classList.toggle('is-gone', !restable);
    el.reset.setAttribute('aria-hidden', restable ? 'false' : 'true');
    el.reset.tabIndex = restable ? 0 : -1;

    var title = timer.status === 'running' ? clockFace(Math.max(0, remaining)) + ' · zen'
      : timer.status === 'done' ? 'complete · zen'
      : timer.status === 'paused' ? 'paused · zen' : 'zen';
    if (document.title !== title) document.title = title;

    Array.prototype.forEach.call(el.presets.children, function (button) {
      var active = Math.round(timer.duration / MIN) === +button.dataset.min;
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  function renderStats() {
    rollDay();
    var text;
    var sessions = stats.sessions + (stats.sessions === 1 ? ' session' : ' sessions');
    if (stats.sessions === 0 && stats.focused < MIN) text = 'a clear day';
    else if (stats.focused < MIN) text = sessions + ' today';
    else text = sessions + ' · ' + humanSpan(stats.focused) + ' focused today';
    paint(el.stats, 'textContent', text);
  }

  function render() {
    var now = Date.now();
    renderClock(now);
    renderTimer(now);
    renderStats();
  }

  /* ---------- loop ---------- */

  function tick() {
    var now = Date.now();
    if (timer.status === 'running') {
      accrue(now);
      timer.remaining = timer.endAt - now;
      if (timer.remaining <= 0) { complete(false); return; }
      if (now - lastSave > 10000) save();
    }
    render();
  }

  setInterval(tick, 200);

  /* ---------- duration editing ---------- */

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

  /* ---------- controls ---------- */

  el.startPause.addEventListener('click', toggle);
  el.reset.addEventListener('click', reset);
  el.minus.addEventListener('click', function () { adjust(-5 * MIN); });
  el.plus.addEventListener('click', function () { adjust(5 * MIN); });

  el.presets.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-min]');
    if (button) setDuration(+button.dataset.min * MIN, true);
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
    if (settings.sound) { unlockAudio(); chime(); }
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
      case 'f': case 'F': el.fullBtn.click(); break;
      case 's': case 'S': el.soundBtn.click(); break;
      case 't': case 'T': el.themeBtn.click(); break;
      case 'e': case 'E': event.preventDefault(); beginEdit(); break;
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

    var stored = read(KEY_STATE);
    if (stored) {
      if (stored.settings) {
        settings.hour12 = !!stored.settings.hour12;
        settings.sound = stored.settings.sound !== false;
        settings.notify = !!stored.settings.notify;
        settings.theme = stored.settings.theme || 'auto';
      }
      timer.duration = clampDuration(stored.duration || timer.duration);
      timer.remaining = typeof stored.remaining === 'number' ? stored.remaining : timer.duration;
      timer.endAt = stored.endAt || null;
      timer.status = stored.status || 'idle';
      lastAccrual = stored.lastAccrual || Date.now();

      var now = Date.now();
      if (timer.status === 'running' && timer.endAt) {
        if (now >= timer.endAt) {
          accrue(now);
          // it ran out while the page was closed
          if (now - timer.endAt > HOUR) { timer.status = 'idle'; timer.endAt = null; timer.remaining = timer.duration; }
          else { complete(true); }
        }
      } else if (timer.status === 'running') {
        timer.status = 'paused';
      }
      if (timer.status === 'done' && timer.endAt && now - timer.endAt > HOUR) {
        timer.status = 'idle'; timer.endAt = null; timer.remaining = timer.duration;
      }
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
