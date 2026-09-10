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

  var canvas, ctx, hit, bubble;
  var pet = {
    x: 60, y: 0, dir: 1, perch: 0,
    state: 'idle', act: null, until: 0, since: 0, targetX: null,
    hop: null, blinkAt: 0, hearts: [], scribbles: 0
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

  /* min/max are seconds — he sticks with a thing for a good while */
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
    idle:       ['still here', 'you got this', 'hi again', '*pootles about*']
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
    var wander = Math.random() < (reduced ? 0 : 0.35);

    if (wander && perchList.length) {
      var toOther = perchList.length > 1 && Math.random() < 0.4;
      var target = toOther ? Math.floor(Math.random() * perchList.length) : pet.perch;
      var perch = perchList[target] || currentPerch();
      var x = perch.x0 + Math.random() * (perch.x1 - perch.x0);
      if (target !== pet.perch) { startHop(target, x, activity); return; }
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
    pet.since = clock;
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
      pet.until = clock + 2.6;
      for (var i = 0; i < 3; i++) {
        pet.hearts.push({ x: pet.x + 5 * PX + Math.random() * 6 * PX, y: pet.y - GH * PX, life: 1 + Math.random() });
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

    if (clock > pet.blinkAt) pet.blinkAt = clock + 3 + Math.random() * 5;

    switch (pet.state) {
      case 'walk':
        var delta = pet.targetX - pet.x;
        pet.dir = delta >= 0 ? 1 : -1;
        var speed = 40 * dt;
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
        if (pet.act && pet.act.id === 'board' && Math.random() < dt * 0.9) {
          pet.scribbles = Math.min(SCRIBBLES.length, pet.scribbles + 1);
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
    if (clock - lastChatter > 90 && Math.random() < dt * 0.04) {
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

  /* ---------- pose: body, legs and how he sits in the world ---------- */

  function poseFor(beat) {
    var id = pet.state === 'act' && pet.act ? pet.act.id : null;
    var elapsed = clock - pet.since;
    var pose = {
      eyes: clock > pet.blinkAt - 0.18 ? 'blink' : 'open',
      legs: LEGS.stand,
      dy: 0,
      lean: 0
    };

    switch (pet.state) {
      case 'walk':
        pose.legs = beat % 2 ? LEGS.stepA : LEGS.stepB;
        pose.dy = beat % 2 ? -PX / 2 : 0;
        return pose;
      case 'hop':
        pose.legs = LEGS.jump;
        pose.eyes = 'happy';
        return pose;
      case 'cheer':
        pose.eyes = 'happy';
        pose.legs = LEGS.jump;
        pose.dy = -Math.abs(Math.sin(clock * 6)) * 14;
        return pose;
      case 'startle':
        pose.eyes = 'open';
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
        pose.legs = LEGS.stand;
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
        pose.eyes = clock > pet.blinkAt - 0.18 ? 'blink' : 'happy';
        pose.dy = Math.sin(clock * 1.6) * 2;
        break;
      case 'stretch':
        pose.eyes = 'happy';
        pose.legs = beat % 12 < 6 ? LEGS.stepA : LEGS.stepB;
        pose.dy = -Math.abs(Math.sin(clock * 1.6)) * 7;
        break;
      case 'look':                                      // an occasional shuffle on the spot
        pose.legs = (elapsed % 5) < 0.5 ? LEGS.stepA : LEGS.stand;
        break;
    }
    return pose;
  }

  /* ---------- the paint ---------- */

  function paint() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!enabled) return;

    var beat = Math.floor(clock * FPS);
    var pose = poseFor(beat);
    var x = Math.round(pet.x);
    var y = Math.round(pet.y + pose.dy);
    var top = y - GH * PX;
    var flip = pet.dir < 0;
    var ink = inkColor();
    var id = pet.state === 'act' && pet.act ? pet.act.id : null;
    var elapsed = clock - pet.since;
    var lean = flip ? -pose.lean : pose.lean;

    if (pet.state !== 'hop' && id !== 'swim') shadow(x, y, GW * PX);

    // things that stand behind him
    if (id === 'board') {
      var boardX = flip ? x - 13 * PX : x + (GW + 1) * PX;
      var boardY = y - PROPS.board.length * PX;
      grid(PROPS.board, boardX, boardY, false);
      for (var s = 0; s < pet.scribbles; s++) {
        ctx.fillStyle = COLORS.k;
        ctx.fillRect(boardX + SCRIBBLES[s][0] * PX, boardY + SCRIBBLES[s][1] * PX, PX, PX);
      }
    }
    if (id === 'balloon') {
      var bx = flip ? x - 3 * PX : x + (GW - 2) * PX;
      grid(PROPS.balloon, bx, top - 7 * PX + Math.sin(clock * 1.6) * 3, flip);
    }

    // the creature
    grid(BODIES[pose.eyes], x + lean, top, flip);
    grid(pose.legs, x, top + 10 * PX, flip);
    grid(TAILS[beat % 8 < 4 ? 0 : 1], flip ? x + GW * PX : x - 2 * PX, top + 5 * PX, flip);

    if (id === 'music') {
      grid(PROPS.phones, x + 2 * PX + lean, top - PX, flip, ink);
      if (beat % 10 < 5) grid(PROPS.note, flip ? x - 4 * PX : x + GW * PX, top - 2 * PX, false, ink);
    }

    // things he holds or uses
    if (id === 'laptop') {
      grid(PROPS.laptop, beside(PROPS.laptop, flip, -1), y - PROPS.laptop.length * PX, flip);
    }
    if (id === 'read') {
      var page = (elapsed % 4) < 0.5 ? PROPS.bookOpen : PROPS.book;
      grid(page, beside(PROPS.book, flip, -2), y - 8 * PX, flip);
    }
    if (id === 'cards') {
      var card = (elapsed % 5) < 2.5 ? PROPS.card : PROPS.cardBack;
      grid(card, beside(PROPS.card, flip, -2), y - 8 * PX, flip);
    }
    if (id === 'mug') {
      grid(PROPS.mug, beside(PROPS.mug, flip, -1), y - 6 * PX, flip);
      if (beat % 8 < 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(beside(PROPS.mug, flip, -1) + 2 * PX, y - 8 * PX, PX, PX);
      }
    }
    if (id === 'snack') {
      var bites = elapsed % 15;
      var cookie = bites < 5 ? PROPS.cookie : bites < 10 ? PROPS.cookieBit : PROPS.cookieGone;
      grid(cookie, beside(PROPS.cookie, flip, -2), y - 7 * PX, flip);
    }
    if (id === 'ball') {
      var bounce = Math.abs(Math.sin(clock * 3.4)) * 30;
      grid(PROPS.ball, beside(PROPS.ball, flip, 0), y - 6 * PX - bounce, flip);
    }
    if (id === 'plant') {
      var potX = beside(PROPS.pot, flip, 0);
      var grown = elapsed % 18;
      var sprout = grown < 6 ? PROPS.sprout0 : grown < 12 ? PROPS.sprout1 : PROPS.sprout2;
      grid(sprout, potX, y - 7 * PX, flip);
      grid(PROPS.pot, potX, y - 3 * PX, flip);
      var pouring = (elapsed % 7) < 2.5;
      var canX = potX + (flip ? -2 : 2) * PX;
      grid(PROPS.can, canX, y - (pouring ? 11 : 10) * PX, flip);
      if (pouring && beat % 4 < 2) {
        ctx.fillStyle = COLORS.c;
        ctx.fillRect(potX + (flip ? 1 : 4) * PX, y - 9 * PX, PX, PX * 2);
      }
    }
    if (id === 'blocks') {
      var stack = 1 + Math.floor((elapsed % 24) / 6);   // builds to four, then starts again
      for (var t = 0; t < stack; t++) {
        var tint = ['y', 'n', 'c', 'p'][t % 4];
        var block = PROPS.block.map(function (row) { return row.replace(/y/g, tint); });
        grid(block, beside(PROPS.block, flip, -1), y - (t + 1) * 4 * PX, flip);
      }
    }
    if (id === 'sweep') {
      var swing = Math.sin(clock * 2.2) * 2 * PX;
      grid(PROPS.broom, beside(PROPS.broom, flip, -2) + (flip ? -swing : swing), y - PROPS.broom.length * PX, flip);
      if (beat % 6 < 3) {
        ctx.fillStyle = 'rgba(47,38,34,0.18)';
        ctx.fillRect(beside(PROPS.broom, flip, -3) + (flip ? -swing : swing), y - PX, PX, PX);
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
    if (pet.state === 'startle') grid(PROPS.bang, x + GW * PX / 2, top - 7 * PX, false, ink);
    if (pet.state === 'cheer') {
      for (var k = 0; k < 3; k++) {
        grid(PROPS.spark, x + (k - 1) * 7 * PX + GW * PX / 2, top - 4 * PX - (k % 2) * PX, false);
      }
    }
    if (id === 'stretch' && beat % 12 < 6) grid(PROPS.note, x + GW * PX, top - 3 * PX, false, ink);

    for (var hh = 0; hh < pet.hearts.length; hh++) {
      ctx.globalAlpha = Math.min(1, pet.hearts[hh].life);
      grid(PROPS.heart, pet.hearts[hh].x, pet.hearts[hh].y, false);
      ctx.globalAlpha = 1;
    }

    for (var cc = 0; cc < confetti.length; cc++) {
      ctx.globalAlpha = Math.min(1, confetti[cc].life);
      ctx.fillStyle = confetti[cc].color;
      ctx.fillRect(Math.round(confetti[cc].x), Math.round(confetti[cc].y), PX, PX);
      ctx.globalAlpha = 1;
    }

    // the hit area and any speech follow him about
    hit.style.transform = 'translate(' + x + 'px,' + top + 'px)';
    if (bubbleUntil) {
      var bubX = Math.min(window.innerWidth - bubble.offsetWidth - 8, Math.max(8, x - 10));
      bubble.style.transform = 'translate(' + bubX + 'px,' + (top - bubble.offsetHeight - 12) + 'px)';
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
        pet.act = ACTIVITIES[0];                       // settles down at the laptop
        var perch = currentPerch();
        pet.targetX = perch ? Math.max(perch.x0, Math.min(perch.x1, pet.x + (Math.random() - 0.5) * 150)) : pet.x;
        pet.state = 'walk';
      } else if (pet.state === 'act') {
        pet.until = Math.min(pet.until, clock + 4);    // finishes up, then finds something fitting
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
