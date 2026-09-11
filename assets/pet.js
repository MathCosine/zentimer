/* pip — a small pixel creature who potters about the page while you work.
   Everything here is drawn from character grids; no image files, no libraries. */
window.Pet = (function () {
  'use strict';

  var PX = 4;             // one sprite pixel, in CSS pixels (grows on roomy screens)
  var GW = 16, GH = 12;   // sprite grid
  var FPS = 12;           // chunky on purpose

  var COLORS = {
    o: '#c9714c', d: '#a4552f', l: '#e28f68', h: '#e8a086', k: '#2f2622',
    w: '#fff6ea', s: '#c3c7cf', g: '#8a8f98', b: '#78b6dd', y: '#ffc95c',
    n: '#6fc4a4', r: '#e4795a', p: '#f2a0b5', c: '#7fc4e8', m: '#a9763f',
    e: '#63b079', v: '#b58ad6'
  };

  /* ---------- the creature ---------- */

  var EYES = {
    open:  ['wkk', 'kkk'],   // a glint in the corner of each eye
    blink: ['ooo', 'kkk'],
    happy: ['oko', 'kok']    // ^ ^
  };

  function bodyGrid(eyes) {
    var e = EYES[eyes] || EYES.open;
    return [
      '.....oooooo.....',
      '...llllllllll...',
      '..llllllllllll..',
      '.oooooooooooooo.',
      'oooo' + e[0] + 'ooo' + e[0] + 'ooo',
      'oooo' + e[1] + 'ooo' + e[1] + 'ooo',
      'oooohhooooohhooo',
      'oooooooooooooooo',
      '.oooooooooooooo.',
      '..dddddddddddd..'
    ];
  }

  var BODIES = { open: bodyGrid('open'), blink: bodyGrid('blink'), happy: bodyGrid('happy') };

  /* six little legs, in the poses they take */
  var LEGS = {
    stand:  ['..dd...dd...dd..', '..kk...kk...kk..'],
    stepA:  ['.dd....dd....dd.', '.kk....kk....kk.'],
    stepB:  ['...dd...dd...dd.', '...kk...kk...kk.'],
    tapUp:  ['..dd...dd...dd..', '..kk...kk.......'],   // front foot lifted
    tapMid: ['..dd...dd...dd..', '..kk........kk..'],
    kick:   ['..dd...dd...dd..', '..kk...kk.....kk'],
    sit:    ['................', '..kkk.....kkk...'],
    tuck:   ['................', '..kk.......kk...'],
    jump:   ['..dd...dd...dd..', '.kk.....kk....kk']
  };

  var TAILS = [['d.', '.d'], ['.d', 'd.']];

  var CREST = ['..e.', '.ee.', 'e..e'];          // pop's little sprig

  var SKINS = {
    pip: { o: '#c9714c', d: '#a4552f', l: '#e28f68', h: '#e8a086' },
    pop: { o: '#5aa79a', d: '#3d7f74', l: '#7ac6b5', h: '#93d6c4' }
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
    ball: [
      '.kwwk.',
      'kwwwwk',
      'wwkkww',
      'wwkkww',
      'kwwwwk',
      '.kwwk.'
    ],
    book: [
      '..m..m..',
      '.mwmmwm.',
      'mwwmmwwm',
      'mwwmmwwm',
      'mwwmmwwm',
      '.mmmmmm.'
    ],
    bookOpen: [
      '..m..m..',
      '.mwmmwm.',
      'mwkmmwwm',
      'mwwmmwkm',
      'mwkmmwwm',
      '.mmmmmm.'
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
    cookie: [
      '.mmm.',
      'mmkmm',
      'mkmmm',
      'mmmkm',
      '.mmm.'
    ],
    cookieBit: [
      '.mm..',
      'mmkm.',
      'mkmm.',
      'mmmk.',
      '.mm..'
    ],
    cookieGone: [
      '.m...',
      'mmk..',
      'mkm..',
      'mmm..',
      '.m...'
    ],
    pot: [
      '.mmmm.',
      '.mmmm.',
      '..mm..'
    ],
    sprout0: ['......', '......', '..e...', '..e...'],
    sprout1: ['......', '..e...', '.eee..', '..e...'],
    sprout2: ['.e.e..', 'eeeee.', '.eee..', '..e...'],
    can: [
      '...ss.',
      '..ssss',
      's.ssss',
      'ssssss',
      '.ssss.'
    ],
    phones: [
      '..vvvvvvvv..',
      '.v........v.',
      'vv........vv',
      'vv........vv'
    ],
    card: [
      'ssssss',
      'swwwws',
      'swkkws',
      'swwwws',
      'swkkws',
      'ssssss'
    ],
    cardBack: [
      'ssssss',
      'swwwws',
      'swwkws',
      'swkkws',
      'swwwws',
      'ssssss'
    ],
    block: [
      'yyyy',
      'ykky',
      'ykky',
      'yyyy'
    ],
    broom: [
      '...m..',
      '...m..',
      '...m..',
      '..mm..',
      '.yyyy.',
      'yyyyyy',
      'yyyyyy',
      'y.y.yy'
    ],
    balloon: [
      '.ppp.',
      'ppppp',
      'ppppp',
      '.ppp.',
      '..p..',
      '..k..',
      '..k..',
      '..k..'
    ],
    heart: [
      '.p.p.',
      'ppppp',
      'ppppp',
      '.ppp.',
      '..p..'
    ],
    zed: ['kkk', '..k', '.k.', 'kkk'],
    spark: ['.y.', 'yyy', '.y.'],
    bang: ['k', 'k', 'k', '.', 'k'],
    note: ['..kk', '..kk', '..k.', 'kkk.', 'kkk.']
  };

  /* marks that appear on the whiteboard, one at a time */
  var SCRIBBLES = [
    [2, 2], [3, 2], [4, 2], [5, 2], [7, 2], [8, 2],
    [2, 3], [4, 3], [6, 3], [9, 3],
    [3, 4], [4, 4], [5, 4], [6, 4], [8, 4]
  ];


  /* ---------- state ---------- */

  var canvas, ctx;
  var cast = [];
  var mode = 'idle';
  var enabled = true;
  var reduced = false;
  var alarming = false;
  var confetti = [];
  var perchList = [];
  var lastPerchScan = 0;
  var lastFrame = 0;
  var clock = 0;
  var running = false;
  var lastChatter = 0;
  var meetAt = 40;

  /* min/max are seconds — they stick with a thing for a good while */
  var ACTIVITIES = [
    { id: 'laptop',  min: 50, max: 120, focus: 34, brk: 3,  idle: 9 },
    { id: 'board',   min: 35, max: 70,  focus: 13, brk: 4,  idle: 8 },
    { id: 'cards',   min: 30, max: 60,  focus: 12, brk: 4,  idle: 8 },
    { id: 'read',    min: 40, max: 80,  focus: 11, brk: 8,  idle: 9 },
    { id: 'mug',     min: 25, max: 45,  focus: 8,  brk: 9,  idle: 8 },
    { id: 'music',   min: 35, max: 70,  focus: 8,  brk: 8,  idle: 8 },
    { id: 'nap',     min: 45, max: 90,  focus: 1,  brk: 16, idle: 6 },
    { id: 'ball',    min: 30, max: 55,  focus: 2,  brk: 12, idle: 9 },
    { id: 'swim',    min: 30, max: 55,  focus: 1,  brk: 9,  idle: 6 },
    { id: 'snack',   min: 25, max: 45,  focus: 3,  brk: 9,  idle: 7 },
    { id: 'plant',   min: 30, max: 55,  focus: 2,  brk: 7,  idle: 7 },
    { id: 'blocks',  min: 30, max: 60,  focus: 1,  brk: 7,  idle: 7 },
    { id: 'sweep',   min: 25, max: 45,  focus: 1,  brk: 6,  idle: 6 },
    { id: 'balloon', min: 25, max: 45,  focus: 1,  brk: 6,  idle: 6 },
    { id: 'stretch', min: 14, max: 24,  focus: 4,  brk: 7,  idle: 6 },
    { id: 'look',    min: 12, max: 22,  focus: 4,  brk: 5,  idle: 10 }
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
    idle:       ['still here', 'you got this', 'hi again', '*pootles about*'],
    chat:       ['hi pop!', 'hi pip!', 'hehe', '*chats*', 'how goes it?']
  };

  function make(name, skin, crest) {
    return {
      name: name, skin: SKINS[skin], crest: crest,
      x: 60, y: 0, dir: 1, perch: 0,
      state: 'idle', act: null, until: 0, since: 0, targetX: null,
      hop: null, blinkAt: 0, hearts: [], scribbles: 0,
      hit: null, bubble: null, bubbleUntil: 0
    };
  }

  /* ---------- drawing ---------- */

  function grid(sprite, x, y, flip, tint, skin) {
    var w = sprite[0].length;
    for (var row = 0; row < sprite.length; row++) {
      var line = sprite[row];
      for (var col = 0; col < line.length; col++) {
        var ch = line[col];
        if (ch === '.' || ch === ' ') continue;
        var color = tint && ch === 'k' ? tint : (skin && skin[ch]) || COLORS[ch];
        if (!color) continue;
        var px = flip ? x + (w - 1 - col) * PX : x + col * PX;
        ctx.fillStyle = color;
        ctx.fillRect(px, y + row * PX, PX, PX);
      }
    }
  }

  /* a spot just past a creature's side, so props never cross his face */
  function beside(c, prop, flip, gap) {
    var width = prop[0].length;
    return flip ? Math.round(c.x) - (width + gap) * PX : Math.round(c.x) + (GW + gap) * PX;
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

    if (window.innerWidth < 620) {
      perchList = list;
      for (var n = 0; n < cast.length; n++) if (cast[n].perch >= 1) cast[n].perch = 0;
      return;
    }

    var cards = document.querySelectorAll('[data-perch]');
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width < 130 || r.top < 46 || r.top > window.innerHeight - 30) continue;
      list.push({ y: Math.round(r.top) + 3, x0: Math.round(r.left) + 6, x1: Math.round(r.right) - 6 - GW * PX });
    }
    perchList = list.filter(function (p) { return p.x1 > p.x0 + 10; });
    for (var m = 0; m < cast.length; m++) if (cast[m].perch >= perchList.length) cast[m].perch = 0;
  }

  function perchOf(c) { return perchList[c.perch] || perchList[0]; }

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

  /* keep a little distance from the other one */
  function clearOf(c, x) {
    for (var i = 0; i < cast.length; i++) {
      var other = cast[i];
      if (other === c || other.perch !== c.perch) continue;
      if (Math.abs(other.x - x) < GW * PX + 20) {
        return other.x > x ? x - (GW * PX + 30) : x + (GW * PX + 30);
      }
    }
    return x;
  }

  function planNext(c) {
    var activity = pickActivity();
    var wander = Math.random() < (reduced ? 0 : 0.35);

    if (wander && perchList.length) {
      var toOther = perchList.length > 1 && Math.random() < 0.4;
      var target = toOther ? Math.floor(Math.random() * perchList.length) : c.perch;
      var perch = perchList[target] || perchOf(c);
      var x = perch.x0 + Math.random() * (perch.x1 - perch.x0);
      if (target !== c.perch) { startHop(c, target, x, activity); return; }
      c.targetX = clamp(clearOf(c, x), perch.x0, perch.x1);
      c.state = 'walk';
      c.act = activity;
      return;
    }
    beginActivity(c, activity);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function beginActivity(c, activity) {
    c.state = 'act';
    c.act = activity;
    c.since = clock;
    c.until = clock + activity.min + Math.random() * (activity.max - activity.min);
    c.scribbles = 0;
  }

  function startHop(c, perchIndex, x, activity) {
    var from = perchOf(c), to = perchList[perchIndex];
    if (!from || !to) { beginActivity(c, activity); return; }
    c.hop = { fromX: c.x, fromY: from.y, toX: x, toY: to.y, t: 0, perch: perchIndex };
    c.state = 'hop';
    c.act = activity;
    c.dir = x >= c.x ? 1 : -1;
  }

  /* ---------- reactions ---------- */

  function react(c, kind) {
    if (!enabled) return;
    if (kind === 'cheer') {
      c.state = 'cheer';
      c.until = clock + 3.2;
      burstConfetti(c);
      say(c, pick(LINES.complete));
    } else if (kind === 'startle') {
      c.state = 'startle';
      c.until = clock + 2.4;
      say(c, pick(LINES.alarm));
    } else if (kind === 'wave') {
      c.state = 'wave';
      c.until = clock + 2.6;
      for (var i = 0; i < 3; i++) {
        c.hearts.push({ x: c.x + 5 * PX + Math.random() * 6 * PX, y: c.y - GH * PX, life: 1 + Math.random() });
      }
      say(c, pick(LINES.pet));
    }
  }

  function burstConfetti(c) {
    var palette = ['y', 'n', 'p', 'r', 'c'];
    for (var i = 0; i < 22; i++) {
      confetti.push({
        x: c.x + GW * PX / 2,
        y: c.y - GH * PX,
        vx: (Math.random() - 0.5) * 170,
        vy: -90 - Math.random() * 130,
        life: 1.4 + Math.random() * 0.9,
        color: COLORS[palette[Math.floor(Math.random() * palette.length)]]
      });
    }
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function say(c, text) {
    if (!c.bubble || !enabled || !text) return;
    c.bubble.textContent = text;
    c.bubble.classList.add('is-on');
    c.bubbleUntil = clock + 3.4;
  }

  /* the two of them wander over for a natter now and then */
  function meetUp() {
    if (cast.length < 2 || alarming) return;
    var a = cast[0], b = cast[1];
    if (a.state !== 'act' || b.state !== 'act') return;
    var perch = perchList[a.perch];
    if (!perch) return;
    var middle = clamp((a.x + b.x) / 2, perch.x0 + GW * PX, perch.x1 - GW * PX);
    b.perch = a.perch;
    a.targetX = middle - GW * PX * 0.75;
    b.targetX = middle + GW * PX * 0.75;
    a.state = b.state = 'walk';
    a.act = b.act = { id: 'chat', min: 9, max: 15 };
  }

  /* ---------- the step ---------- */

  function stepOne(c, dt) {
    var perch = perchOf(c);
    if (!perch) return;

    if (c.state !== 'hop') {
      c.y = perch.y;
      c.x = clamp(c.x, perch.x0, perch.x1);
    }

    if (clock > c.blinkAt) c.blinkAt = clock + 3 + Math.random() * 5;

    switch (c.state) {
      case 'walk':
        var delta = c.targetX - c.x;
        c.dir = delta >= 0 ? 1 : -1;
        var speed = (alarming ? 95 : 40) * dt;
        if (Math.abs(delta) <= speed) {
          c.x = c.targetX;
          if (alarming) { c.state = 'alarming'; c.since = clock; }
          else beginActivity(c, c.act || pickActivity());
        } else {
          c.x += c.dir * speed;
        }
        break;

      case 'hop':
        c.hop.t += dt / 0.75;
        var t = Math.min(1, c.hop.t);
        c.x = c.hop.fromX + (c.hop.toX - c.hop.fromX) * t;
        c.y = c.hop.fromY + (c.hop.toY - c.hop.fromY) * t - Math.sin(t * Math.PI) * 46;
        if (t >= 1) {
          c.perch = c.hop.perch;
          c.hop = null;
          beginActivity(c, c.act || pickActivity());
        }
        break;

      case 'act':
        if (c.act && c.act.id === 'board' && Math.random() < dt * 0.9) {
          c.scribbles = Math.min(SCRIBBLES.length, c.scribbles + 1);
        }
        if (c.act && c.act.id === 'chat') {
          c.dir = (cast[0] === c ? 1 : -1);
          if (Math.random() < dt * 0.12) say(c, pick(LINES.chat));
        }
        if (clock > c.until) planNext(c);
        break;

      case 'alarming':
        break;

      case 'cheer': case 'startle': case 'wave':
        if (clock > c.until) planNext(c);
        break;

      default:
        planNext(c);
    }

    if (c.bubbleUntil && clock > c.bubbleUntil) {
      c.bubbleUntil = 0;
      c.bubble.classList.remove('is-on');
    }
  }

  function step(dt) {
    clock += dt;

    if (clock - lastPerchScan > 0.6) { lastPerchScan = clock; scanPerches(); }

    for (var i = 0; i < cast.length; i++) stepOne(cast[i], dt);

    if (!alarming && clock > meetAt) {
      meetAt = clock + 90 + Math.random() * 120;
      if (Math.random() < 0.6) meetUp();
    }

    if (clock - lastChatter > 90 && Math.random() < dt * 0.04) {
      lastChatter = clock;
      say(cast[Math.floor(Math.random() * cast.length)], pick(LINES.idle));
    }

    for (var f = confetti.length - 1; f >= 0; f--) {
      var particle = confetti[f];
      particle.life -= dt;
      particle.vy += 420 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.life <= 0) confetti.splice(f, 1);
    }

    for (var n = 0; n < cast.length; n++) {
      var hearts = cast[n].hearts;
      for (var h = hearts.length - 1; h >= 0; h--) {
        hearts[h].life -= dt;
        hearts[h].y -= 22 * dt;
        if (hearts[h].life <= 0) hearts.splice(h, 1);
      }
    }
  }

  /* ---------- pose: body, legs and how he sits in the world ---------- */

  function poseFor(c, beat) {
    var id = c.state === 'act' && c.act ? c.act.id : null;
    var elapsed = clock - c.since;
    var pose = {
      eyes: clock > c.blinkAt - 0.18 ? 'blink' : 'open',
      legs: LEGS.stand,
      dy: 0,
      lean: 0
    };

    switch (c.state) {
      case 'walk':
        pose.legs = beat % 2 ? LEGS.stepA : LEGS.stepB;
        pose.dy = beat % 2 ? -PX / 2 : 0;
        return pose;
      case 'hop':
        pose.legs = LEGS.jump;
        pose.eyes = 'happy';
        return pose;
      case 'alarming':                                  // hopping on the spot, eyes wide
        pose.eyes = 'open';
        pose.legs = LEGS.jump;
        pose.dy = -Math.abs(Math.sin(clock * 7)) * 20;
        return pose;
      case 'cheer':
        pose.eyes = 'happy';
        pose.legs = LEGS.jump;
        pose.dy = -Math.abs(Math.sin(clock * 6)) * 14;
        return pose;
      case 'startle':
        pose.legs = beat % 2 ? LEGS.stepA : LEGS.stepB;
        pose.dy = -Math.abs(Math.sin(clock * 10)) * 6;
        return pose;
      case 'wave':
        pose.eyes = 'happy';
        pose.legs = beat % 6 < 3 ? LEGS.tapUp : LEGS.stand;
        return pose;
    }

    switch (id) {
      case 'laptop':                                    // tap tap tap
        pose.legs = beat % 6 < 3 ? LEGS.tapUp : LEGS.stand;
        break;
      case 'board':                                     // a slow arm, drawing
        pose.legs = beat % 16 < 8 ? LEGS.tapUp : LEGS.stand;
        break;
      case 'cards':
        pose.legs = LEGS.sit;
        break;
      case 'read':
        pose.legs = LEGS.sit;
        pose.dy = Math.sin(elapsed * 0.9) * 1;
        break;
      case 'mug':                                       // leans in for a sip now and then
        pose.lean = (elapsed % 6) < 1.2 ? PX : 0;
        break;
      case 'music':                                     // head bob
        pose.legs = beat % 12 < 6 ? LEGS.tapMid : LEGS.stand;
        pose.dy = Math.sin(clock * 3.4) * 2;
        break;
      case 'nap':
        pose.eyes = 'blink';
        pose.legs = LEGS.tuck;
        pose.dy = Math.sin(clock * 1.3) * 1.6;
        break;
      case 'ball':                                      // boots it on the way down
        pose.legs = Math.abs(Math.sin(clock * 3.4)) < 0.25 ? LEGS.kick : LEGS.stand;
        break;
      case 'swim':
        pose.legs = beat % 4 < 2 ? LEGS.stepA : LEGS.stepB;
        pose.dy = Math.sin(clock * 2.4) * PX * 0.6;
        break;
      case 'snack':
        pose.legs = LEGS.sit;
        pose.lean = (elapsed % 5) < 0.8 ? PX : 0;
        break;
      case 'plant':                                     // tips the can, waits, tips again
        pose.legs = (elapsed % 7) < 2.5 ? LEGS.tapUp : LEGS.stand;
        break;
      case 'blocks':
        pose.legs = (elapsed % 6) < 1.4 ? LEGS.tapUp : LEGS.stand;
        break;
      case 'sweep':                                     // shuffles along with the broom
        pose.legs = beat % 8 < 4 ? LEGS.stepA : LEGS.stepB;
        pose.dy = beat % 8 < 4 ? -PX / 2 : 0;
        break;
      case 'balloon':
        pose.eyes = clock > c.blinkAt - 0.18 ? 'blink' : 'happy';
        pose.dy = Math.sin(clock * 1.6) * 2;
        break;
      case 'stretch':
        pose.eyes = 'happy';
        pose.legs = beat % 12 < 6 ? LEGS.stepA : LEGS.stepB;
        pose.dy = -Math.abs(Math.sin(clock * 1.6)) * 7;
        break;
      case 'chat':                                      // nattering away
        pose.eyes = (beat % 24 < 12) ? 'happy' : pose.eyes;
        pose.legs = beat % 10 < 5 ? LEGS.tapMid : LEGS.stand;
        pose.dy = Math.sin(clock * 2.2) * 1.5;
        break;
      case 'look':                                      // an occasional shuffle on the spot
        pose.legs = (elapsed % 5) < 0.5 ? LEGS.stepA : LEGS.stand;
        break;
    }
    return pose;
  }

  /* ---------- the paint ---------- */

  function paintOne(c) {
    var beat = Math.floor(clock * FPS);
    var pose = poseFor(c, beat);
    var x = Math.round(c.x);
    var y = Math.round(c.y + pose.dy);
    var top = y - GH * PX;
    var flip = c.dir < 0;
    var ink = inkColor();
    var id = c.state === 'act' && c.act ? c.act.id : null;
    var elapsed = clock - c.since;
    var lean = flip ? -pose.lean : pose.lean;
    var skin = c.skin;

    if (c.state !== 'hop' && c.state !== 'alarming' && id !== 'swim') shadow(x, y, GW * PX);

    // things that stand behind him
    if (id === 'board') {
      var boardX = flip ? x - 13 * PX : x + (GW + 1) * PX;
      var boardY = y - PROPS.board.length * PX;
      grid(PROPS.board, boardX, boardY, false);
      for (var s = 0; s < c.scribbles; s++) {
        ctx.fillStyle = COLORS.k;
        ctx.fillRect(boardX + SCRIBBLES[s][0] * PX, boardY + SCRIBBLES[s][1] * PX, PX, PX);
      }
    }
    if (id === 'balloon') {
      var bx = flip ? x - 3 * PX : x + (GW - 2) * PX;
      grid(PROPS.balloon, bx, top - 7 * PX + Math.sin(clock * 1.6) * 3, flip);
    }

    // the creature
    grid(BODIES[pose.eyes], x + lean, top, flip, null, skin);
    grid(pose.legs, x, top + 10 * PX, flip, null, skin);
    grid(TAILS[beat % 8 < 4 ? 0 : 1], flip ? x + GW * PX : x - 2 * PX, top + 5 * PX, flip, null, skin);
    if (c.crest) grid(CREST, x + 6 * PX + lean, top - 2 * PX, flip);

    if (id === 'music') {
      grid(PROPS.phones, x + 2 * PX + lean, top - PX, flip, ink);
      if (beat % 10 < 5) grid(PROPS.note, flip ? x - 4 * PX : x + GW * PX, top - 2 * PX, false, ink);
    }

    // things he holds or uses
    if (id === 'laptop') {
      grid(PROPS.laptop, beside(c, PROPS.laptop, flip, -1), y - PROPS.laptop.length * PX, flip);
    }
    if (id === 'read') {
      grid((elapsed % 4) < 0.5 ? PROPS.bookOpen : PROPS.book, beside(c, PROPS.book, flip, -2), y - 8 * PX, flip);
    }
    if (id === 'cards') {
      grid((elapsed % 5) < 2.5 ? PROPS.card : PROPS.cardBack, beside(c, PROPS.card, flip, -2), y - 8 * PX, flip);
    }
    if (id === 'mug') {
      grid(PROPS.mug, beside(c, PROPS.mug, flip, -1), y - 6 * PX, flip);
      if (beat % 8 < 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(beside(c, PROPS.mug, flip, -1) + 2 * PX, y - 8 * PX, PX, PX);
      }
    }
    if (id === 'snack') {
      var bites = elapsed % 15;
      grid(bites < 5 ? PROPS.cookie : bites < 10 ? PROPS.cookieBit : PROPS.cookieGone,
           beside(c, PROPS.cookie, flip, -2), y - 7 * PX, flip);
    }
    if (id === 'ball') {
      grid(PROPS.ball, beside(c, PROPS.ball, flip, 0), y - 6 * PX - Math.abs(Math.sin(clock * 3.4)) * 30, flip);
    }
    if (id === 'plant') {
      var potX = beside(c, PROPS.pot, flip, 0);
      var grown = elapsed % 18;
      grid(grown < 6 ? PROPS.sprout0 : grown < 12 ? PROPS.sprout1 : PROPS.sprout2, potX, y - 7 * PX, flip);
      grid(PROPS.pot, potX, y - 3 * PX, flip);
      var pouring = (elapsed % 7) < 2.5;
      grid(PROPS.can, potX + (flip ? -2 : 2) * PX, y - (pouring ? 11 : 10) * PX, flip);
      if (pouring && beat % 4 < 2) {
        ctx.fillStyle = COLORS.c;
        ctx.fillRect(potX + (flip ? 1 : 4) * PX, y - 9 * PX, PX, PX * 2);
      }
    }
    if (id === 'blocks') {
      var stack = 1 + Math.floor((elapsed % 24) / 6);   // builds to four, then starts again
      for (var t = 0; t < stack; t++) {
        var tint = ['y', 'n', 'c', 'p'][t % 4];
        grid(PROPS.block.map(function (row) { return row.replace(/y/g, tint); }),
             beside(c, PROPS.block, flip, -1), y - (t + 1) * 4 * PX, flip);
      }
    }
    if (id === 'sweep') {
      var swing = Math.sin(clock * 2.2) * 2 * PX;
      grid(PROPS.broom, beside(c, PROPS.broom, flip, -2) + (flip ? -swing : swing), y - PROPS.broom.length * PX, flip);
      if (beat % 6 < 3) {
        ctx.fillStyle = 'rgba(47,38,34,0.18)';
        ctx.fillRect(beside(c, PROPS.broom, flip, -3) + (flip ? -swing : swing), y - PX, PX, PX);
      }
    }
    if (id === 'swim') {
      var surface = y - 5 * PX;
      for (var w = -4; w < GW + 5; w++) {
        var wave = Math.sin(clock * 2.6 + w * 0.6) > 0 ? 0 : PX;
        ctx.fillStyle = '#a8ddf3';
        ctx.fillRect(x + w * PX, surface + wave, PX, PX);
        ctx.fillStyle = COLORS.c;
        ctx.fillRect(x + w * PX, surface + wave + PX, PX, PX * 4);
      }
    }
    if (id === 'nap') {
      for (var z = 0; z < 3; z++) {
        var phase = (clock * 0.35 + z * 0.33) % 1;
        ctx.globalAlpha = 1 - phase;
        grid(PROPS.zed, x + GW * PX - PX + phase * 14, top - 3 * PX - phase * 22, false, ink);
        ctx.globalAlpha = 1;
      }
    }
    if (c.state === 'startle' || c.state === 'alarming') {
      grid(PROPS.bang, x + GW * PX / 2, top - 7 * PX, false, COLORS.r);
      if (c.state === 'alarming') grid(PROPS.bang, x + GW * PX / 2 - 4 * PX, top - 6 * PX, false, COLORS.r);
    }
    if (c.state === 'cheer') {
      for (var k = 0; k < 3; k++) {
        grid(PROPS.spark, x + (k - 1) * 7 * PX + GW * PX / 2, top - 4 * PX - (k % 2) * PX, false);
      }
    }
    if (id === 'stretch' && beat % 12 < 6) grid(PROPS.note, x + GW * PX, top - 3 * PX, false, ink);
    if (id === 'chat' && beat % 20 < 4) grid(PROPS.heart, x + GW * PX / 2, top - 4 * PX, false);

    for (var hh = 0; hh < c.hearts.length; hh++) {
      ctx.globalAlpha = Math.min(1, c.hearts[hh].life);
      grid(PROPS.heart, c.hearts[hh].x, c.hearts[hh].y, false);
      ctx.globalAlpha = 1;
    }

    // the hit area and any speech follow him about
    c.hit.style.transform = 'translate(' + x + 'px,' + top + 'px)';
    if (c.bubbleUntil) {
      var bubX = Math.min(window.innerWidth - c.bubble.offsetWidth - 8, Math.max(8, x - 10));
      c.bubble.style.transform = 'translate(' + bubX + 'px,' + (top - c.bubble.offsetHeight - 12) + 'px)';
    }
  }

  function paint() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!enabled) return;

    for (var i = 0; i < cast.length; i++) paintOne(cast[i]);

    for (var cc = 0; cc < confetti.length; cc++) {
      ctx.globalAlpha = Math.min(1, confetti[cc].life);
      ctx.fillStyle = confetti[cc].color;
      ctx.fillRect(Math.round(confetti[cc].x), Math.round(confetti[cc].y), PX, PX);
      ctx.globalAlpha = 1;
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
    for (var i = 0; i < cast.length; i++) {
      if (!cast[i].hit) continue;
      cast[i].hit.style.width = GW * PX + 'px';
      cast[i].hit.style.height = GH * PX + 'px';
    }
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

  function attach(c) {
    var hit = document.createElement('div');
    hit.className = 'pet-hit';
    hit.setAttribute('aria-hidden', 'true');
    hit.title = 'say hi to ' + c.name;
    hit.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      react(c, 'wave');
    });
    document.body.appendChild(hit);

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    document.body.appendChild(bubble);

    c.hit = hit;
    c.bubble = bubble;
  }

  function init() {
    canvas = document.getElementById('petCanvas');
    if (!canvas) return;

    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    cast = [make('pip', 'pip', false), make('pop', 'pop', true)];
    cast.forEach(attach);

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', scanPerches, { passive: true });

    var perch = perchList[0];
    if (perch) {
      cast[0].x = perch.x0 + (perch.x1 - perch.x0) * 0.3;
      cast[1].x = perch.x0 + (perch.x1 - perch.x0) * 0.62;
      cast[0].y = cast[1].y = perch.y;
    }
    cast.forEach(function (c) { planNext(c); });

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
      if (alarming) return;
      cast.forEach(function (c) {
        if (mode === 'focus' && Math.random() < 0.75) {
          c.act = ACTIVITIES[0];                       // settles down at the laptop
          var perch = perchOf(c);
          c.targetX = perch ? clamp(c.x + (Math.random() - 0.5) * 150, perch.x0, perch.x1) : c.x;
          c.state = 'walk';
        } else if (c.state === 'act') {
          c.until = Math.min(c.until, clock + 4);      // finishes up, then finds something fitting
        }
      });
    },

    event: function (kind) {
      if (kind === 'complete') cast.forEach(function (c) { react(c, 'cheer'); });
      else if (kind === 'alarm') cast.forEach(function (c) { react(c, 'startle'); });
      else if (LINES[kind]) say(cast[Math.floor(Math.random() * cast.length)], pick(LINES[kind]));
    },

    /* an alarm brings them both hurrying to the middle to jump about */
    alarm: function (on) {
      alarming = !!on;
      if (!enabled) return;
      if (alarming) {
        var floor = perchList[0];
        if (!floor) return;
        var middle = (floor.x0 + floor.x1) / 2;
        cast.forEach(function (c, i) {
          c.perch = 0;
          c.y = floor.y;
          c.targetX = clamp(middle + (i ? 1 : -1) * (GW * PX * 0.8), floor.x0, floor.x1);
          c.state = 'walk';
          c.dir = c.targetX >= c.x ? 1 : -1;
          c.hop = null;
          say(c, pick(LINES.alarm));
        });
      } else {
        cast.forEach(function (c) { planNext(c); });
      }
    },

    setEnabled: function (on) {
      enabled = on;
      canvas.style.display = on ? '' : 'none';
      cast.forEach(function (c) {
        c.hit.style.display = on ? '' : 'none';
        if (!on) c.bubble.classList.remove('is-on');
      });
    },

    isEnabled: function () { return enabled; },

    look: function () {
      var c = cast[0] || {};
      return { state: c.state, act: c.act ? c.act.id : null, mode: mode,
               x: Math.round(c.x), y: Math.round(c.y), perch: c.perch, perches: perchList.length };
    },

    lookAll: function () {
      return cast.map(function (c) {
        return { name: c.name, state: c.state, act: c.act ? c.act.id : null,
                 x: Math.round(c.x), y: Math.round(c.y), perch: c.perch };
      });
    },

    perchOn: function (index, who) {
      var c = cast[who || 0];
      if (!perchList[index] || !c) return false;
      startHop(c, index, perchList[index].x0 + (perchList[index].x1 - perchList[index].x0) * 0.5, pickActivity());
      return true;
    },

    force: function (id, who) {
      var c = cast[who || 0];
      for (var i = 0; i < ACTIVITIES.length; i++) {
        if (ACTIVITIES[i].id === id) { beginActivity(c, ACTIVITIES[i]); c.until = clock + 600; return true; }
      }
      return false;
    }
  };
})();
