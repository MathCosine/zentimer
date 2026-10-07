/* Your calendar, read in.

   Google Calendar (or Apple, or Outlook) is where fixed things belong --
   tutoring every Tuesday and Thursday, a club, a match -- because that is
   what a calendar is good at: repeating events, editing them on a phone,
   telling you about them. pip reads it, through the calendar's private iCal
   link, so the day here shows what is on it and the evening's plan goes
   round it. It only ever reads: nothing in your calendar changes.

   The link cannot be fetched by a web page directly (calendar hosts send no
   CORS headers), so it goes through a small relay in your own Supabase
   project -- supabase/functions/calendar -- which fetches it and hands it
   back. Repeating events are expanded with ical.js. What comes back is kept
   on this device, so the day still shows it offline. */
window.Calendar = (function () {
  'use strict';

  var CACHE = 'pip.calendar.v1';
  var EVERY = 15 * 60 * 1000;          // how often to look again
  var BACK = 2, AHEAD = 35;            // days of events kept around today
  var ICAL = (function () {
    var here = document.currentScript && document.currentScript.src;
    return here ? new URL('vendor/ical.min.js', here).href : '../assets/vendor/ical.min.js';
  })();

  var state = read();                  // { links, events, at, error }
  var busy = false, timer = 0, synced = false;
  var listeners = [];

  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (s && Array.isArray(s.links)) return s;
    } catch (e) { /* fresh */ }
    return { links: [], events: [], at: 0, error: null };
  }
  function keep() {
    try { localStorage.setItem(CACHE, JSON.stringify(state)); } catch (e) { /* full or private */ }
  }
  function tell() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  /* ---------- links ---------- */

  var HOSTS = [/^calendar\.google\.com$/, /(^|\.)icloud\.com$/, /^outlook\.(live|office365)\.com$/,
               /(^|\.)office365\.com$/, /^calendar\.proton\.me$/, /(^|\.)fastmail\.com$/];

  /* The same rule the relay applies, said here first so a wrong link gets a
     useful answer straight away rather than a round trip and an error. */
  function check(link) {
    var text = String(link || '').trim().replace(/^webcal:/i, 'https:');
    var url;
    try { url = new URL(text); } catch (e) { return { error: 'that is not a link' }; }
    if (url.protocol !== 'https:') return { error: 'that is not a link pip can use' };
    if (!HOSTS.some(function (h) { return h.test(url.hostname); })) {
      return { error: 'that is not a calendar link pip knows -- Google, Apple and Outlook ones work' };
    }
    if (/calendar\.google\.com$/.test(url.hostname) && !/\.ics(\?|$)/.test(url.pathname + url.search)) {
      return { error: 'that is the calendar’s page, not its iCal link -- look for "Secret address in iCal format"' };
    }
    return { link: text };
  }

  function account() { return window.Sync && Sync.ready && Sync.ready() && Sync.signedIn && Sync.signedIn(); }

  /* The links belong to the account, so a second browser shows the same
     calendar without being told; this device keeps a copy for offline. */
  function saveLinks(links) {
    state.links = links;
    if (!links.length) { state.events = []; state.at = 0; state.error = null; }
    keep();
    tell();
    if (account()) Sync.setPref('calendars', links).catch(function () { /* kept here regardless */ });
    return refresh();
  }

  function add(link) {
    var ok = check(link);
    if (ok.error) return Promise.resolve({ error: ok.error });
    if (state.links.indexOf(ok.link) !== -1) return Promise.resolve({ error: 'that calendar is already here' });
    return saveLinks(state.links.concat([ok.link])).then(function () { return { ok: true }; });
  }

  function remove(index) {
    return saveLinks(state.links.filter(function (_, i) { return i !== index; }));
  }

  /* On first being signed in, ask the account which calendars it has. */
  function adopt() {
    if (synced || !account()) return;
    synced = true;
    Sync.getPref('calendars').then(function (links) {
      if (!Array.isArray(links)) {
        // this device had links before the account did: give them to it
        if (state.links.length) Sync.setPref('calendars', state.links).catch(function () {});
        return;
      }
      if (JSON.stringify(links) === JSON.stringify(state.links)) return;
      state.links = links;
      keep();
      refresh();
    }).catch(function () { synced = false; });
  }

  /* ---------- fetching and reading ---------- */

  function loadIcal() {
    if (window.ICAL) return Promise.resolve(window.ICAL);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ICAL;
      s.onload = function () { window.ICAL ? resolve(window.ICAL) : reject(new Error('no ical')); };
      s.onerror = function () { reject(new Error('could not load the calendar reader')); };
      document.head.appendChild(s);
    });
  }

  function fetchOne(link) {
    var client = window.Sync && Sync.client && Sync.client();
    if (!client || !client.functions) return Promise.reject(new Error('sign in to see your calendar'));
    return client.functions.invoke('calendar', { body: { url: link } }).then(function (res) {
      if (res.error) {
        var status = res.error.context && res.error.context.status;
        if (status === 404) throw new Error('the calendar relay is not set up on this server yet');
        if (status === 401) throw new Error('sign in again to see your calendar');
        var said = res.error.context && res.error.context.json ? null : res.error.message;
        throw new Error(said && !/non-2xx/i.test(said) ? said : 'the calendar could not be read just now');
      }
      var text = typeof res.data === 'string' ? res.data : '';
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('that link did not give back a calendar');
      return text;
    });
  }

  function window_() {
    var from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - BACK);
    var to = new Date(from); to.setDate(to.getDate() + BACK + AHEAD);
    return { from: from.getTime(), to: to.getTime() };
  }

  /* Every occurrence in the window: repeating events expanded, moved ones
     moved, cancelled ones gone -- ical.js does the arithmetic. */
  function expand(ICAL, text, tag) {
    var span = window_();
    var root = new ICAL.Component(ICAL.parse(text));
    root.getAllSubcomponents('vtimezone').forEach(function (vtz) {
      try { ICAL.TimezoneService.register(new ICAL.Timezone(vtz)); } catch (e) { /* use the clock's own */ }
    });
    var all = root.getAllSubcomponents('vevent').map(function (v) { return new ICAL.Event(v); });
    var masters = {};
    all.forEach(function (ev) {
      if (!ev.isRecurrenceException()) (masters[ev.uid] = masters[ev.uid] || []).push(ev);
    });
    all.forEach(function (ev) {
      if (ev.isRecurrenceException() && masters[ev.uid]) {
        masters[ev.uid].forEach(function (m) { try { m.relateException(ev); } catch (e) {} });
      }
    });

    var out = [];
    function cancelled(item) {
      var c = item && item.component;
      return !!c && String(c.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
    }
    function push(item, start, end, allDay) {
      var s = start.toJSDate().getTime();
      var e = end ? end.toJSDate().getTime() : s + (allDay ? 86400000 : 3600000);
      if (e <= span.from || s >= span.to || cancelled(item)) return;
      out.push({ id: tag + (item.uid || 'x') + '@' + s, title: item.summary || 'busy',
                 start: s, end: Math.max(e, s + 5 * 60000), allDay: !!allDay });
    }

    Object.keys(masters).forEach(function (uid) {
      masters[uid].forEach(function (ev) {
        if (!ev.startDate) return;
        if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate, ev.startDate.isDate); return; }
        var it = ev.iterator(), next, guard = 0;
        while ((next = it.next()) && guard++ < 6000) {
          if (next.toJSDate().getTime() >= span.to) break;
          var occ = ev.getOccurrenceDetails(next);
          push(occ.item, occ.startDate, occ.endDate, occ.startDate.isDate);
        }
      });
    });
    return out;
  }

  function refresh() {
    if (!state.links.length) { tell(); return Promise.resolve(); }
    if (busy) return busy;
    busy = loadIcal().then(function (ICAL) {
      return Promise.all(state.links.map(function (link, i) {
        return fetchOne(link).then(function (text) { return expand(ICAL, text, 'cal' + i + ':'); });
      }));
    }).then(function (lists) {
      state.events = [].concat.apply([], lists).sort(function (a, b) { return a.start - b.start; });
      state.at = Date.now();
      state.error = null;
      keep();
    }, function (err) {
      state.error = (err && err.message) || 'the calendar could not be read just now';
      keep();                          // what was read last time is still shown
    }).then(function () {
      busy = false;
      tell();
    });
    return busy;
  }

  /* ---------- what the day sees ---------- */

  function minutesInto(key, ms) {
    var base = new Date(key + 'T00:00');
    var d = new Date(ms);
    var mid = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((mid - base) / 86400000);
    return days * 1440 + d.getHours() * 60 + d.getMinutes();
  }

  /* The day's timed events as blocks: read only, never stored. The day runs
     from the hour your day starts to the same hour the next morning, like the
     rest of pip, so something at half past midnight is part of the evening. */
  function eventsOn(key) {
    if (!state.events.length) return [];
    var startAt = window.Plan && Plan.dayStart ? Plan.dayStart() : 0;
    var lo = startAt, hi = startAt + 1440;
    var out = [];
    state.events.forEach(function (ev) {
      if (ev.allDay) return;
      var s = minutesInto(key, ev.start), e = minutesInto(key, ev.end);
      if (e <= lo || s >= hi) return;
      out.push({ id: 'cal:' + ev.id, date: key, start: Math.max(s, lo), end: Math.min(e, hi),
                 title: ev.title, calendar: true, done: false });
    });
    return out;
  }

  function allDayOn(key) {
    var day = new Date(key + 'T12:00').getTime();
    return state.events.filter(function (ev) { return ev.allDay && ev.start <= day && ev.end > day; })
      .map(function (ev) { return ev.title; });
  }

  function status() {
    if (!state.links.length) return 'not connected';
    if (busy && !state.at) return 'reading your calendar…';
    var week = Date.now() + 7 * 86400000;
    var soon = state.events.filter(function (e) { return !e.allDay && e.end > Date.now() && e.start < week; }).length;
    var said = state.at
      ? soon + (soon === 1 ? ' event' : ' events') + ' this week · read ' + ago(state.at)
      : 'not read yet';
    return state.error ? state.error + (state.at ? ' (showing what was read ' + ago(state.at) + ')' : '') : said;
  }

  function ago(at) {
    var m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }

  /* ---------- starting ---------- */

  function init() {
    if (window.Store && Store.setOutside) Store.setOutside(eventsOn);
    // look again every so often, when the page comes back, and once signed in
    clearInterval(timer);
    timer = setInterval(function () {
      adopt();
      if (state.links.length && !document.hidden && Date.now() - state.at > EVERY) refresh();
    }, 20 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.links.length && Date.now() - state.at > EVERY) refresh();
    });
    setTimeout(function () { adopt(); if (state.links.length) refresh(); }, 1500);
  }

  return {
    init: init,
    links: function () { return state.links.slice(); },
    add: add,
    remove: remove,
    refresh: refresh,
    status: status,
    eventsOn: eventsOn,
    allDayOn: allDayOn,
    connected: function () { return state.links.length > 0; },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
