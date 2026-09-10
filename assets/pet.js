/* pip — a small pixel creature who potters about the page while you work.
   Everything here is drawn from character grids; no image files, no libraries. */
window.Pet = (function () {
  'use strict';

  var PX = 4;             // one sprite pixel, in CSS pixels (grows on roomy screens)
  var GW = 18, GH = 10;   // sprite grid
  var FPS = 12;           // chunky on purpose

  var COLORS = {
    o: '#c9714c', d: '#a4552f', l: '#e08a63', k: '#2f2622',
    w: '#fff6ea', s: '#c3c7cf', g: '#8a8f98', b: '#78b6dd',
    y: '#ffc95c', n: '#6fc4a4', r: '#e4795a', p: '#f2a0b5',
    c: '#7fc4e8', m: '#8a6249'
  };

  /* ---------- the creature ---------- */

  var BODY = [
    '......llllllll....',
    '....llllllllllll..',
    '...oooooooooooooo.',
    '..ooookkooookkoooo',
    'd.ooookkooookkoooo',
    '.doooooooooooooooo',
    '..oooooooooooooooo',
    '...dddddddddddddd.'
  ];

  var BODY_BLINK = [
    '......llllllll....',
    '....llllllllllll..',
    '...oooooooooooooo.',
    '..oooooooooooooooo',
    'd.ooookkooookkoooo',
    '.doooooooooooooooo',
    '..oooooooooooooooo',
    '...dddddddddddddd.'
  ];

  var LEGS_A = ['....dd...dd...dd..', '....kk...kk...kk..'];
  var LEGS_B = ['...dd...dd...dd...', '...kk...kk...kk...'];
  var LEGS_SIT = ['..................', '....kkk....kkk....'];
  var LEGS_TUCK = ['..................', '....kk......kk....'];

  function pose(body, legs) { return body.concat(legs); }

  var BLANK = '..................';

  function seated(body, feet) { return [BLANK].concat(body, [feet]); }

  var SPRITES = {
    stand:  pose(BODY, LEGS_A),
    blink:  pose(BODY_BLINK, LEGS_A),
    walkA:  pose(BODY, LEGS_A),
    walkB:  pose(BODY, LEGS_B),
    sit:    seated(BODY, LEGS_SIT[1]),
    sitB:   seated(BODY_BLINK, LEGS_SIT[1]),
    sleep:  seated(BODY_BLINK, LEGS_TUCK[1])
  };

  /* ---------- props ---------- */

  var PROPS = {
    laptop: [
      '.ssssssss.',
      '.sbbbbbbs.',
      '.sbbbbbbs.',
      '.sbbbbbbs.',
      '.ssssssss.',
      'gggggggggg'
    ],
    laptopLit: [
      '.ssssssss.',
      '.swwwwwws.',
      '.sbbbbbbs.',
      '.sbbwwbbs.',
      '.ssssssss.',
      'gggggggggg'
    ],
    ball: [
      '.kwwk.',
      'kwwwwk',
      'wwkkww',
      'wwkkww',
      'kwwwwk',
      '.kwwk.'
    ],
    book: [
      '..k..k..',
      '.kwkkwk.',
      'kwwkkwwk',
      'kwwkkwwk',
      'kwwkkwwk',
      '.kkkkkk.'
    ],
    mug: [
      'wwwww.',
      'wrrrws',
      'wrrrws',
      'wwwwws',
      '.www..'
    ],
    board: [
      'ssssssssssss',
      'swwwwwwwwwws',
      'swwwwwwwwwws',
      'swwwwwwwwwws',
      'swwwwwwwwwws',
      'ssssssssssss',
      '...s....s...',
      '...s....s...',
      '..s......s..',
      '..k......k..'
    ],
    heart: [
      '.p.p.',
      'ppppp',
      'ppppp',
      '.ppp.',
      '..p..'
    ],
    zed: [
      'kkk',
      '..k',
      '.k.',
      'kkk'
    ],
    spark: [
      '.y.',
      'yyy',
      '.y.'
    ],
    bang: [
      'k',
      'k',
      'k',
      '.',
      'k'
    ],
    note: [
      '..kk',
      '..kk',
      '..k.',
      'kkk.',
      'kkk.'
    ]
  };

  /* scribbles that appear on the whiteboard one at a time */
  var SCRIBBLES = [
    [2, 2], [3, 2], [4, 2], [5, 2], [7, 2], [8, 2],
    [2, 3], [4, 3], [6, 3], [9, 3],
    [3, 4], [4, 4], [5, 4], [6, 4], [8, 4]
  ];

  /* ---------- state ---------- */

  var canvas, ctx, hit, bubble;
  var pet = {
    x: 60, y: 0, dir: 1, perch: 0,
    state: 'idle', act: null, until: 0, targetX: null,
    hop: null, blinkAt: 0, hearts: [], bob: 0
  };
  var mode = 'idle';
  var enabled = true;
  var reduced = false;
  var confetti = [];
  var perchList = [];
  var lastPerchScan = 0;
  var lastFrame = 0;
  var clock = 0;
  var running = false;
  var bubbleUntil = 0;
  var lastChatter = 0;

  var ACTIVITIES = [
    { id: 'laptop',  min: 9, max: 24, focus: 42, brk: 4,  idle: 12 },
    { id: 'board',   min: 8, max: 16, focus: 15, brk: 5,  idle: 10 },
    { id: 'read',    min: 8, max: 16, focus: 13, brk: 9,  idle: 10 },
    { id: 'mug',     min: 6, max: 11, focus: 9,  brk: 11, idle: 9  },
    { id: 'nap',     min: 9, max: 20, focus: 2,  brk: 24, idle: 7  },
    { id: 'ball',    min: 7, max: 14, focus: 3,  brk: 19, idle: 15 },
    { id: 'swim',    min: 7, max: 13, focus: 2,  brk: 13, idle: 9  },
    { id: 'stretch', min: 4, max: 8,  focus: 7,  brk: 12, idle: 11 },
    { id: 'look',    min: 4, max: 8,  focus: 7,  brk: 9,  idle: 17 }
  ];

  var LINES = {
    start:      ['off we go!', 'focus time', "i'll work too", 'here we go'],
    complete:   ['nice one!', 'you did it', 'session done!', 'proud of you'],
    breakStart: ['break time!', 'rest those eyes', 'snack o clock', 'stretch!'],
    breakEnd:   ['ready when you are', 'back to it?', 'round two?'],
    alarm:      ['alarm!', 'hey — time!', 'psst, alarm'],
    pet:        ['hi!', 'hello!', 'boop', 'hehe', 'oh! hi'],
    halfway:    ['halfway!', 'keep going', 'doing great'],
    nearly:     ['nearly there', 'last stretch', 'almost!'],
    idle:       ['still here', 'you got this', 'nice weather in here', 'hi again']
  };

  /* ---------- drawing ---------- */

  function grid(sprite, x, y, flip, tint) {
    var w = sprite[0].length;
    for (var row = 0; row < sprite.length; row++) {
      var line = sprite[row];
      for (var col = 0; col < line.length; col++) {
        var ch = line[col];
        if (ch === '.' || ch === ' ') continue;
        var color = tint && ch === 'k' ? tint : COLORS[ch];
        if (!color) continue;
        var px = flip ? x + (w - 1 - col) * PX : x + col * PX;
        ctx.fillStyle = color;
        ctx.fillRect(px, y + row * PX, PX, PX);
      }
    }
  }

  /* a spot just past the creature's side, so props never cross his face */
  function beside(prop, flip, gap) {
    var width = prop[0].length;
    return flip ? Math.round(pet.x) - (width + gap) * PX : Math.round(pet.x) + (GW + gap) * PX;
  }

  function shadow(x, y, width) {
    ctx.fillStyle = 'rgba(47, 38, 34, 0.13)';
    ctx.fillRect(x + PX, y - PX, width - PX * 2, PX);
  }

  function inkColor() {
    return getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#2f2622';
  }

  /* ---------- perches: the floor, plus the top edge of every card ---------- */

  function scanPerches() {
    var list = [{
      y: window.innerHeight - 18,
      x0: 8,
      x1: Math.max(60, window.innerWidth - 8 - GW * PX)
    }];
    if (window.innerWidth < 620) { perchList = list; if (pet.perch >= 1) pet.perch = 0; return; }

    var cards = document.querySelectorAll('[data-perch]');
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width < 130 || r.top < 46 || r.top > window.innerHeight - 30) continue;
      list.push({ y: Math.round(r.top) + 3, x0: Math.round(r.left) + 6, x1: Math.round(r.right) - 6 - GW * PX });
    }
    perchList = list.filter(function (p) { return p.x1 > p.x0 + 10; });
    if (pet.perch >= perchList.length) pet.perch = 0;
  }

  function currentPerch() { return perchList[pet.perch] || perchList[0]; }

  /* ---------- choosing what to do next ---------- */

  function weightFor(activity) {
    return mode === 'focus' ? activity.focus : mode === 'break' ? activity.brk : activity.idle;
  }

  function pickActivity() {
    var total = 0, i;
    for (i = 0; i < ACTIVITIES.length; i++) total += weightFor(ACTIVITIES[i]);
    var roll = Math.random() * total;
    for (i = 0; i < ACTIVITIES.length; i++) {
      roll -= weightFor(ACTIVITIES[i]);
      if (roll <= 0) return ACTIVITIES[i];
    }
    return ACTIVITIES[0];
  }

  function planNext() {
    var activity = pickActivity();
    var wander = Math.random() < (reduced ? 0 : 0.55);

    if (wander && perchList.length) {
      var toOther = perchList.length > 1 && Math.random() < 0.4;
      var target = toOther ? Math.floor(Math.random() * perchList.length) : pet.perch;
      var perch = perchList[target] || currentPerch();
      var x = perch.x0 + Math.random() * (perch.x1 - perch.x0);
      if (target !== pet.perch) {
        startHop(target, x, activity);
        return;
      }
      pet.targetX = x;
      pet.state = 'walk';
      pet.act = activity;
      return;
    }
    beginActivity(activity);
  }

  function beginActivity(activity) {
    pet.state = 'act';
    pet.act = activity;
    pet.until = clock + activity.min + Math.random() * (activity.max - activity.min);
    pet.scribbles = 0;
  }

  function startHop(perchIndex, x, activity) {
    var from = currentPerch(), to = perchList[perchIndex];
    if (!from || !to) { beginActivity(activity); return; }
    pet.hop = { fromX: pet.x, fromY: from.y, toX: x, toY: to.y, t: 0, perch: perchIndex };
    pet.state = 'hop';
    pet.act = activity;
    pet.dir = x >= pet.x ? 1 : -1;
  }

  /* ---------- reactions ---------- */

  function react(kind) {
    if (!enabled) return;
    if (kind === 'cheer') {
      pet.state = 'cheer';
      pet.until = clock + 3.2;
      burstConfetti();
      say(pick(LINES.complete));
    } else if (kind === 'startle') {
      pet.state = 'startle';
      pet.until = clock + 2.4;
      say(pick(LINES.alarm));
    } else if (kind === 'wave') {
      pet.state = 'wave';
      pet.until = clock + 2.4;
      for (var i = 0; i < 3; i++) {
        pet.hearts.push({ x: pet.x + 6 * PX + Math.random() * 6 * PX, y: pet.y - GH * PX, life: 1 + Math.random() });
      }
      say(pick(LINES.pet));
    }
  }

  function burstConfetti() {
    var palette = ['y', 'n', 'p', 'r', 'c'];
    for (var i = 0; i < 26; i++) {
      confetti.push({
        x: pet.x + GW * PX / 2,
        y: pet.y - GH * PX,
        vx: (Math.random() - 0.5) * 170,
        vy: -90 - Math.random() * 130,
        life: 1.4 + Math.random() * 0.9,
        color: COLORS[palette[Math.floor(Math.random() * palette.length)]]
      });
    }
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function say(text) {
    if (!bubble || !enabled || !text) return;
    bubble.textContent = text;
    bubble.classList.add('is-on');
    bubbleUntil = clock + 3.4;
  }

  /* ---------- the step ---------- */

  function step(dt) {
    clock += dt;

    if (clock - lastPerchScan > 0.6) { lastPerchScan = clock; scanPerches(); }
    var perch = currentPerch();
    if (!perch) return;

    if (pet.state !== 'hop') {
      pet.y = perch.y;
      if (pet.x < perch.x0) pet.x = perch.x0;
      if (pet.x > perch.x1) pet.x = perch.x1;
    }

    if (clock > pet.blinkAt) pet.blinkAt = clock + 2 + Math.random() * 4;

    switch (pet.state) {
      case 'walk':
        var delta = pet.targetX - pet.x;
        pet.dir = delta >= 0 ? 1 : -1;
        var speed = 46 * dt;
        if (Math.abs(delta) <= speed) {
          pet.x = pet.targetX;
          beginActivity(pet.act || pickActivity());
        } else {
          pet.x += pet.dir * speed;
        }
        break;

      case 'hop':
        pet.hop.t += dt / 0.75;
        var t = Math.min(1, pet.hop.t);
        pet.x = pet.hop.fromX + (pet.hop.toX - pet.hop.fromX) * t;
        pet.y = pet.hop.fromY + (pet.hop.toY - pet.hop.fromY) * t - Math.sin(t * Math.PI) * 46;
        if (t >= 1) {
          pet.perch = pet.hop.perch;
          pet.hop = null;
          beginActivity(pet.act || pickActivity());
        }
        break;

      case 'act':
        if (pet.act && pet.act.id === 'board' && Math.random() < dt * 2.2) {
          pet.scribbles = Math.min(SCRIBBLES.length, (pet.scribbles || 0) + 1);
        }
        if (clock > pet.until) planNext();
        break;

      case 'cheer': case 'startle': case 'wave':
        if (clock > pet.until) planNext();
        break;

      default:
        planNext();
    }

    // idle chatter, rarely
    if (clock - lastChatter > 70 && Math.random() < dt * 0.05) {
      lastChatter = clock;
      say(pick(LINES.idle));
    }

    for (var i = confetti.length - 1; i >= 0; i--) {
      var c = confetti[i];
      c.life -= dt;
      c.vy += 420 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.life <= 0) confetti.splice(i, 1);
    }

    for (var h = pet.hearts.length - 1; h >= 0; h--) {
      pet.hearts[h].life -= dt;
      pet.hearts[h].y -= 22 * dt;
      if (pet.hearts[h].life <= 0) pet.hearts.splice(h, 1);
    }

    if (bubbleUntil && clock > bubbleUntil) {
      bubbleUntil = 0;
      bubble.classList.remove('is-on');
    }
  }

  /* ---------- the paint ---------- */

  function currentSprite() {
    var beat = Math.floor(clock * FPS);
    var blinking = clock > pet.blinkAt - 0.16;
    var id = pet.act ? pet.act.id : 'look';

    if (pet.state === 'walk') return beat % 2 ? SPRITES.walkB : SPRITES.walkA;
    if (pet.state === 'hop') return SPRITES.sit;
    if (pet.state === 'cheer') return SPRITES.blink;
    if (pet.state === 'startle') return SPRITES.stand;
    if (pet.state === 'wave') return beat % 4 < 2 ? SPRITES.blink : SPRITES.stand;

    if (pet.state === 'act') {
      if (id === 'nap') return SPRITES.sleep;
      if (id === 'laptop' || id === 'read') return beat % 8 < 4 ? SPRITES.sit : SPRITES.sitB;
      if (id === 'mug' || id === 'swim') return SPRITES.sit;
      if (id === 'stretch') return beat % 4 < 2 ? SPRITES.stand : SPRITES.blink;
    }
    return blinking ? SPRITES.blink : SPRITES.stand;
  }

  function verticalOffset() {
    var beat = Math.floor(clock * FPS);
    if (pet.state === 'walk') return beat % 2 ? -PX : 0;
    if (pet.state === 'cheer') return -Math.abs(Math.sin(clock * 7)) * 16;
    if (pet.state === 'startle') return -Math.abs(Math.sin(clock * 11)) * 7;
    if (pet.state === 'act' && pet.act) {
      if (pet.act.id === 'swim') return Math.sin(clock * 2.6) * PX;
      if (pet.act.id === 'nap') return Math.sin(clock * 1.4) * 1.5;
      if (pet.act.id === 'stretch') return -Math.abs(Math.sin(clock * 3)) * 6;
    }
    return 0;
  }

  function paint() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!enabled) return;

    var beat = Math.floor(clock * FPS);
    var sprite = currentSprite();
    var x = Math.round(pet.x);
    var y = Math.round(pet.y + verticalOffset());
    var top = y - GH * PX;
    var flip = pet.dir < 0;
    var ink = inkColor();
    var id = pet.state === 'act' && pet.act ? pet.act.id : null;

    if (pet.state !== 'hop' && id !== 'swim') shadow(x, y, GW * PX);

    // props that sit behind the creature
    if (id === 'board') {
      var boardX = x + (flip ? -13 * PX : GW * PX + PX);
      var boardY = y - PROPS.board.length * PX;
      grid(PROPS.board, boardX, boardY, false);
      for (var s = 0; s < (pet.scribbles || 0); s++) {
        ctx.fillStyle = COLORS.k;
        ctx.fillRect(boardX + SCRIBBLES[s][0] * PX, boardY + SCRIBBLES[s][1] * PX, PX, PX);
      }
    }

    grid(sprite, x, top, flip);

    // props in front
    if (id === 'laptop') {
      var lit = beat % 6 < 3 ? PROPS.laptopLit : PROPS.laptop;
      grid(lit, beside(PROPS.laptop, flip, -1), y - PROPS.laptop.length * PX, flip);
    }
    if (id === 'read') {
      grid(PROPS.book, beside(PROPS.book, flip, -2), y - 8 * PX, flip);
    }
    if (id === 'mug') {
      grid(PROPS.mug, beside(PROPS.mug, flip, -1), y - 6 * PX, flip);
      if (beat % 4 < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(beside(PROPS.mug, flip, -1) + 2 * PX, y - 8 * PX, PX, PX);
      }
    }
    if (id === 'ball') {
      var bounce = Math.abs(Math.sin(clock * 3.4)) * 30;
      grid(PROPS.ball, beside(PROPS.ball, flip, 0), y - 6 * PX - bounce, flip);
    }
    if (id === 'swim') {
      var surface = y - 4 * PX;
      for (var w = -4; w < GW + 5; w++) {
        var wave = Math.sin(clock * 2.6 + w * 0.6) > 0 ? 0 : PX;
        ctx.fillStyle = '#a8ddf3';
        ctx.fillRect(x + w * PX, surface + wave, PX, PX);
        ctx.fillStyle = COLORS.c;
        ctx.fillRect(x + w * PX, surface + wave + PX, PX, PX * 3);
      }
    }
    if (id === 'nap') {
      for (var z = 0; z < 3; z++) {
        var phase = (clock * 0.5 + z * 0.33) % 1;
        ctx.globalAlpha = 1 - phase;
        grid(PROPS.zed, x + GW * PX - PX + phase * 14, top - 4 * PX - phase * 22, false, ink);
        ctx.globalAlpha = 1;
      }
    }
    if (pet.state === 'startle') {
      grid(PROPS.bang, x + GW * PX / 2, top - 7 * PX, false, ink);
    }
    if (pet.state === 'cheer') {
      for (var k = 0; k < 3; k++) {
        var sx = x + (k - 1) * 8 * PX + GW * PX / 2;
        grid(PROPS.spark, sx, top - 4 * PX - (k % 2) * PX, false);
      }
    }
    if (id === 'stretch' && beat % 6 < 3) {
      grid(PROPS.note, x + GW * PX, top - 3 * PX, false, ink);
    }

    for (var h = 0; h < pet.hearts.length; h++) {
      ctx.globalAlpha = Math.min(1, pet.hearts[h].life);
      grid(PROPS.heart, pet.hearts[h].x, pet.hearts[h].y, false);
      ctx.globalAlpha = 1;
    }

    for (var c = 0; c < confetti.length; c++) {
      ctx.globalAlpha = Math.min(1, confetti[c].life);
      ctx.fillStyle = confetti[c].color;
      ctx.fillRect(Math.round(confetti[c].x), Math.round(confetti[c].y), PX, PX);
      ctx.globalAlpha = 1;
    }

    // the hit area and any speech follow the creature
    hit.style.transform = 'translate(' + x + 'px,' + top + 'px)';
    if (bubbleUntil) {
      var bx = Math.min(window.innerWidth - bubble.offsetWidth - 8, Math.max(8, x - 10));
      bubble.style.transform = 'translate(' + bx + 'px,' + (top - bubble.offsetHeight - 12) + 'px)';
    }
  }

  /* ---------- loop ---------- */

  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    step(dt);
    paint();
  }

  function resize() {
    PX = window.innerWidth < 620 ? 4 : 5;
    if (hit) { hit.style.width = GW * PX + 'px'; hit.style.height = GH * PX + 'px'; }
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    scanPerches();
  }

  /* ---------- api ---------- */

  function init() {
    canvas = document.getElementById('petCanvas');
    hit = document.getElementById('petHit');
    bubble = document.getElementById('petBubble');
    if (!canvas || !hit) return;

    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hit.style.width = GW * PX + 'px';
    hit.style.height = GH * PX + 'px';
    hit.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      react('wave');
    });

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', scanPerches, { passive: true });

    var perch = currentPerch();
    if (perch) { pet.x = perch.x0 + (perch.x1 - perch.x0) * 0.35; pet.y = perch.y; }
    planNext();

    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(loop);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) lastFrame = performance.now();
    });
  }

  return {
    init: init,
    setMode: function (next) {
      if (next === mode) return;
      mode = next;
      if (mode === 'focus' && Math.random() < 0.8) {
        var laptop = ACTIVITIES[0];
        pet.act = laptop;
        pet.targetX = Math.max(currentPerch() ? currentPerch().x0 : 20,
                               Math.min(currentPerch() ? currentPerch().x1 : 200, pet.x + (Math.random() - 0.5) * 160));
        pet.state = 'walk';
      } else if (pet.state === 'act') {
        pet.until = Math.min(pet.until, clock + 1.5);
      }
    },
    event: function (kind) {
      if (kind === 'complete') react('cheer');
      else if (kind === 'alarm') react('startle');
      else if (LINES[kind]) say(pick(LINES[kind]));
    },
    setEnabled: function (on) {
      enabled = on;
      canvas.style.display = on ? '' : 'none';
      hit.style.display = on ? '' : 'none';
      if (!on) bubble.classList.remove('is-on');
    },
    isEnabled: function () { return enabled; },
    look: function () {
      return { state: pet.state, act: pet.act ? pet.act.id : null, mode: mode,
               x: Math.round(pet.x), y: Math.round(pet.y), perch: pet.perch, perches: perchList.length };
    },
    perchOn: function (index) {
      if (!perchList[index]) return false;
      startHop(index, perchList[index].x0 + (perchList[index].x1 - perchList[index].x0) * 0.5, pickActivity());
      return true;
    },
    force: function (id) {
      for (var i = 0; i < ACTIVITIES.length; i++) {
        if (ACTIVITIES[i].id === id) { beginActivity(ACTIVITIES[i]); pet.until = clock + 600; return true; }
      }
      return false;
    }
  };
})();
