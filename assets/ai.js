/* The AI side of pip. It asks the relay on your own Supabase project (which
   asks Groq and Gemini, and has them checked against each other), and it
   decides *when* to ask: not on every keystroke, not twenty times while you
   paste in a week of homework, and never more than every half hour on its
   own -- only when something that matters to tonight has changed and then
   gone quiet for a minute and a half.

   Nothing here is trusted blindly. The planner checks every plan before it
   uses it, and the rule-based plan is always there underneath: offline, out
   of quota, or the AI having a bad day, the evening still gets planned. */
window.Ai = (function () {
  'use strict';

  var KEY = 'pip.ai.v1';
  var SETTLE = 90 * 1000;            // quiet this long after the last change before asking
  var GAP = 30 * 60 * 1000;          // and on its own, never more often than this
  var STALE_PLAN = 8 * 3600 * 1000;  // a plan from this morning is not tonight's

  var saved = read() || {};
  var state = {
    on: saved.on !== false,
    plan: saved.plan || null,        // { day, at, sig, steps, later, links, note, used, judged }
    asked: saved.asked || 0,         // when it last asked on its own
    declined: saved.declined || {}   // links you said no to: 'first>then'
  };
  var about = '';                    // what you told it about your life right now (synced)
  var status = { busy: false, error: '', kind: '' };
  var listeners = [];
  var settleTimer = 0, pendingSig = null;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function keep() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: state.on, plan: state.plan, asked: state.asked, declined: state.declined }));
    } catch (e) { /* private mode */ }
  }
  function tell() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function client() { return window.Sync && Sync.client ? Sync.client() : null; }
  function signedIn() {
    try { return !!(window.Store && Store.remote && Store.remote.signedIn()); } catch (e) { return false; }
  }
  /* Usable means: switched on, signed in (the relay is for signed-in people),
     and online. */
  function usable() { return state.on && signedIn() && !!client() && navigator.onLine !== false; }

  /* ---------- asking ---------- */

  function trouble(error) {
    var status = error && error.context && error.context.status;
    var fallback = status === 404 ? 'the AI is not set up on this server yet'
      : status === 401 ? 'sign in again to use the AI'
      : status === 429 ? 'that is all the AI for today — it comes back tomorrow'
      : status === 503 ? 'the AI has no keys on this server yet'
      : 'the AI could not answer just now';
    var body = error && error.context && typeof error.context.json === 'function' && status !== 404
      ? error.context.json().then(function (b) { return b && b.error ? String(b.error) : null; }, function () { return null; })
      : Promise.resolve(null);
    return body.then(function (said) { return new Error(said || fallback); });
  }

  function ask(kind, input) {
    var c = client();
    if (!c || !c.functions) return Promise.reject(new Error('sign in to use the AI'));
    return c.functions.invoke('ai', { body: { kind: kind, input: input } }).then(function (res) {
      if (res.error) return trouble(res.error).then(function (e) { throw e; });
      var data = res.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
      if (!data || !data.result) throw new Error('the AI gave back nothing');
      return data;
    });
  }

  function busy(kind, on, error) {
    status.busy = on;
    status.kind = on ? kind : status.kind;
    if (!on) status.error = error || '';
    tell();
  }

  /* ---------- writing tasks down ---------- */

  var DAY = /^\d{4}-\d{2}-\d{2}$/;

  function weekday(key) {
    return new Date(key + 'T12:00').toLocaleDateString('en', { weekday: 'long' }).toLowerCase();
  }

  /* What it found, made safe: dates that are dates, minutes that are minutes,
     tags written the way pip writes them, and "after" pointing only at
     things that exist -- another of these, or one of your open tasks. */
  function cleanTasks(list, open) {
    var ids = {};
    open.forEach(function (t) { ids[t.id] = true; });
    var out = [];
    (Array.isArray(list) ? list : []).slice(0, 40).forEach(function (raw) {
      if (!raw || typeof raw.title !== 'string') return;
      var title = raw.title.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!title) return;
      var tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
      var existing = Store.tags().filter(function (t) { return t.name.toLowerCase() === tag.toLowerCase(); })[0];
      tag = existing ? existing.name : tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!/^[A-Z][A-Z0-9]{1,7}$/.test(tag) && !existing) tag = '';
      // the tag is the first word of a title; it is not said twice
      if (tag && title.split(/\s+/)[0].toUpperCase() === tag.toUpperCase()) title = title.split(/\s+/).slice(1).join(' ') || title;
      var mins = Math.round(Number(raw.mins) / 5) * 5;
      out.push({
        title: title,
        tag: tag || null,
        due: typeof raw.due === 'string' && DAY.test(raw.due) ? raw.due : null,
        mins: mins >= 5 && mins <= 900 ? mins : null,
        repeat: ['daily', 'weekdays', 'weekly'].indexOf(raw.repeat) !== -1 ? raw.repeat : null,
        after: (Array.isArray(raw.after) ? raw.after : []).map(String)
      });
    });
    // "after" by position, or by one of your ids; anything else is dropped
    out.forEach(function (task, i) {
      task.after = task.after.filter(function (ref) {
        if (/^\d+$/.test(ref)) { var n = +ref; return n !== i && n < out.length; }
        return ids[ref];
      });
    });
    return out;
  }

  function parse(text) {
    if (!usable()) return Promise.reject(new Error(state.on ? 'sign in to use the AI' : 'the AI is switched off in settings'));
    var key = Store.dayKey();
    var open = Store.tasks().filter(function (t) { return !Store.isDone(t, key) && !Store.repeats(t); })
      .slice(0, 60).map(function (t) { return { id: t.id, title: t.title, due: t.due || null }; });
    var input = {
      text: String(text || '').slice(0, 6000),
      today: key,
      weekday: weekday(key),
      tags: Store.tags().map(function (t) { return { name: t.name, kind: t.kind }; }),
      open: open,
      about: about.slice(0, 1200)
    };
    busy('parse', true);
    return ask('parse', input).then(function (data) {
      busy('parse', false);
      var tasks = cleanTasks(data.result.tasks, open);
      if (!tasks.length) throw new Error('the AI found nothing to add there');
      return { tasks: tasks, meta: data.meta || {} };
    }, function (err) { busy('parse', false, err.message); throw err; });
  }

  /* The cards you said yes to, as tasks -- and the "do this first" links
     between them and the tasks you already had. */
  function addAll(cards, listId) {
    var made = [];
    cards.forEach(function (card) {
      var title = (card.tag ? card.tag + ' ' : '') + card.title;
      made.push(Store.addTask({ title: title, listId: listId, due: card.due, mins: card.mins || 30,
        repeat: card.repeat || 'none' }));
    });
    cards.forEach(function (card, i) {
      if (!made[i]) return;
      (card.after || []).forEach(function (ref) {
        var first = /^\d+$/.test(ref) ? made[+ref] : Store.taskById(ref);
        if (first) Store.link(first.id, made[i].id);
      });
    });
    return made.filter(Boolean);
  }

  /* ---------- planning the evening ---------- */

  /* What tonight's plan depends on, written as one line: the tasks that
     could be in it with their deadlines and sizes, the links between them,
     the evening's fixed things, bedtime, and what you said about yourself.
     A task finishing is not on the list on purpose -- the plan just moves
     on past it, which needs no one to think again. */
  function signature(input) {
    return JSON.stringify([
      input.bed, input.about,
      (input.tasks || []).map(function (t) {
        return [t.id, t.due, Math.round(t.left / 15), (t.needs || []).join('+')].join(':');
      }),
      (input.events || []).map(function (e) { return e.title + '@' + e.start; })
    ]);
  }

  function sigParts(sig) {
    try { return JSON.parse(sig); } catch (e) { return null; }
  }

  /* Did anything change that the plan did not already know about? Things
     being finished or removed do not count: what is left of the plan still
     holds. Something new, a deadline moving, a task growing, an event, a new
     bedtime, a new note about yourself -- those do. */
  function changedSince(oldSig, newSig) {
    if (!oldSig) return true;
    if (oldSig === newSig) return false;
    var a = sigParts(oldSig), b = sigParts(newSig);
    if (!a || !b) return true;
    if (a[0] !== b[0] || a[1] !== b[1]) return true;
    if (JSON.stringify(a[3]) !== JSON.stringify(b[3])) return true;
    var before = {};
    a[2].forEach(function (t) { before[t] = true; });
    return b[2].some(function (t) { return !before[t]; });
  }

  /* The plan for today, if there is one worth using. */
  function planFor(key) {
    var plan = state.plan;
    if (!state.on || !plan || plan.day !== key) return null;
    if (Date.now() - plan.at > STALE_PLAN) return null;
    return plan;
  }

  function replan(why) {
    if (!usable() || !window.Plan || !Plan.aiInput) return Promise.resolve(null);
    var input = Plan.aiInput(about);
    if (!input) return Promise.resolve(null);
    var sig = signature(input);
    busy('plan', true);
    return ask('plan', input).then(function (data) {
      var result = data.result || {};
      state.plan = {
        day: input.today, at: Date.now(), sig: sig,
        steps: Array.isArray(result.steps) ? result.steps.slice(0, 30) : [],
        later: Array.isArray(result.later) ? result.later.slice(0, 30) : [],
        links: Array.isArray(result.links) ? result.links.slice(0, 10) : [],
        note: typeof result.note === 'string' ? result.note.slice(0, 120) : '',
        used: (data.meta && data.meta.used) || '',
        judged: !!(data.meta && data.meta.judged),
        why: why || ''
      };
      keep();
      busy('plan', false);
      return state.plan;
    }, function (err) {
      busy('plan', false, err.message);
      return null;
    });
  }

  /* Called whenever anything changes, and once a minute. It only arms a
     timer; the asking happens once things have been quiet for a while. */
  function consider() {
    if (!usable() || !window.Plan || !Plan.aiInput) return;
    var input = Plan.aiInput(about);
    if (!input) return;
    var plan = planFor(input.today);
    var sig = signature(input);
    var now = Date.now();
    var due;
    if (!plan) due = true;                                   // nothing for tonight yet
    else due = changedSince(plan.sig, sig);
    // the evening slid: what it planned no longer fits the time that is left
    if (!due && plan && input.free + 20 < plannedMins(plan) && now - plan.at > GAP) due = true;
    if (!due) { clearTimeout(settleTimer); settleTimer = 0; pendingSig = null; return; }
    // already waiting on exactly this: the clock moving on is not a change
    if (settleTimer && sig === pendingSig) return;

    pendingSig = sig;
    clearTimeout(settleTimer);
    var wait = SETTLE;
    // on its own, at most every half hour -- except the first plan of the day
    if (plan && now - state.asked < GAP) wait = Math.max(wait, GAP - (now - state.asked));
    settleTimer = setTimeout(function () {
      settleTimer = 0;
      pendingSig = null;
      if (status.busy) return;
      state.asked = Date.now();
      keep();
      replan('changed');
    }, wait);
  }

  /* What is still ahead in the plan, counted the way the planner will use
     it: each task once, never for more than is left of it. */
  function plannedMins(plan) {
    var seen = {};
    return plan.steps.reduce(function (sum, s) {
      var task = Store.taskById(s && s.id);
      if (!task || seen[task.id] || Store.isDone(task)) return sum;
      seen[task.id] = true;
      var left = Math.max(5, Math.round((task.mins || 30) * (100 - (task.progress || 0)) / 100));
      return sum + Math.min(Number(s.mins) || 0, left);
    }, 0);
  }

  /* "Plan it again" -- you asked, so it goes now, quiet or not. */
  function now() {
    clearTimeout(settleTimer);
    settleTimer = 0;
    pendingSig = null;
    state.asked = Date.now();
    keep();
    return replan('asked');
  }

  /* ---------- links it noticed ---------- */

  function suggestions() {
    var plan = planFor(Store.dayKey());
    if (!plan) return [];
    return plan.links.filter(function (l) {
      var first = Store.taskById(l.first), then = Store.taskById(l.then);
      if (!first || !then || first.id === then.id) return false;
      if (Store.isDone(first) || Store.isDone(then)) return false;
      if ((then.needs || []).indexOf(first.id) !== -1) return false;
      return !state.declined[first.id + '>' + then.id];
    });
  }

  function accept(link) {
    var ok = Store.link(link.first, link.then);
    tell();
    return ok;
  }

  function decline(link) {
    state.declined[link.first + '>' + link.then] = true;
    keep();
    tell();
  }

  /* ---------- you ---------- */

  function setAbout(text) {
    about = String(text || '').slice(0, 1200);
    if (window.Sync && Sync.setPref) Sync.setPref('about', about);
    try { localStorage.setItem(KEY + '.about', about); } catch (e) {}
    consider();
    tell();
  }

  function setOn(on) {
    state.on = !!on;
    keep();
    if (!state.on) { clearTimeout(settleTimer); settleTimer = 0; }
    tell();
    if (window.Plan) Plan.render();
  }

  function init() {
    try { about = localStorage.getItem(KEY + '.about') || ''; } catch (e) {}
    // another device's note about you wins once it arrives
    var adopted = false;
    function adopt() {
      if (adopted || !signedIn() || !window.Sync || !Sync.getPref) return;
      adopted = true;
      Promise.resolve(Sync.getPref('about')).then(function (theirs) {
        if (typeof theirs === 'string' && theirs !== about) {
          about = theirs.slice(0, 1200);
          try { localStorage.setItem(KEY + '.about', about); } catch (e) {}
          tell();
        }
      }, function () { adopted = false; });
    }
    if (window.Store) Store.subscribe(function () { adopt(); consider(); });
    setInterval(function () { adopt(); consider(); }, 60 * 1000);
    window.addEventListener('online', consider);
    setTimeout(function () { adopt(); consider(); }, 2500);
  }

  return {
    init: init,
    on: function () { return state.on; },
    setOn: setOn,
    usable: usable,
    about: function () { return about; },
    setAbout: setAbout,
    status: function () { return { busy: status.busy, kind: status.kind, error: status.error }; },
    onChange: function (fn) { listeners.push(fn); },
    parse: parse,
    addAll: addAll,
    planFor: planFor,
    now: now,
    consider: consider,
    suggestions: suggestions,
    accept: accept,
    decline: decline,
    // for tests: the timing rules, without waiting for them
    _rules: { SETTLE: SETTLE, GAP: GAP, changedSince: changedSince, signature: signature }
  };
})();
