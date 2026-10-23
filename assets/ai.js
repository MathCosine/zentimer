/* The AI side of pip. By default it asks through Puter, from the page: each
   person signs in to their own free Puter account once, and pip needs no key
   and no server. Two different models answer, both answers are checked
   against what pip actually has, and when they disagree a third call judges.
   Or, if you run the relay on your own Supabase project, through that (Groq
   and Gemini, compared the same way). Either way it decides *when* to ask: not on every keystroke, not twenty times while you
   paste in a week of homework, and never more than every half hour on its
   own -- only when something that matters to tonight has changed and then
   gone quiet for a minute and a half.

   Nothing here is trusted blindly. The planner checks every plan before it
   uses it, and the rule-based plan is always there underneath: offline, out
   of quota, or the AI having a bad day, the evening still gets planned. */
window.Ai = (function () {
  'use strict';

  var KEY = 'pip.ai.v1';
  var SETTLE = 90 * 1000;            // quiet this long before the morning's plan is asked for
  var MORNING = 5 * 60;              // on its own, once a day, from five in the morning

  /* Puter: two families, so their mistakes are not the same mistakes, and a
     small quick model to judge between them. Each a list -- when one is
     retired or busy, the next is tried. */
  var PUTER_SRC = 'https://js.puter.com/v2/';
  var PUTER_A = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  var PUTER_B = ['gpt-5.4-nano', 'gpt-5.5'];
  var PUTER_JUDGE = ['gpt-5.4-nano', 'gemini-3.5-flash-lite'];

  var saved = read() || {};
  var state = {
    on: saved.on !== false,
    provider: saved.provider === 'relay' ? 'relay' : 'puter',
    linked: !!saved.linked,          // Puter was connected on this device, so load it at start
    plan: saved.plan || null,        // { day, at, sig, steps, later, links, note, used, judged }
    asked: saved.asked || 0,         // when it last asked
    autoDay: saved.autoDay || '',    // the day it last asked on its own: once a day, no more
    declined: saved.declined || {}   // links you said no to: 'first>then'
  };
  var about = '';                    // what you told it about your life right now (synced)
  var notes = [];                    // things true only for now: today, or this week (synced)
  var status = { busy: false, error: '', kind: '' };
  var listeners = [];
  var settleTimer = 0, pendingSig = null;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function keep() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: state.on, provider: state.provider, linked: state.linked,
        plan: state.plan, asked: state.asked, autoDay: state.autoDay, declined: state.declined }));
    } catch (e) { /* private mode */ }
  }
  function tell() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function client() { return window.Sync && Sync.client ? Sync.client() : null; }
  function signedIn() {
    try { return !!(window.Store && Store.remote && Store.remote.signedIn()); } catch (e) { return false; }
  }
  /* ---------- Puter ---------- */

  var puterLoading = null;

  /* Its script is someone else's, so it is only fetched once you are using
     it: when you connect, or at start if this device connected before. */
  function loadPuter() {
    if (window.puter) return Promise.resolve(window.puter);
    if (puterLoading) return puterLoading;
    puterLoading = new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = PUTER_SRC;
      tag.async = true;
      tag.onload = function () {
        if (!window.puter) { puterLoading = null; reject(new Error('Puter did not load')); return; }
        try { window.puter.quiet = true; } catch (e) {}
        resolve(window.puter);
        tell();
      };
      tag.onerror = function () { puterLoading = null; reject(new Error('Puter could not be reached')); };
      document.head.appendChild(tag);
    });
    return puterLoading;
  }

  function puterReady() {
    try { return !!(window.puter && window.puter.auth && window.puter.auth.isSignedIn()); } catch (e) { return false; }
  }

  /* Signing in to Puter opens its own small window, which browsers only allow
     straight from a click -- so this is called from one, with the script
     already loaded by then (it starts loading the moment anything hints you
     might want the AI). */
  function connect() {
    if (puterReady()) { state.linked = true; keep(); return Promise.resolve(true); }
    if (!window.puter) {
      loadPuter().catch(function () {});
      return Promise.reject(new Error('one moment \u2014 Puter is still loading, tap again'));
    }
    return window.puter.auth.signIn().then(function () {
      state.linked = true;
      keep();
      tell();
      consider();
      return true;
    }, function (err) {
      var why = String((err && (err.error || err.code || err.message)) || err || '');
      throw new Error(/closed|cancel/i.test(why) ? 'Puter sign-in was closed before it finished'
        : /popup/i.test(why) ? 'the browser blocked Puter\u2019s sign-in window \u2014 allow pop-ups for this site'
        : 'could not sign in to Puter just now');
    });
  }

  function disconnect() {
    try { if (window.puter && window.puter.auth) window.puter.auth.signOut(); } catch (e) {}
    state.linked = false;
    keep();
    tell();
  }

  /* Who is signed in to Puter, for settings to say. */
  function puterName() {
    if (!puterReady()) return Promise.resolve(null);
    return Promise.resolve(window.puter.auth.getUser()).then(function (user) {
      return user && (user.username || user.email) || 'your Puter account';
    }, function () { return 'your Puter account'; });
  }

  /* Usable means: switched on, online, and connected -- to Puter, or for the
     relay, signed in to pip (the relay is for signed-in people). */
  function usable() {
    if (!state.on || navigator.onLine === false) return false;
    return state.provider === 'puter' ? puterReady() : signedIn() && !!client();
  }

  /* When it is not usable: why, in a few words, and what would fix it. */
  function blocker() {
    if (!state.on) return { text: 'the AI is switched off in settings' };
    if (navigator.onLine === false) return { text: 'the AI needs the internet' };
    if (state.provider === 'puter') {
      loadPuter().catch(function () {});
      return { text: 'the AI runs on a free Puter account \u2014 connect it once', fix: 'connect' };
    }
    return { text: 'sign in to use the AI', fix: 'signin' };
  }

  /* ---------- asking ---------- */

  function ask(kind, input) {
    return state.provider === 'puter' ? askPuter(kind, input) : askRelay(kind, input);
  }

  function puterTrouble(err) {
    var why = String((err && (err.message || (err.error && (err.error.message || err.error)) || err.code)) || err || '');
    if (/insufficient|funds|credit|allowance|quota|402|payment|upgrade/i.test(why)) {
      return new Error('your free Puter AI allowance is used up for this month');
    }
    if (/401|unauthori|not signed|sign in|auth/i.test(why)) return new Error('connect Puter again to use the AI');
    if (/network|fetch|failed to|timeout/i.test(why)) return new Error('Puter could not be reached just now');
    return new Error('the AI could not answer just now');
  }

  function stopper(err) {
    return /insufficient|funds|credit|allowance|quota|402|payment|upgrade|401|unauthori/i.test(
      String((err && (err.message || (err.error && (err.error.message || err.error)) || err.code)) || err || ''));
  }

  function textOf(reply) {
    var content = reply && reply.message ? reply.message.content : reply;
    if (Array.isArray(content)) return content.map(function (part) { return part && part.text || ''; }).join('');
    if (content && typeof content === 'object' && !Array.isArray(content)) return content;
    return content || (reply && reply.text) || String(reply || '');
  }

  /* One model, with the schema enforced where it can be; if a model will not
     take the schema as an option, the same question again with the schema
     only in words; then the next model on the list. */
  function chatJson(models, system, user, schema, name) {
    var tries = [];
    models.forEach(function (model) { tries.push([model, true], [model, false]); });
    var at = 0, last = null;
    function next() {
      if (at >= tries.length) return Promise.reject(last || new Error('no model answered'));
      var model = tries[at][0], strict = tries[at][1];
      at++;
      var options = { model: model, temperature: 0.3 };
      if (strict) options.outputFormat = { type: 'json_schema', name: name, strict: true, schema: schema };
      return Promise.resolve(window.puter.ai.chat([
        { role: 'system', content: system + '\nThe JSON must match this schema:\n' + JSON.stringify(schema) },
        { role: 'user', content: user }
      ], options)).then(function (reply) {
        return { model: model, answer: AiBrain.readJson(textOf(reply)) };
      }).catch(function (err) {
        last = err;
        if (stopper(err)) throw err;           // out of allowance, or signed out: no use trying more
        return next();
      });
    }
    return next();
  }

  function settle(promise) {
    return promise.then(function (v) { return { ok: true, value: v }; }, function (e) { return { ok: false, error: e }; });
  }

  function askPuter(kind, input) {
    if (!window.puter || !puterReady()) return Promise.reject(new Error('connect Puter to use the AI'));
    var brain = AiBrain[kind];
    var user = brain.message ? brain.message(input) : JSON.stringify(input);
    return Promise.all([
      settle(chatJson(PUTER_A, brain.system, user, brain.schema, kind)),
      settle(chatJson(PUTER_B, brain.system, user, brain.schema, kind))
    ]).then(function (asked) {
      var heard = [], trouble = {};
      asked.forEach(function (got, i) {
        var who = i ? 'gpt' : 'gemini';
        if (!got.ok) { trouble[who] = String((got.error && got.error.message) || got.error).slice(0, 160); return; }
        var score = brain.score(got.value.answer, input);
        if (score === null || score === undefined) { trouble[who] = 'answer did not check out'; return; }
        heard.push({ who: who, model: got.value.model, answer: got.value.answer, score: score });
      });
      if (!heard.length) {
        var first = asked.filter(function (a) { return !a.ok; })[0];
        throw first ? puterTrouble(first.error) : new Error('neither AI gave a usable answer');
      }
      heard.sort(function (a, b) { return b.score - a.score; });
      var meta = { used: heard[0].who, judged: false, verdict: '', heard: heard.map(function (h) { return h.who; }), trouble: trouble };
      var done = function (pick) { meta.used = pick.who; return { result: pick.answer, meta: meta }; };
      /* Both usable, really different, and neither clearly worse: a third
         reads both, labelled A and B in a random order. */
      if (heard.length < 2 || AiBrain.sameOrder(heard[0].answer, heard[1].answer) || heard[0].score - heard[1].score >= 25) {
        return done(heard[0]);
      }
      var flip = Math.random() < 0.5;
      var a = flip ? heard[1] : heard[0], b = flip ? heard[0] : heard[1];
      var asking = kind === 'plan' ? { studentSays: AiBrain.studentSays(input), request: input, A: a.answer, B: b.answer }
        : { request: input, A: a.answer, B: b.answer };
      return chatJson(PUTER_JUDGE, AiBrain.judge.system, JSON.stringify(asking),
        AiBrain.judge.schema, 'judge').then(function (ruling) {
        meta.judged = true;
        meta.verdict = String(ruling.answer.why || '').slice(0, 160);
        return done(ruling.answer.pick === 'B' ? b : a);
      }, function () { return done(heard[0]); });
    });
  }

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

  function askRelay(kind, input) {
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
    if (!usable()) return Promise.reject(new Error(blocker().text));
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
      (input.events || []).map(function (e) { return e.title + '@' + e.start; }),
      // the week's fixed things, and how much room each day has
      // (not today's: tonight's room shrinks every minute, which is not news)
      (input.days || []).filter(function (d) { return d.day > input.today; }).map(function (d) {
        return d.day + ':' + Math.round((d.free || 0) / 30) + ':' + (d.busy || []).map(function (e) { return e.title + '@' + e.start; }).join(',');
      }),
      // what you said about today or this week
      (input.forNow || []).map(function (n) { return n.for + ':' + n.note; })
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
    if (JSON.stringify(a[5] || []) !== JSON.stringify(b[5] || [])) return true;
    // the week's events: a new one, or one moved -- the days themselves move on by one each day
    var weekBefore = {};
    (a[4] || []).forEach(function (d) { weekBefore[d] = true; });
    if ((b[4] || []).some(function (d) { return !weekBefore[d] && (a[4] || []).length; })) return true;
    var before = {};
    a[2].forEach(function (t) { before[t] = true; });
    return b[2].some(function (t) { return !before[t]; });
  }

  /* Today's plan: the morning's, or the last one you asked for. It holds
     all day -- what changes after it is the rules' to fit in, until you ask
     again. */
  function planFor(key) {
    var plan = state.plan;
    if (!state.on || !plan || plan.day !== key) return null;
    return plan;
  }

  /* Has anything that matters changed since today's plan was made? Said, so
     ↻ can say it is worth pressing -- never acted on by itself. */
  function stale() {
    if (!usable() || !window.Plan || !Plan.aiInput) return false;
    var plan = planFor(Store.dayKey());
    if (!plan) return false;
    var input = planInput();
    return !!input && changedSince(plan.sig, signature(input));
  }

  /* What the planner hands over, with what you said about today and this week
     on top -- each saying how long it holds. */
  function planInput() {
    var input = Plan.aiInput(about);
    if (!input) return null;
    input.forNow = activeNotes().map(function (n) {
      return { note: n.text, for: n.scope === 'today' ? 'today only' : 'until ' + n.until };
    });
    return input;
  }

  /* When it said tonight starts, and when it said you are busy -- read from
     what you told it, and only ever as times on today's clock. */
  var HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  function clockMins(text) {
    var m = HHMM.exec(String(text || '').trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function cleanBusy(list) {
    return (Array.isArray(list) ? list : []).map(function (b) {
      var from = clockMins(b && b.from), to = clockMins(b && b.to);
      if (from === null || to === null || to <= from) return null;
      return { from: from, to: to, what: String((b && b.what) || 'busy').slice(0, 30) };
    }).filter(Boolean).slice(0, 6);
  }

  function replan(why) {
    if (!usable() || !window.Plan || !Plan.aiInput) return Promise.resolve(null);
    var input = planInput();
    if (!input) return Promise.resolve(null);
    var sig = signature(input);
    busy('plan', true);
    return ask('plan', input).then(function (data) {
      var result = data.result || {};
      state.plan = {
        day: input.today, at: Date.now(), sig: sig,
        steps: Array.isArray(result.steps) ? result.steps.slice(0, 30) : [],
        start: clockMins(result.start),
        busy: cleanBusy(result.busy),
        later: Array.isArray(result.later) ? result.later.slice(0, 30) : [],
        links: Array.isArray(result.links) ? result.links.slice(0, 10) : [],
        week: Array.isArray(result.week) ? result.week.slice(0, 7) : [],
        weekNote: typeof result.weekNote === 'string' ? result.weekNote.slice(0, 160) : '',
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

  /* On its own it plans once a day: the first time pip is open from five in
     the morning, once things have been quiet for a minute and a half (another
     device's tasks arriving, a morning's worth of adding). Every other plan
     is one you asked for -- ↻, or telling it something -- because each one
     spends your free allowance. Called whenever anything changes, and once a
     minute; it only ever arms that one timer. */
  function consider() {
    if (!usable() || !window.Plan || !Plan.aiInput) return;
    var key = Store.dayKey();
    if (planFor(key) || state.autoDay === key || Store.minutesNow() < MORNING) {
      clearTimeout(settleTimer); settleTimer = 0; pendingSig = null;
      return;
    }
    var input = planInput();
    if (!input) return;                                    // nothing to plan yet
    var sig = signature(input);
    // already waiting on exactly this: the clock moving on is not a change
    if (settleTimer && sig === pendingSig) return;
    pendingSig = sig;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = 0;
      pendingSig = null;
      var today = Store.dayKey();
      if (status.busy || planFor(today) || state.autoDay === today) return;
      // once, whether or not it works: a failure is not a reason to spend more
      state.autoDay = today;
      state.asked = Date.now();
      keep();
      replan('morning');
    }, SETTLE);
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

  /* Just for now: "soccer till 7 tonight", "sick this week -- go easy".
     Each holds for today, or for the seven days the week view shows, and
     then quietly goes. Telling it something is asking it: the plan follows
     in a few seconds, not on its half-hour clock. */
  function dayAfter(key, n) {
    var d = new Date(key + 'T12:00');
    d.setDate(d.getDate() + n);
    return Store.dayKey(d);
  }

  function activeNotes() {
    var today = Store.dayKey();
    return notes.filter(function (n) { return n && typeof n.text === 'string' && n.until >= today; });
  }

  function keepNotes(share) {
    notes = activeNotes();
    try { localStorage.setItem(KEY + '.notes', JSON.stringify(notes)); } catch (e) {}
    if (share && window.Sync && Sync.setPref) Promise.resolve(Sync.setPref('notes', notes)).catch(function () {});
  }

  var tellTimer = 0;
  function planSoon() {
    clearTimeout(tellTimer);
    tellTimer = setTimeout(function () {
      tellTimer = 0;
      if (!usable()) return;
      if (status.busy) { planSoon(); return; }        // after the one already under way
      now();
    }, 4000);
  }

  function addNote(text, scope) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return null;
    var today = Store.dayKey();
    var week = scope === 'week';
    var note = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: text, scope: week ? 'week' : 'today', from: today, until: week ? dayAfter(today, 6) : today };
    notes = activeNotes().concat([note]).slice(-12);
    keepNotes(true);
    planSoon();
    tell();
    return note;
  }

  function removeNote(id) {
    var before = notes.length;
    notes = notes.filter(function (n) { return n.id !== id; });
    if (notes.length === before) return;
    keepNotes(true);
    planSoon();
    tell();
  }

  function setProvider(which) {
    state.provider = which === 'relay' ? 'relay' : 'puter';
    keep();
    if (state.provider === 'puter') loadPuter().catch(function () {});
    tell();
    consider();
    if (window.Plan) Plan.render();
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
    try { notes = JSON.parse(localStorage.getItem(KEY + '.notes') || '[]') || []; } catch (e) { notes = []; }
    if (!Array.isArray(notes)) notes = [];
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
        return Sync.getPref('notes');
      }).then(function (theirs) {
        // both devices' notes for now, each once
        if (!Array.isArray(theirs)) return;
        var have = {};
        notes.forEach(function (n) { have[n.id] = true; });
        var fresh = theirs.filter(function (n) { return n && n.id && !have[n.id] && typeof n.text === 'string'; });
        if (!fresh.length) return;
        notes = notes.concat(fresh).slice(-12);
        keepNotes(false);
        tell();
      }).catch(function () { adopted = false; });
    }
    if (window.Store) Store.subscribe(function () { adopt(); consider(); });
    setInterval(function () { adopt(); consider(); }, 60 * 1000);
    window.addEventListener('online', consider);
    setTimeout(function () { adopt(); consider(); }, 2500);
    // connected before on this device: Puter comes back with the page
    if (state.on && state.provider === 'puter' && state.linked) {
      loadPuter().then(function () { tell(); consider(); }, function () {});
    }
  }

  return {
    init: init,
    on: function () { return state.on; },
    setOn: setOn,
    provider: function () { return state.provider; },
    setProvider: setProvider,
    usable: usable,
    blocker: blocker,
    prepare: function () { if (state.provider === 'puter') loadPuter().catch(function () {}); },
    connect: connect,
    disconnect: disconnect,
    connected: puterReady,
    puterName: puterName,
    about: function () { return about; },
    setAbout: setAbout,
    notes: function () { return activeNotes().slice(); },
    addNote: addNote,
    removeNote: removeNote,
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
    stale: stale,
    _rules: { SETTLE: SETTLE, MORNING: MORNING, changedSince: changedSince, signature: signature }
  };
})();
