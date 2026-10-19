/* The welcome: a minute of setting up, one question at a time -- your
   classes, what you practise, when you mean to be asleep, your calendar, and
   anything the AI should know. Everything is skippable and everything can be
   changed later in settings; nothing here is a test. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KEY_STATE = 'pip.state.v1';
  var fromSignIn = /[?&#](code|access_token)=/.test(location.search + location.hash);

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function readState() { try { return JSON.parse(localStorage.getItem(KEY_STATE) || '{}') || {}; } catch (e) { return {}; } }
  function signedIn() { return Store.remote.signedIn(); }

  /* ---------- what you have picked so far ---------- */

  var pick = { classes: [], practice: [], bed: 24 * 60, start: 5 * 60, about: '' };

  function gather() {
    var settings = readState().settings || {};
    if (typeof settings.dayEnd === 'number') pick.bed = settings.dayEnd;
    if (typeof settings.dayStart === 'number') pick.start = settings.dayStart;
    pick.classes = Store.tags().filter(function (t) { return t.kind !== 'practice'; })
      .map(function (t) { return { name: t.name, had: true }; });
    pick.practice = Store.tags().filter(function (t) { return t.kind === 'practice'; }).map(function (t) {
      var task = Store.tasks().filter(function (k) { return (k.tags || [])[0] === t.id && Store.repeats(k); })[0];
      return { name: t.name, mins: task ? task.mins : 30, had: true };
    });
    pick.about = window.Ai ? Ai.about() : '';
  }

  function code(name) {
    return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  /* ---------- the questions ---------- */

  var STEPS = [
    { id: 'hello', title: 'hi! let’s set up your desk', draw: drawHello },
    { id: 'classes', title: 'what are you taking?', draw: drawClasses, save: saveClasses },
    { id: 'practice', title: 'anything you practise most days?', draw: drawPractice, save: savePractice },
    { id: 'bed', title: 'when do you want to be asleep?', draw: drawBed, save: saveBed },
    { id: 'calendar', title: 'your calendar', draw: drawCalendar, optional: true },
    { id: 'about', title: 'anything the AI should know?', draw: drawAbout, save: saveAbout, optional: true },
    { id: 'done', title: 'your desk is ready', draw: drawDone }
  ];
  var at = 0;

  function lede(box, text) { box.appendChild(node('p', 'auth-lede', text)); }

  function drawHello(box) {
    lede(box, 'a minute, five questions, and you can skip any of them. you can change all of it later in settings.');
    var pets = node('div', 'welcome-hello');
    pets.appendChild(node('span', 'welcome-wave', '✦'));
    pets.appendChild(node('p', '', 'pip and pop (the two at the bottom) study with you. tap them to say hi.'));
    box.appendChild(pets);
    if (!signedIn()) {
      var note = node('p', 'auth-small');
      note.appendChild(document.createTextNode('you’re not signed in — that’s fine, everything stays in this browser. '));
      var link = node('a', '', 'make an account');
      link.href = '../account/?next=../welcome/#signup';
      note.appendChild(link);
      note.appendChild(document.createTextNode(' to keep it on every device and let the AI plan with you.'));
      box.appendChild(note);
    }
  }

  var CLASS_IDEAS = ['MATH', 'BIO', 'CHEM', 'PHYS', 'ENG', 'HIST', 'SPAN', 'CS', 'APUSH', 'ECON', 'ART', 'SAT'];

  function drawClasses(box) {
    lede(box, 'one chip per class. short codes work best — type BIO, then later “BIO read ch 5 fri” files it under BIO.');
    var chips = node('div', 'welcome-chips');
    pick.classes.forEach(function (c, i) {
      var chip = node('span', 'welcome-chip' + (c.had ? ' is-had' : ''));
      chip.appendChild(node('span', '', c.name));
      if (!c.had) {
        var drop = node('button', 'welcome-drop', '×');
        drop.type = 'button';
        drop.setAttribute('aria-label', 'Remove ' + c.name);
        drop.addEventListener('click', function () { pick.classes.splice(i, 1); draw(); });
        chip.appendChild(drop);
      }
      chips.appendChild(chip);
    });
    box.appendChild(chips);

    var input = node('input', 'welcome-input');
    input.type = 'text';
    input.placeholder = 'add a class, then enter';
    input.setAttribute('aria-label', 'A class');
    input.autocapitalize = 'characters';
    function add(name) {
      var c = code(name);
      if (c.length < 2) { if (window.Motion) Motion.nudge(input); return; }
      if (pick.classes.some(function (x) { return x.name === c; })) return;
      pick.classes.push({ name: c });
      draw();
      var again = document.querySelector('.welcome-input');
      if (again) again.focus();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (input.value.trim()) add(input.value); else go(1); }
    });
    box.appendChild(input);

    var ideas = node('div', 'welcome-ideas');
    CLASS_IDEAS.filter(function (n) { return !pick.classes.some(function (x) { return x.name === n; }); })
      .slice(0, 8).forEach(function (n) {
        var b = node('button', 'chip', '+ ' + n);
        b.type = 'button';
        b.addEventListener('click', function () { add(n); });
        ideas.appendChild(b);
      });
    box.appendChild(ideas);
    setTimeout(function () { input.focus(); }, 60);
  }

  function saveClasses() {
    pick.classes.forEach(function (c) { if (!c.had) Store.tagByName(c.name); });
    Store.notify();
  }

  var PRACTICE_IDEAS = [{ name: 'USACO', mins: 60 }, { name: 'PIANO', mins: 30 }, { name: 'SAT', mins: 45 }, { name: 'READING', mins: 20 }];

  function drawPractice(box) {
    lede(box, 'the things that don’t have a due date but you want to do every day — competition prep, an instrument, SAT. pip keeps time for them.');
    var list = node('div', 'welcome-rows');
    pick.practice.forEach(function (p, i) {
      var row = node('div', 'welcome-row');
      row.appendChild(node('span', 'tag tone-coral', p.name));
      var mins = node('input', 'welcome-mins');
      mins.type = 'number';
      mins.min = '10';
      mins.step = '5';
      mins.value = p.mins;
      mins.setAttribute('aria-label', 'Minutes a day of ' + p.name);
      mins.addEventListener('change', function () { p.mins = Math.max(10, Math.min(300, Math.round(+mins.value / 5) * 5 || 30)); mins.value = p.mins; });
      row.appendChild(mins);
      row.appendChild(node('span', 'welcome-unit', 'min a day'));
      if (!p.had) {
        var drop = node('button', 'welcome-drop', '×');
        drop.type = 'button';
        drop.setAttribute('aria-label', 'Remove ' + p.name);
        drop.addEventListener('click', function () { pick.practice.splice(i, 1); draw(); });
        row.appendChild(drop);
      }
      list.appendChild(row);
    });
    box.appendChild(list);

    var input = node('input', 'welcome-input');
    input.type = 'text';
    input.placeholder = 'add one, then enter';
    input.setAttribute('aria-label', 'Something you practise');
    function add(name, mins) {
      var c = code(name);
      if (c.length < 2) { if (window.Motion) Motion.nudge(input); return; }
      if (pick.practice.some(function (x) { return x.name === c; })) return;
      pick.practice.push({ name: c, mins: mins || 30 });
      draw();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim()) add(input.value); else go(1); }
    });
    box.appendChild(input);
    var ideas = node('div', 'welcome-ideas');
    PRACTICE_IDEAS.filter(function (x) { return !pick.practice.some(function (p) { return p.name === x.name; }); })
      .forEach(function (x) {
        var b = node('button', 'chip', '+ ' + x.name.toLowerCase() + ' ' + x.mins + 'm');
        b.type = 'button';
        b.addEventListener('click', function () { add(x.name, x.mins); });
        ideas.appendChild(b);
      });
    box.appendChild(ideas);
  }

  function savePractice() {
    pick.practice.forEach(function (p) {
      var tag = Store.tagByName(p.name);
      if (!tag) return;
      if (tag.kind !== 'practice') Store.setTagKind(tag.id, 'practice', 1);
      var task = Store.tasks().filter(function (k) { return (k.tags || [])[0] === tag.id && Store.repeats(k); })[0];
      if (task) { if (task.mins !== p.mins) Store.updateTask(task.id, { mins: p.mins }); }
      else Store.addTask({ title: tag.name + ' practice', repeat: 'daily', mins: p.mins });
    });
    Store.notify();
  }

  function hhmm(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }
  function minutes(text) {
    var m = String(text || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  function drawBed(box) {
    lede(box, 'pip plans the evening to finish before this, and gets firmer about deadlines as it gets close.');
    var row = node('div', 'welcome-times');
    [22 * 60, 22 * 60 + 30, 23 * 60, 23 * 60 + 30, 24 * 60].forEach(function (m) {
      var b = node('button', 'welcome-time', hhmm(m));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pick.bed === m));
      b.addEventListener('click', function () { pick.bed = m; draw(); });
      row.appendChild(b);
    });
    box.appendChild(row);
    var own = node('label', 'auth-field');
    own.appendChild(node('span', '', 'or exactly'));
    var input = node('input', '');
    input.type = 'time';
    input.value = hhmm(pick.bed);
    input.addEventListener('change', function () {
      var m = minutes(input.value);
      if (m === null) return;
      // the evening ends at midnight at the latest; anything after it is midnight
      pick.bed = m === 0 || m < pick.start ? 1440 : m;
      draw();
    });
    own.appendChild(input);
    box.appendChild(own);
  }

  function saveBed() {
    var state = readState();
    state.settings = state.settings || {};
    state.settings.dayEnd = Math.max(state.settings.dayStart || pick.start, Math.min(1440, pick.bed));
    try { localStorage.setItem(KEY_STATE, JSON.stringify(state)); } catch (e) {}
  }

  function drawCalendar(box) {
    lede(box, 'tutoring, practice, clubs — the things that repeat live best in Google Calendar. connect it and pip plans around them.');
    if (!signedIn()) {
      var note = node('p', 'auth-small');
      note.appendChild(document.createTextNode('this needs an account — '));
      var link = node('a', '', 'sign in or make one');
      link.href = '../account/?next=../welcome/';
      note.appendChild(link);
      note.appendChild(document.createTextNode(', or skip it and connect one later in settings.'));
      box.appendChild(note);
      return;
    }
    if (window.Calendar && Calendar.connected()) {
      box.appendChild(node('p', 'welcome-done-line', '✓ connected — ' + Calendar.status()));
      return;
    }
    var add = node('div', 'cal-add');
    var input = node('input', 'welcome-input');
    input.type = 'url';
    input.placeholder = 'paste the secret iCal link';
    input.setAttribute('aria-label', 'Calendar iCal link');
    var go = node('button', 'go small', 'connect');
    go.type = 'button';
    var said = node('p', 'auth-said', '');
    go.addEventListener('click', function () {
      if (!input.value.trim()) return;
      go.classList.add('is-loading');
      Calendar.add(input.value).then(function (res) {
        go.classList.remove('is-loading');
        if (res && res.error) { said.textContent = res.error; return; }
        draw();
      });
    });
    add.appendChild(input);
    add.appendChild(go);
    box.appendChild(add);
    box.appendChild(said);
    var how = node('details', 'cal-how');
    how.appendChild(node('summary', null, 'where is that link?'));
    how.appendChild(node('p', 'auth-small', 'Google Calendar on a computer → ⚙ Settings → your calendar on the left → Integrate calendar → copy “Secret address in iCal format”. Keep it private, like a password.'));
    box.appendChild(how);
  }

  function drawAbout(box) {
    lede(box, 'the AI reads this every time it plans your evening. what’s going on, what matters, how you like to work.');
    if (!signedIn()) {
      var note = node('p', 'auth-small');
      note.appendChild(document.createTextNode('the AI works through your account — '));
      var link = node('a', '', 'sign in or make one');
      link.href = '../account/?next=../welcome/';
      note.appendChild(link);
      note.appendChild(document.createTextNode(' to use it.'));
      box.appendChild(note);
      return;
    }
    var area = node('textarea', 'ai-about welcome-about');
    area.rows = 5;
    area.placeholder = 'e.g. applying to a summer research program — essay due nov 1. i tutor kids tue and thu. ' +
      'i want an hour of USACO most days. i focus best before 9.';
    area.value = pick.about;
    area.addEventListener('input', function () { pick.about = area.value; });
    box.appendChild(area);
    box.appendChild(node('p', 'auth-small', 'it’s sent to the AI with your task names and deadlines when it plans. leave out anything private.'));
  }

  function saveAbout() {
    if (window.Ai && signedIn() && pick.about !== Ai.about()) Ai.setAbout(pick.about);
  }

  function drawDone(box) {
    var bits = [];
    var classes = pick.classes.length;
    if (classes) bits.push(classes + (classes === 1 ? ' class' : ' classes'));
    pick.practice.forEach(function (p) { bits.push(p.name.toLowerCase() + ' ' + p.mins + 'm a day'); });
    bits.push('bed at ' + hhmm(pick.bed));
    if (window.Calendar && Calendar.connected()) bits.push('calendar connected');
    lede(box, 'add your homework in the box at the top of your list — or paste a whole page of it and press ✦.');
    var list = node('div', 'welcome-chips');
    bits.forEach(function (b) { list.appendChild(node('span', 'welcome-chip is-had', b)); });
    box.appendChild(list);
    if (window.Motion) setTimeout(Motion.confetti, 200);
    if (window.Pet) Pet.event('allDone');
  }

  /* ---------- moving through ---------- */

  function drawSteps() {
    var list = $('steps');
    list.textContent = '';
    STEPS.forEach(function (s, i) {
      var dot = node('li', i < at ? 'is-past' : '');
      dot.setAttribute('aria-current', String(i === at));
      dot.appendChild(node('span', 'sr', s.title));
      list.appendChild(dot);
    });
  }

  function draw() {
    var step = STEPS[at];
    var box = $('step');
    box.textContent = '';
    box.appendChild(node('h1', 'auth-title', step.title));
    step.draw(box);
    drawSteps();
    $('back').hidden = at === 0 || at === STEPS.length - 1;
    var empty = step.id === 'calendar' ? !(window.Calendar && Calendar.connected())
      : step.id === 'about' ? !pick.about.trim() : false;
    $('next').textContent = at === 0 ? 'let’s go' : at === STEPS.length - 1 ? 'open my desk'
      : step.optional && empty ? 'skip' : 'next';
  }

  function go(delta) {
    var step = STEPS[at];
    if (delta > 0 && step.save) step.save();
    if (delta > 0 && at === STEPS.length - 1) { finish(); return; }
    at = Math.max(0, Math.min(STEPS.length - 1, at + delta));
    draw();
    if (window.Motion) Motion.play($('step'), [{ opacity: 0, transform: 'translateX(' + (delta > 0 ? 18 : -18) + 'px)' },
      { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });
  }

  function finish() {
    try { localStorage.setItem('pip.welcomed', String(Date.now())); } catch (e) {}
    if (signedIn() && window.Sync && Sync.setPref) {
      Sync.setPref('welcomed', true).catch(function () {}).then(function () { location.href = '../app/'; });
      setTimeout(function () { location.href = '../app/'; }, 1500);
    } else location.href = '../app/';
  }

  $('next').addEventListener('click', function () { go(1); });
  $('back').addEventListener('click', function () { go(-1); });
  $('skip').addEventListener('click', function () {
    try { localStorage.setItem('pip.welcomed', String(Date.now())); } catch (e) {}
  });

  Store.init();
  gather();
  draw();
  if (window.Pet) Pet.init();

  /* Back from signing in with Google: someone who has a desk already goes to
     it; someone new carries on here. */
  var started = Date.now();
  (function wait() {
    var status = Store.remote.status();
    if (status === 'connecting' && Date.now() - started < 10000) { setTimeout(wait, 150); return; }
    if (!signedIn()) return;
    if (at === 0) { gather(); draw(); }
    if (!fromSignIn) return;
    var had = false;
    try { had = !!localStorage.getItem('pip.welcomed'); } catch (e) {}
    Promise.resolve(window.Sync && Sync.getPref ? Sync.getPref('welcomed') : null).then(function (theirs) {
      if (theirs || had || Store.tasks().length) location.replace('../app/');
    }, function () {});
  })();
})();
