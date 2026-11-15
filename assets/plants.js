/* The plants a study session grows, and the trees a week of them becomes.

   Drawn, not pictured: each is built from its kind, a seed (so the same
   session always grows the same plant -- the lean of a frond, the colour of a
   tulip) and how far it has grown, from 0 (a seed in the soil) to 1 (fully
   grown). Growth is continuous, so every minute of a session shows: a sprout,
   then leaves one after another, then buds, then flowers.

   Plants.svg({ kind, seed, g })      a potted plant, as SVG markup
   Plants.tree({ kind, seed, g })     a tree on a little patch of ground
   Plants.growthFor(minutes)          how far a session of that length gets
   Plants.pick(seed) / pickTree(seed) a kind, the same one every time
   Plants.name(kind)                  what to call it                         */
window.Plants = (function () {
  'use strict';

  /* Four kinds of rare. Every session starts as something common; the longer
     it runs, the more chances it has to turn into something rarer. */
  var TIERS = ['common', 'uncommon', 'rare', 'legendary'];
  var POOL = {
    common: ['fern', 'snake', 'pothos', 'succulent', 'cactus', 'daisy', 'lavender'],
    uncommon: ['tulip', 'sunflower', 'monstera', 'aloe', 'bamboo', 'strawberry'],
    rare: ['orchid', 'bonsai', 'lily'],
    legendary: ['moonflower', 'lotus', 'goldfern']
  };
  var TREE_POOL = { common: ['oak', 'pine', 'birch', 'maple'], rare: ['cherry', 'willow'], legendary: ['ginkgo'] };
  var KINDS = POOL.common.concat(POOL.uncommon, POOL.rare, POOL.legendary);
  var TREES = TREE_POOL.common.concat(TREE_POOL.rare, TREE_POOL.legendary);
  var OLD_TREES = ['oak', 'pine', 'cherry', 'birch', 'maple'];   // before rarities: what a tree was picked from
  var NAMES = {
    fern: 'fern', monstera: 'monstera', tulip: 'tulip', sunflower: 'sunflower', lavender: 'lavender',
    succulent: 'succulent', cactus: 'cactus', snake: 'snake plant', daisy: 'daisy', pothos: 'pothos',
    aloe: 'aloe', bamboo: 'lucky bamboo', strawberry: 'strawberry', orchid: 'orchid', bonsai: 'bonsai',
    lily: 'peace lily', moonflower: 'moonflower', lotus: 'lotus', goldfern: 'golden fern',
    oak: 'oak', pine: 'pine', cherry: 'cherry tree', birch: 'birch', maple: 'maple', willow: 'willow', ginkgo: 'golden ginkgo'
  };

  /* ---------- the little bits of maths ---------- */

  function hash(text) {
    var h = 1779033703 ^ String(text).length;
    for (var i = 0; i < String(text).length; i++) {
      h = Math.imul(h ^ String(text).charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  // the same numbers for the same seed, every time
  function random(seed) {
    var a = hash(seed);
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // how far one part has got, as the whole plant goes from a to b
  function ramp(g, a, b) { return clamp((g - a) / (b - a), 0, 1); }
  function ease(t) { return 1 - (1 - t) * (1 - t); }
  function f(n) { return (Math.round(n * 10) / 10).toString(); }
  function between(r, a, b) { return a + (b - a) * r(); }
  function pickFrom(r, list) { return list[Math.floor(r() * list.length) % list.length]; }

  // a point, and the way it is heading, along a gentle curve
  function along(p0, p1, p2, t) {
    var u = 1 - t;
    return {
      x: u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      y: u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      // degrees, 0 = straight up, clockwise positive (as SVG rotates)
      a: Math.atan2(2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
                    -(2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]))) * 180 / Math.PI
    };
  }

  function curve(p0, p1, p2, stroke, width, cap) {
    return '<path d="M' + f(p0[0]) + ' ' + f(p0[1]) + 'Q' + f(p1[0]) + ' ' + f(p1[1]) + ' ' + f(p2[0]) + ' ' + f(p2[1]) +
      '" fill="none" stroke="' + stroke + '" stroke-width="' + f(width) + '" stroke-linecap="' + (cap || 'round') + '"/>';
  }

  /* A leaf, pointing up from its stalk, then turned and moved into place.
     Veins once it is big enough to have them. */
  function leaf(x, y, len, wid, ang, fill, vein, round) {
    if (len < 0.6) return '';
    var w = wid / 2, b = round ? 0.42 : 0.25;
    var d = 'M0 0C' + f(w) + ' ' + f(-len * b) + ' ' + f(w * 0.85) + ' ' + f(-len * 0.78) + ' 0 ' + f(-len) +
      'C' + f(-w * 0.85) + ' ' + f(-len * 0.78) + ' ' + f(-w) + ' ' + f(-len * b) + ' 0 0Z';
    var out = '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(ang) + ')"><path d="' + d + '" fill="' + fill + '"/>';
    if (vein && len > 5) {
      out += '<path d="M0 ' + f(-len * 0.04) + 'Q' + f(w * 0.06) + ' ' + f(-len * 0.5) + ' 0 ' + f(-len * 0.9) +
        '" fill="none" stroke="' + vein + '" stroke-width="' + f(clamp(wid * 0.05, 0.3, 0.9)) + '" stroke-linecap="round"/>';
      if (len > 14) {
        for (var k = 1; k <= 3; k++) {
          var at = -len * (0.18 + k * 0.17), reach = w * (0.75 - k * 0.12);
          out += '<path d="M0 ' + f(at) + 'Q' + f(reach * 0.5) + ' ' + f(at - len * 0.05) + ' ' + f(reach) + ' ' + f(at - len * 0.11) +
            'M0 ' + f(at) + 'Q' + f(-reach * 0.5) + ' ' + f(at - len * 0.05) + ' ' + f(-reach) + ' ' + f(at - len * 0.11) +
            '" fill="none" stroke="' + vein + '" stroke-width="' + f(clamp(wid * 0.03, 0.25, 0.6)) + '" stroke-linecap="round" opacity="0.8"/>';
        }
      }
    }
    return out + '</g>';
  }

  function heart(x, y, size, ang, fill, vein) {
    if (size < 0.6) return '';
    var s = size;
    var d = 'M0 0C' + f(s * 0.12) + ' ' + f(-s * 0.05) + ' ' + f(s * 0.62) + ' ' + f(-s * 0.08) + ' ' + f(s * 0.55) + ' ' + f(-s * 0.55) +
      'C' + f(s * 0.48) + ' ' + f(-s * 0.85) + ' ' + f(s * 0.15) + ' ' + f(-s * 0.98) + ' 0 ' + f(-s * 1.12) +
      'C' + f(-s * 0.15) + ' ' + f(-s * 0.98) + ' ' + f(-s * 0.48) + ' ' + f(-s * 0.85) + ' ' + f(-s * 0.55) + ' ' + f(-s * 0.55) +
      'C' + f(-s * 0.62) + ' ' + f(-s * 0.08) + ' ' + f(-s * 0.12) + ' ' + f(-s * 0.05) + ' 0 0Z';
    var out = '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(ang) + ')"><path d="' + d + '" fill="' + fill + '"/>';
    if (vein && s > 4) {
      out += '<path d="M0 ' + f(-s * 0.08) + 'L0 ' + f(-s * 1.0) + '" stroke="' + vein + '" stroke-width="' + f(clamp(s * 0.05, 0.3, 0.8)) + '" stroke-linecap="round"/>';
    }
    return out + '</g>';
  }

  /* ---------- colours ---------- */

  // the greens, and gradients built from them, are made once per drawing
  function palette(id, extra) {
    var defs = '' +
      grad(id + 'l', [[0, '#3f8a57'], [1, '#79bf86']]) +          // a leaf, darker where it starts
      grad(id + 'k', [[0, '#2f6e45'], [1, '#5ea56f']]) +          // a deeper one, for the back
      grad(id + 'm', [[0, '#7fc58c'], [1, '#bfe3c1']]) +          // a young, pale one
      (extra || '');
    return defs;
  }

  function grad(id, stops, horizontal) {
    return '<linearGradient id="' + id + '" x1="0" y1="' + (horizontal ? 0 : 1) + '" x2="' + (horizontal ? 1 : 0) + '" y2="0">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') +
      '</linearGradient>';
  }

  function radial(id, stops) {
    return '<radialGradient id="' + id + '" cx="0.4" cy="0.35" r="0.75">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>'; }).join('') + '</radialGradient>';
  }

  var POTS = [
    { name: 'clay',   body: ['#e3a17b', '#c9774f'], rim: '#d98a62', line: '#b8694a' },
    { name: 'white',  body: ['#ffffff', '#e4e2db'], rim: '#f4f2ec', line: '#d6d3ca' },
    { name: 'sage',   body: ['#c3d8c6', '#93b39a'], rim: '#b2cbb6', line: '#86a68d' },
    { name: 'stone',  body: ['#e2e3df', '#b9bdb7'], rim: '#d3d5d0', line: '#a9aea7' },
    { name: 'blush',  body: ['#f4d9d1', '#dcb0a5'], rim: '#ebc7bd', line: '#cf9f94' },
    { name: 'sky',    body: ['#d7e7f2', '#a9c6db'], rim: '#c5dbe9', line: '#98b8ce' }
  ];

  // some plants come in their own pot
  var SPECIAL = {
    moonflower: { name: 'night', body: ['#3b4a78', '#22305a'], rim: '#2c3a66', line: '#d9b85c' },
    goldfern: { name: 'gilt', body: ['#ffffff', '#ece6d6'], rim: '#e7c96a', line: '#c9a845' }
  };

  /* ---------- the pot ---------- */

  // a wide, shallow tray, for a bonsai
  function tray(id, style) {
    return '<ellipse cx="60" cy="141" rx="40" ry="2.6" fill="#1f3a26" opacity="0.1"/>' +
      '<path d="M24 124L28 137.5Q28.6 139.6 31 139.6L89 139.6Q91.4 139.6 92 137.5L96 124Z" fill="url(#' + id + 'p)"/>' +
      '<rect x="21" y="116.5" width="78" height="8.5" rx="2.6" fill="' + style.rim + '"/>' +
      '<rect x="23" y="117.3" width="26" height="1.8" rx="0.9" fill="#ffffff" opacity="0.4"/>' +
      '<path d="M32 139.6v2.4M88 139.6v2.4" stroke="' + style.line + '" stroke-width="2.4" stroke-linecap="round"/>';
  }

  // a round bowl of still water, for a lotus
  function bowl(id) {
    return '<ellipse cx="60" cy="152" rx="34" ry="3" fill="#1f3a26" opacity="0.1"/>' +
      '<path d="M22 118C22 138 38 151 60 151C82 151 98 138 98 118Z" fill="url(#' + id + 'p)"/>' +
      '<ellipse cx="60" cy="118" rx="38" ry="5" fill="#f4f1ea"/>' +
      '<ellipse cx="60" cy="118.6" rx="35" ry="3.8" fill="url(#' + id + 'wa)"/>' +
      '<path d="M40 118.4q6 -1 12 0M68 119q6 -1 10 0" stroke="#ffffff" stroke-width="0.7" opacity="0.6" fill="none"/>';
  }

  function pot(id, style) {
    return '<ellipse cx="60" cy="156.5" rx="31" ry="3" fill="#1f3a26" opacity="0.1"/>' +
      '<path d="M34 125L38.6 151.5Q39.3 155.2 43 155.2L77 155.2Q80.7 155.2 81.4 151.5L86 125Z" fill="url(#' + id + 'p)"/>' +
      '<path d="M40 131L43.4 150" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity="0.35"/>' +
      '<rect x="30.5" y="116.5" width="59" height="10" rx="3.4" fill="' + style.rim + '"/>' +
      '<path d="M33 126.6L87 126.6" stroke="' + style.line + '" stroke-width="1" opacity="0.6"/>' +
      '<rect x="32" y="117.4" width="22" height="2.2" rx="1.1" fill="#ffffff" opacity="0.45"/>';
  }

  function soil() {
    return '<ellipse cx="60" cy="118.2" rx="26.5" ry="2.7" fill="#6e5039"/>' +
      '<ellipse cx="55" cy="117.6" rx="9" ry="0.9" fill="#8a6649" opacity="0.7"/>';
  }

  /* Before it is anything in particular: a seed, cracking open, then the
     first two round leaves every plant starts with. It fades as the plant
     itself takes over. */
  function sprout(id, g) {
    var out = '';
    if (g < 0.06) {
      var crack = ramp(g, 0.015, 0.05);
      out += '<ellipse cx="60" cy="117" rx="3.2" ry="2.1" fill="#a07a52"/><ellipse cx="59" cy="116.4" rx="1.3" ry="0.7" fill="#c49c6e"/>';
      if (crack > 0) out += curve([60, 116.5], [60.5, 115.5 - crack * 2], [61.5, 114.6 - crack * 3], '#7cbf72', 1.1);
    }
    var fade = 1 - ramp(g, 0.11, 0.2);
    var t = ramp(g, 0.03, 0.12);
    if (t > 0 && fade > 0) {
      var h = 2 + ease(t) * 9;
      out += '<g opacity="' + f(fade) + '">' + curve([60, 118], [59.5, 118 - h * 0.6], [60, 118 - h], '#6ba965', 1.4) +
        leaf(60, 118 - h, 3 + t * 4.5, 3.4 + t * 3, -62, 'url(#' + id + 'm)', null, true) +
        leaf(60, 118 - h, 3 + t * 4.5, 3.4 + t * 3, 62, 'url(#' + id + 'l)', null, true) + '</g>';
    }
    return out;
  }

  /* ---------- the plants ---------- */

  var DRAW = {};

  // fronds unrolling from the middle, each lined with little leaflets
  DRAW.fern = function (id, g, r, tone) {
    tone = tone || { a: 'l', b: 'k', stem: '#4c8a52', tip: '#5f9c5c' };
    var out = '', n = 2 + Math.round(ramp(g, 0.1, 0.8) * 8), fronds = [];
    for (var i = 0; i < n; i++) {
      var side = i % 2 ? 1 : -1, spread = (Math.floor((i + 1) / 2) / 5);
      fronds.push({ t: 0.1 + i * 0.07, ang: side * (8 + spread * 62) + between(r, -6, 6), len: between(r, 0.72, 1) * (1 - spread * 0.35) });
    }
    // the outer ones behind, the middle in front
    fronds.sort(function (a, b) { return Math.abs(b.ang) - Math.abs(a.ang); });
    fronds.forEach(function (fr) {
      var gi = ramp(g, fr.t, fr.t + 0.32);
      if (gi <= 0) return;
      var L = 86 * fr.len * ease(gi), rad = fr.ang * Math.PI / 180;
      var p0 = [60, 118], p2 = [60 + Math.sin(rad) * L * 1.05, 118 - Math.cos(rad) * L * 0.92 + Math.abs(fr.ang) * L * 0.004];
      var p1 = [60 + Math.sin(rad) * L * 0.35, 118 - L * 0.95];
      var deep = Math.abs(fr.ang) > 40 ? tone.b : tone.a;
      out += curve(p0, p1, p2, tone.stem, 1 + gi * 0.5);
      var m = Math.max(2, Math.floor(L / 3.4));
      for (var k = 1; k < m; k++) {
        var s = k / m, pt = along(p0, p1, p2, s);
        var size = (2.5 + L * 0.085) * (1 - s * 0.72) * ramp(gi, s * 0.6, s * 0.6 + 0.35);
        out += leaf(pt.x, pt.y, size, size * 0.42, pt.a - 62, 'url(#' + id + deep + ')') +
          leaf(pt.x, pt.y, size, size * 0.42, pt.a + 62, 'url(#' + id + deep + ')');
      }
      // still uncurling at the tip
      if (gi < 1) {
        var tip = along(p0, p1, p2, 1), c = 1.6 + (1 - gi) * 2.2;
        out += '<circle cx="' + f(tip.x) + '" cy="' + f(tip.y) + '" r="' + f(c) + '" fill="none" stroke="' + tone.tip + '" stroke-width="1.1"/>';
      }
    });
    return out;
  };

  // big heart leaves on long stalks, hanging outwards, splitting as they mature
  DRAW.monstera = function (id, g, r) {
    var out = '', n = 1 + Math.round(ramp(g, 0.12, 0.85) * 5), defs = '';
    var angs = [-6, 28, -34, 50, -52, 10];
    var leaves = [];
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.12 + i * 0.11, 0.45 + i * 0.11);
      if (gi > 0) leaves.push({ i: i, gi: gi, ang: angs[i] + between(r, -5, 5) });
    }
    // the far ones first, so the near ones overlap them
    leaves.sort(function (a, b) { return Math.abs(b.ang) - Math.abs(a.ang); });
    leaves.forEach(function (lf) {
      var rad = lf.ang * Math.PI / 180, L = (26 + 26 * (1 - lf.i / 7)) * ease(lf.gi);
      var tip = [60 + Math.sin(rad) * L * 1.1, 118 - Math.cos(rad) * L];
      out += curve([60, 118], [60 + Math.sin(rad) * L * 0.25, 118 - L * 0.75], tip, '#4f8c55', 1.5);
      var size = (13 + 13 * (1 - lf.i / 8)) * ease(lf.gi);
      var side = lf.ang === 0 ? 1 : lf.ang > 0 ? 1 : -1;
      var hang = lf.ang + side * (Math.abs(lf.ang) < 15 ? 60 : 105);
      var mask = id + 'h' + lf.i, holes = '';
      if (lf.gi > 0.5 && size > 10) {
        var cuts = 1 + Math.round(ramp(lf.gi, 0.5, 1) * 3);
        for (var c = 1; c <= cuts; c++) {
          var y = -size * (0.18 + c * 0.2);
          [1, -1].forEach(function (sd) {
            holes += '<path d="M' + f(sd * size * 0.75) + ' ' + f(y + 1.6) + 'L' + f(sd * size * 0.14) + ' ' + f(y - 0.4) +
              'L' + f(sd * size * 0.75) + ' ' + f(y - 1.2) + 'Z" fill="#000"/>';
          });
        }
        if (lf.gi > 0.8) holes += '<ellipse cx="' + f(size * 0.3) + '" cy="' + f(-size * 0.45) + '" rx="0.9" ry="1.6" fill="#000"/>' +
          '<ellipse cx="' + f(-size * 0.3) + '" cy="' + f(-size * 0.62) + '" rx="0.9" ry="1.6" fill="#000"/>';
      }
      defs += '<mask id="' + mask + '" maskUnits="userSpaceOnUse" x="-70" y="-70" width="140" height="140">' +
        '<rect x="-70" y="-70" width="140" height="140" fill="#fff"/>' + holes + '</mask>';
      out += '<g transform="translate(' + f(tip[0]) + ' ' + f(tip[1]) + ') rotate(' + f(hang) + ')"><g mask="url(#' + mask + ')">' +
        heart(0, 0, size, 0, 'url(#' + id + (lf.i % 2 ? 'k' : 'l') + ')', '#a9d6ae') + '</g></g>';
    });
    return '<defs>' + defs + '</defs>' + out;
  };

  var TULIP = ['#e8505b', '#f49ac1', '#f6c945', '#f4f0ea', '#9b6fd1', '#f2894a'];

  // two long leaves, a stem, a bud that colours, then a cup that opens
  DRAW.tulip = function (id, g, r) {
    var out = '', colour = pickFrom(r, TULIP), lean = between(r, -5, 5);
    var lt = ramp(g, 0.08, 0.5);
    out += leaf(58, 118, 44 * ease(lt), 12 * ease(lt), -18 + lean, 'url(#' + id + 'k)', '#a9d6ae');
    out += leaf(62, 118, 38 * ease(lt), 11 * ease(lt), 22 + lean, 'url(#' + id + 'l)', '#a9d6ae');
    var st = ramp(g, 0.15, 0.7), H = 82 * ease(st);
    if (st > 0) {
      var top = [60 + lean * 1.4, 118 - H];
      out += curve([60, 118], [60 + lean * 0.4, 118 - H * 0.55], top, '#5a9a5c', 2);
      if (st > 0.3) out += leaf(60.4, 118 - H * 0.42, 22 * ramp(g, 0.3, 0.6), 7, 34 + lean, 'url(#' + id + 'l)', '#a9d6ae');
      var bud = ramp(g, 0.42, 0.6), open = ramp(g, 0.62, 0.92);
      if (bud > 0) out += flowerTulip(top[0], top[1], 6 + bud * 6, colour, ramp(g, 0.5, 0.64), open, lean);
    }
    return out;
  };

  function flowerTulip(x, y, s, colour, tint, open, lean) {
    var green = '#78b26f', fill = tint < 1 ? mix(green, colour, tint) : colour;
    var spread = open * 26;
    var petal = function (ang, scale, shade) {
      return '<g transform="translate(' + f(x) + ' ' + f(y + 1) + ') rotate(' + f(lean + ang) + ')"><path d="M0 0C' + f(s * 0.62 * scale) + ' ' + f(-s * 0.1) +
        ' ' + f(s * 0.58 * scale) + ' ' + f(-s * 0.95) + ' 0 ' + f(-s * 1.35) + 'C' + f(-s * 0.58 * scale) + ' ' + f(-s * 0.95) + ' ' + f(-s * 0.62 * scale) +
        ' ' + f(-s * 0.1) + ' 0 0Z" fill="' + shade + '"/></g>';
    };
    return petal(0, 0.9, darken(fill, 0.12)) + petal(-spread, 0.85, fill) + petal(spread, 0.85, fill) +
      '<path d="M' + f(x - s * 0.2) + ' ' + f(y - s * 0.4) + 'Q' + f(x) + ' ' + f(y - s * 0.95) + ' ' + f(x + s * 0.12) + ' ' + f(y - s * 1.05) +
      '" stroke="#ffffff" stroke-width="0.8" opacity="0.35" fill="none" stroke-linecap="round"/>';
  }

  // tall, with a few broad leaves, and a face that opens last of all
  DRAW.sunflower = function (id, g, r) {
    var out = '', lean = between(r, -6, 6), st = ramp(g, 0.1, 0.72), H = 92 * ease(st);
    if (st <= 0) return '';
    var p0 = [60, 118], p1 = [60 - lean * 0.6, 118 - H * 0.5], p2 = [60 + lean, 118 - H];
    out += curve(p0, p1, p2, '#5d9a55', 2.8);
    var pairs = Math.min(3, Math.floor(H / 24));
    for (var k = 1; k <= pairs; k++) {
      var s = k / (pairs + 1.3), pt = along(p0, p1, p2, s);
      var size = (17 - k * 3) * ramp(g, 0.12 + s * 0.35, 0.35 + s * 0.35);
      var flip = k % 2 ? 1 : -1;
      out += heart(pt.x, pt.y, size, pt.a + flip * 112, 'url(#' + id + 'l)', '#a9d6ae') +
        heart(pt.x, pt.y, size * 0.85, pt.a - flip * 118, 'url(#' + id + 'k)', '#a9d6ae');
    }
    var bud = ramp(g, 0.45, 0.62), open = ramp(g, 0.6, 0.92);
    if (bud > 0) {
      var c = along(p0, p1, p2, 1), R = 5 + bud * 3 + open * 5;
      if (open > 0) {
        var petals = 20;
        for (var i = 0; i < petals; i++) {
          var a = i * 360 / petals + (i % 2) * 4;
          out += leaf(c.x, c.y, (R * 0.55 + 6) * ease(open), 4.6, a, i % 2 ? '#f5bf2f' : '#f9d65a');
        }
      } else {
        // the bud: a tight green star
        for (var j = 0; j < 8; j++) out += leaf(c.x, c.y, 3 + bud * 3, 3, j * 45, '#6fae62');
      }
      out += '<circle cx="' + f(c.x) + '" cy="' + f(c.y) + '" r="' + f(open > 0 ? R * 0.5 : 2.6 + bud * 1.5) + '" fill="' + (open > 0 ? '#6e4424' : '#5f9c56') + '"/>';
      if (open > 0.15) {
        for (var d = 1; d < 30; d++) {
          var rr = Math.sqrt(d / 30) * R * 0.44, th = d * 137.5 * Math.PI / 180;
          out += '<circle cx="' + f(c.x + Math.cos(th) * rr) + '" cy="' + f(c.y + Math.sin(th) * rr) + '" r="0.45" fill="#c9924f" opacity="' + f(open) + '"/>';
        }
      }
    }
    return out;
  };

  // a clump of thin stems, each topped with a spike of purple buds
  DRAW.lavender = function (id, g, r) {
    var out = '', n = 3 + Math.round(ramp(g, 0.1, 0.8) * 9);
    for (var j = 0; j < 7; j++) {
      out += leaf(60 + between(r, -5, 5), 118, 14 * ramp(g, 0.05 + j * 0.02, 0.35), 2.6, between(r, -60, 60), j % 2 ? '#86a98a' : '#9cbb9c');
    }
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.12 + i * 0.04, 0.5 + i * 0.04);
      if (gi <= 0) continue;
      var ang = between(r, -24, 24), rad = ang * Math.PI / 180, L = between(r, 58, 90) * ease(gi);
      var p0 = [60 + ang * 0.08, 118], p2 = [p0[0] + Math.sin(rad) * L, 118 - Math.cos(rad) * L], p1 = [p0[0] + Math.sin(rad) * L * 0.3, 118 - L * 0.55];
      out += curve(p0, p1, p2, '#7f9f7f', 0.9);
      var spike = ramp(g, 0.38 + i * 0.02, 0.75);
      if (spike > 0) {
        var buds = 4 + Math.round(spike * 6);
        for (var b = 0; b < buds; b++) {
          var s = 1 - b * 0.055, pt = along(p0, p1, p2, s), side = b % 2 ? 1 : -1;
          var colour = mix('#9bb59a', b % 3 ? '#8c6fc4' : '#a68ad8', ramp(g, 0.45, 0.72));
          out += '<ellipse cx="' + f(pt.x + side * 0.9) + '" cy="' + f(pt.y) + '" rx="' + f(1.1 + spike * 0.5) + '" ry="' + f(1.6 + spike * 0.6) +
            '" fill="' + colour + '" transform="rotate(' + f(pt.a + side * 18) + ' ' + f(pt.x + side * 0.9) + ' ' + f(pt.y) + ')"/>';
        }
      }
    }
    return out;
  };

  // a low rosette of thick, pink-tipped leaves, and a flower stalk late on
  DRAW.succulent = function (id, g, r) {
    var out = '', t = ramp(g, 0.08, 0.85), w = 0.55 + ease(t) * 0.75;
    var rows = [
      { n: 7, len: 22, wid: 11, spread: 78, y: 117, fill: 'url(#' + id + 'sa)' },
      { n: 5, len: 18, wid: 10, spread: 50, y: 116, fill: 'url(#' + id + 'sb)' },
      { n: 3, len: 13, wid: 8.5, spread: 22, y: 115, fill: 'url(#' + id + 'sa)' }
    ];
    rows.forEach(function (row, ri) {
      var rt = ramp(g, 0.06 + ri * 0.08, 0.6 + ri * 0.12);
      if (rt <= 0) return;
      for (var i = 0; i < row.n; i++) {
        var a = -row.spread + (2 * row.spread) * (i / Math.max(1, row.n - 1)) + between(r, -4, 4);
        out += leaf(60, row.y, row.len * w * ease(rt), row.wid * w, a, row.fill, null, true);
      }
    });
    var stalk = ramp(g, 0.68, 0.95);
    if (stalk > 0) {
      var p0 = [62, 112], p1 = [74, 112 - 40 * stalk], p2 = [80, 112 - 34 * stalk];
      out += curve(p0, p1, p2, '#b07f86', 1.2);
      for (var k = 0; k < 4; k++) {
        var pt = along(p0, p1, p2, 0.55 + k * 0.15);
        out += '<ellipse cx="' + f(pt.x) + '" cy="' + f(pt.y + 2) + '" rx="1.6" ry="2.3" fill="' + (k % 2 ? '#f08a6c' : '#f6a77f') + '" opacity="' + f(stalk) + '"/>';
      }
    }
    return out;
  };

  // a ribbed column with tiny spines, arms later, and one pink flower
  DRAW.cactus = function (id, g, r) {
    var out = '', t = ramp(g, 0.08, 0.75), H = 12 + 62 * ease(t), W = 9 + 4 * ease(t);
    if (t <= 0) return '';
    function column(x, base, h, w) {
      var top = base - h;
      return '<path d="M' + f(x - w) + ' ' + f(base) + 'L' + f(x - w) + ' ' + f(top + w) + 'Q' + f(x - w) + ' ' + f(top) + ' ' + f(x) + ' ' + f(top) +
        'Q' + f(x + w) + ' ' + f(top) + ' ' + f(x + w) + ' ' + f(top + w) + 'L' + f(x + w) + ' ' + f(base) + 'Z" fill="url(#' + id + 'c)"/>' +
        '<path d="M' + f(x - w * 0.4) + ' ' + f(base) + 'L' + f(x - w * 0.42) + ' ' + f(top + w * 0.7) + 'M' + f(x + w * 0.4) + ' ' + f(base) + 'L' + f(x + w * 0.42) + ' ' + f(top + w * 0.7) +
        '" stroke="#3f7a4e" stroke-width="0.8" opacity="0.55"/>' + spines(x, base, h, w);
    }
    function spines(x, base, h, w) {
      var s = '';
      for (var y = base - 5; y > base - h + w * 0.8; y -= 5.5) {
        [-w * 0.75, 0, w * 0.75].forEach(function (dx, i) {
          s += '<path d="M' + f(x + dx) + ' ' + f(y - (i % 2) * 2.5) + 'l' + f(dx < 0 ? -1.4 : dx > 0 ? 1.4 : 0) + ' -1" stroke="#f3efd9" stroke-width="0.6" stroke-linecap="round"/>';
        });
      }
      return s;
    }
    function arm(side, at, len) {
      var x = 60 + side * W, y = 118 - H * at, reach = 7 + len * 4;
      var cx = x + side * reach;
      return '<path d="M' + f(x - side * 1) + ' ' + f(y + 4) + 'L' + f(cx - side * 3.5) + ' ' + f(y + 4) + 'Q' + f(cx + side * 3.5) + ' ' + f(y + 4) + ' ' + f(cx + side * 3.5) + ' ' + f(y - 3) +
        'L' + f(cx + side * 3.5) + ' ' + f(y - 6 - len * 14) + 'Q' + f(cx) + ' ' + f(y - 10 - len * 14) + ' ' + f(cx - side * 3.5) + ' ' + f(y - 6 - len * 14) +
        'L' + f(cx - side * 3.5) + ' ' + f(y - 3) + 'L' + f(x - side * 1) + ' ' + f(y - 3) + 'Z" fill="url(#' + id + 'c)"/>';
    }
    var a1 = ramp(g, 0.35, 0.62), a2 = ramp(g, 0.5, 0.78);
    if (a1 > 0) out += arm(r() < 0.5 ? -1 : 1, 0.42, ease(a1));
    var other = r() < 0.5 ? -1 : 1;
    if (a2 > 0) out += arm(other, 0.6, ease(a2) * 0.7);
    out += column(60, 118, H, W);
    var bloom = ramp(g, 0.75, 0.95);
    if (bloom > 0) {
      for (var p = 0; p < 7; p++) out += leaf(60, 118 - H + 1, 4 + bloom * 3.5, 3.4, -66 + p * 22, p % 2 ? '#f48fb1' : '#f7a8c4');
      out += '<circle cx="60" cy="' + f(118 - H) + '" r="1.6" fill="#f9d76a"/>';
    }
    return out;
  };

  // upright swords with wavy bands and golden edges
  DRAW.snake = function (id, g, r) {
    var out = '', n = 2 + Math.round(ramp(g, 0.12, 0.85) * 5);
    var order = [0, -1, 1, -2, 2, -3, 3];
    var leaves = [];
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.1 + i * 0.09, 0.45 + i * 0.09);
      if (gi <= 0) continue;
      var slot = order[i];
      leaves.push({ slot: slot, gi: gi, len: (88 - Math.abs(slot) * 12 + between(r, -6, 6)) * ease(gi), wid: 11 - Math.abs(slot) * 0.8 });
    }
    leaves.sort(function (a, b) { return Math.abs(b.slot) - Math.abs(a.slot); });
    leaves.forEach(function (lf) {
      var x = 60 + lf.slot * 3.4, ang = lf.slot * 7 + between(r, -3, 3), L = lf.len, w = lf.wid / 2;
      var bands = '';
      for (var y = -6; y > -L * 0.88; y -= 6.5) {
        var ww = w * (1 - (-y / L) * 0.85) * 0.78;
        bands += '<path d="M' + f(-ww) + ' ' + f(y) + 'l' + f(ww * 0.5) + ' -1.6l' + f(ww * 0.5) + ' 1.4l' + f(ww * 0.5) + ' -1.6l' + f(ww * 0.5) + ' 1.4" fill="none" stroke="#9cc79a" stroke-width="0.9" opacity="0.7"/>';
      }
      out += '<g transform="translate(' + f(x) + ' 118) rotate(' + f(ang) + ')"><path d="M' + f(-w) + ' 0C' + f(-w) + ' ' + f(-L * 0.5) + ' ' + f(-w * 0.6) + ' ' + f(-L * 0.8) +
        ' 0 ' + f(-L) + 'C' + f(w * 0.6) + ' ' + f(-L * 0.8) + ' ' + f(w) + ' ' + f(-L * 0.5) + ' ' + f(w) + ' 0Z" fill="url(#' + id + 'k)" stroke="#d6c860" stroke-width="' + f(0.8 + lf.gi * 0.5) + '"/>' +
        bands + '</g>';
    });
    return out;
  };

  var DAISY = ['#ffffff', '#ffffff', '#fbe1ea', '#fff4c4'];

  // a bushy clump, and daisies opening one after another
  DRAW.daisy = function (id, g, r) {
    var out = '', petal = pickFrom(r, DAISY);
    for (var j = 0; j < 9; j++) {
      var lt = ramp(g, 0.06 + j * 0.03, 0.45 + j * 0.03);
      out += leaf(60 + between(r, -6, 6), 118, 22 * ease(lt), 6, between(r, -70, 70), j % 2 ? 'url(#' + id + 'k)' : 'url(#' + id + 'l)', '#a9d6ae', true);
    }
    var n = 1 + Math.round(ramp(g, 0.25, 0.85) * 6);
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.22 + i * 0.08, 0.5 + i * 0.08);
      if (gi <= 0) continue;
      var ang = between(r, -34, 34), rad = ang * Math.PI / 180, L = between(r, 40, 74) * ease(gi);
      var p0 = [60 + ang * 0.1, 117], p2 = [p0[0] + Math.sin(rad) * L, 117 - Math.cos(rad) * L], p1 = [p0[0] + Math.sin(rad) * L * 0.2, 117 - L * 0.6];
      out += curve(p0, p1, p2, '#5f9c5c', 0.9);
      var open = ramp(gi, 0.55, 1), R = 3 + open * 5;
      if (open > 0) {
        for (var k = 0; k < 12; k++) {
          out += '<g opacity="0.9">' + leaf(p2[0], p2[1], R * open + 1.4, 2.4, k * 30, darken(petal, 0.12)) + '</g>' +
            leaf(p2[0], p2[1], R * open + 0.6, 1.8, k * 30, k % 2 ? petal : darken(petal, 0.03));
        }
        out += '<circle cx="' + f(p2[0]) + '" cy="' + f(p2[1]) + '" r="' + f(1.4 + open * 1.2) + '" fill="#f4c53a"/>';
      } else out += '<circle cx="' + f(p2[0]) + '" cy="' + f(p2[1]) + '" r="1.8" fill="#79b06e"/>';
    }
    return out;
  };

  // heart leaves on vines that climb a little, then spill over the pot
  DRAW.pothos = function (id, g, r) {
    var out = '', vines = 1 + Math.round(ramp(g, 0.15, 0.8) * 3);
    for (var v = 0; v < vines; v++) {
      var gi = ramp(g, 0.1 + v * 0.12, 0.7 + v * 0.1);
      if (gi <= 0) continue;
      var side = v % 2 ? 1 : -1, trail = v >= 2;
      var p0 = [60 + side * 4, 118], p2, p1;
      if (trail) { p1 = [60 + side * 34, 106]; p2 = [60 + side * (30 + 6 * gi), 118 + 34 * ease(gi)]; }
      else { p1 = [60 + side * 10, 118 - 50 * gi]; p2 = [60 + side * (18 + 14 * gi), 118 - 62 * ease(gi)]; }
      out += curve(p0, p1, p2, '#5c9058', 1);
      var m = 2 + Math.floor(gi * 5);
      for (var k = 1; k <= m; k++) {
        var s = k / (m + 0.4), pt = along(p0, p1, p2, s), size = (7.5 + 4.5 * (1 - s)) * ramp(gi, s * 0.7, s * 0.7 + 0.3);
        var a = pt.a + (k % 2 ? 70 : -70) + (trail ? 90 * side : 0);
        out += heart(pt.x, pt.y, size, a, 'url(#' + id + (k % 3 ? 'l' : 'k') + ')', '#e9e39a');
      }
    }
    // the first leaves, low in the middle
    out += heart(60, 118, 12 * ramp(g, 0.08, 0.35), -24, 'url(#' + id + 'l)', '#e9e39a') +
      heart(60, 118, 11 * ramp(g, 0.12, 0.4), 30, 'url(#' + id + 'k)', '#e9e39a');
    return out;
  };

  /* ---------- the uncommon ones ---------- */

  // thick, toothed, speckled spears, and a stalk of coral flowers late on
  DRAW.aloe = function (id, g, r) {
    var out = '', n = 3 + Math.round(ramp(g, 0.1, 0.8) * 7), leaves = [];
    for (var i = 0; i < n; i++) {
      var side = i % 2 ? 1 : -1, k = Math.floor((i + 1) / 2);
      leaves.push({ ang: side * (5 + k * 12) + between(r, -4, 4), t: 0.08 + i * 0.06, len: 1 - k * 0.1 });
    }
    leaves.sort(function (a, b) { return Math.abs(b.ang) - Math.abs(a.ang); });
    leaves.forEach(function (lf, j) {
      var gi = ramp(g, lf.t, lf.t + 0.4);
      if (gi <= 0) return;
      var L = 60 * lf.len * ease(gi), W = 9 * (0.55 + 0.45 * gi);
      var s = '<g transform="translate(60 118) rotate(' + f(lf.ang) + ')"><path d="M' + f(-W / 2) + ' 0C' + f(-W / 2) + ' ' + f(-L * 0.5) + ' ' + f(-W * 0.25) + ' ' + f(-L * 0.85) +
        ' 0 ' + f(-L) + 'C' + f(W * 0.25) + ' ' + f(-L * 0.85) + ' ' + f(W / 2) + ' ' + f(-L * 0.5) + ' ' + f(W / 2) + ' 0Z" fill="url(#' + id + (j % 2 ? 'aa' : 'ab') + ')"/>';
      for (var y = -5; y > -L * 0.8; y -= 5.5) {
        var half = (W / 2) * Math.pow(1 - (-y / L), 0.8);
        s += '<path d="M' + f(half) + ' ' + f(y) + 'l1.3 -0.9l-1.1 -0.9M' + f(-half) + ' ' + f(y) + 'l-1.3 -0.9l1.1 -0.9" fill="#d9ebd6"/>' +
          '<ellipse cx="' + f(between(r, -half * 0.5, half * 0.5)) + '" cy="' + f(y - 2) + '" rx="0.7" ry="0.45" fill="#e3f1e1" opacity="0.8"/>';
      }
      out += s + '</g>';
    });
    var st = ramp(g, 0.7, 0.95);
    if (st > 0) {
      var p0 = [62, 112], p1 = [66, 112 - 50 * st], p2 = [70, 112 - 76 * st];
      out += curve(p0, p1, p2, '#8fa572', 1.2);
      for (var b = 0; b < 7; b++) {
        var pt = along(p0, p1, p2, 0.7 + b * 0.045);
        out += leaf(pt.x, pt.y, 4.5 * st, 1.8, 150 + (b % 2 ? 20 : -20), b % 2 ? '#f08a5d' : '#f6a66f');
      }
    }
    return out;
  };

  // lucky bamboo: jointed stalks, a few leaves up top, a gold ribbon
  DRAW.bamboo = function (id, g, r) {
    var out = '', stalks = [{ x: -8, h: 1 }, { x: 3, h: 0.8 }, { x: 11, h: 0.62 }, { x: -1, h: 0.5 }];
    var n = 2 + Math.round(ramp(g, 0.2, 0.7) * 2);
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.06 + i * 0.08, 0.7 + i * 0.06);
      if (gi <= 0) continue;
      var H = 90 * stalks[i].h * ease(gi), x = 60 + stalks[i].x;
      out += '<rect x="' + f(x - 2.7) + '" y="' + f(118 - H) + '" width="5.4" height="' + f(H) + '" rx="2.6" fill="url(#' + id + 'bb)"/>';
      for (var y = 118 - 14; y > 118 - H + 4; y -= 14) {
        out += '<path d="M' + f(x - 2.9) + ' ' + f(y) + 'h5.8" stroke="#6c9a52" stroke-width="1.3" stroke-linecap="round"/>';
      }
      var top = 118 - H;
      out += leaf(x, top + 4, 8 + 7 * gi, 3.4, -46 + between(r, -8, 8), 'url(#' + id + 'l)', '#a9d6ae') +
        leaf(x, top + 6, 7 + 6 * gi, 3.2, 52 + between(r, -8, 8), 'url(#' + id + 'k)', '#a9d6ae');
      if (gi > 0.6) out += leaf(x + 2, top + 22, 6 * ramp(gi, 0.6, 1), 2.8, 70, 'url(#' + id + 'l)');
    }
    var tie = ramp(g, 0.4, 0.6);
    if (tie > 0) {
      out += '<rect x="48" y="101" width="26" height="3.2" rx="1.2" fill="#e6b84a" opacity="' + f(tie) + '"/>' +
        '<path d="M60 102.6l-5 -3.4v6.8zM60 102.6l5 -3.4v6.8z" fill="#d9a536" opacity="' + f(tie) + '"/>';
    }
    return out;
  };

  // three-leaved clumps, white flowers, then berries hanging over the rim
  DRAW.strawberry = function (id, g, r) {
    var out = '', n = 3 + Math.round(ramp(g, 0.1, 0.8) * 5), ends = [];
    for (var i = 0; i < n; i++) {
      var gi = ramp(g, 0.06 + i * 0.07, 0.45 + i * 0.07);
      if (gi <= 0) continue;
      var ang = (i % 2 ? 1 : -1) * (10 + Math.floor((i + 1) / 2) * 16) + between(r, -6, 6), rad = ang * Math.PI / 180, L = between(r, 22, 36) * ease(gi);
      var tip = [60 + Math.sin(rad) * L, 118 - Math.cos(rad) * L];
      out += curve([60, 118], [60 + Math.sin(rad) * L * 0.3, 118 - L * 0.8], tip, '#6b9e5a', 0.9);
      var size = 7 + 4 * gi, fill = 'url(#' + id + (i % 2 ? 'k' : 'l') + ')';
      out += leaf(tip[0], tip[1], size, size * 0.8, ang - 42, fill, '#a9d6ae', true) +
        leaf(tip[0], tip[1], size, size * 0.8, ang + 42, fill, '#a9d6ae', true) +
        leaf(tip[0], tip[1], size * 1.08, size * 0.85, ang, fill, '#a9d6ae', true);
      ends.push(tip);
    }
    var bloom = ramp(g, 0.35, 0.6), fade = 1 - ramp(g, 0.7, 0.85);
    if (bloom > 0 && fade > 0) {
      [[48, 104], [72, 101]].forEach(function (p) {
        for (var k = 0; k < 5; k++) out += '<circle cx="' + f(p[0] + Math.cos(k * 1.2566) * 2.4 * bloom) + '" cy="' + f(p[1] + Math.sin(k * 1.2566) * 2.4 * bloom) + '" r="' + f(1.8 * bloom) + '" fill="#ffffff" stroke="#e6e1d3" stroke-width="0.3" opacity="' + f(fade) + '"/>';
        out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + f(1.1 * bloom) + '" fill="#f2c94c" opacity="' + f(fade) + '"/>';
      });
    }
    var fruit = ramp(g, 0.62, 0.95);
    if (fruit > 0) {
      [[34, 128, -1], [86, 126, 1], [44, 132, -1]].slice(0, 1 + Math.round(fruit * 2)).forEach(function (b) {
        var x = b[0], y = b[1], s = 3 + fruit * 2.5, ripe = mix('#b9d77e', '#e5484d', ramp(fruit, 0.2, 0.8));
        out += curve([60 + b[2] * 8, 112], [x + b[2] * 2, 112], [x, y - s], '#6b9e5a', 0.8) +
          '<path d="M' + f(x) + ' ' + f(y + s * 1.2) + 'C' + f(x - s * 1.3) + ' ' + f(y + s * 0.2) + ' ' + f(x - s) + ' ' + f(y - s) + ' ' + f(x) + ' ' + f(y - s * 0.9) +
          'C' + f(x + s) + ' ' + f(y - s) + ' ' + f(x + s * 1.3) + ' ' + f(y + s * 0.2) + ' ' + f(x) + ' ' + f(y + s * 1.2) + 'Z" fill="' + ripe + '"/>';
        for (var d = 0; d < 5; d++) out += '<circle cx="' + f(x + (d % 3 - 1) * s * 0.45) + '" cy="' + f(y + (d < 3 ? -0.1 : 0.55) * s) + '" r="0.35" fill="#f7e38a"/>';
        out += '<path d="M' + f(x - s * 0.7) + ' ' + f(y - s * 0.8) + 'L' + f(x) + ' ' + f(y - s * 1.3) + 'L' + f(x + s * 0.7) + ' ' + f(y - s * 0.8) + 'L' + f(x) + ' ' + f(y - s * 0.6) + 'Z" fill="#5f9a4f"/>';
      });
    }
    return out;
  };

  /* ---------- the rare ones ---------- */

  var ORCHID = [{ p: '#ffffff', e: '#f1e6ee', c: '#d6458b' }, { p: '#f6c4dd', e: '#eaa6c8', c: '#b02c6e' }, { p: '#d9bdf0', e: '#c39ee6', c: '#6b2fa0' }];

  // broad leaves low down, and a staked spike arching with blooms
  DRAW.orchid = function (id, g, r) {
    var out = '', tone = pickFrom(r, ORCHID), lt = ramp(g, 0.06, 0.45);
    out += leaf(60, 117, 30 * ease(lt), 13, -80, 'url(#' + id + 'k)', '#a9d6ae', true) +
      leaf(60, 117, 27 * ease(lt), 12, 76, 'url(#' + id + 'l)', '#a9d6ae', true) +
      leaf(60, 117, 22 * ease(ramp(g, 0.2, 0.55)), 11, -42, 'url(#' + id + 'l)', '#a9d6ae', true);
    var st = ramp(g, 0.25, 0.75);
    if (st <= 0) return out;
    out += '<path d="M63 118L63 ' + f(118 - 72 * st) + '" stroke="#c4a979" stroke-width="1.1" stroke-linecap="round"/>';
    var arc = ramp(g, 0.5, 0.85);
    var p0 = [62, 116], p1 = [61, 118 - 98 * st], p2 = [62 + 34 * arc, 118 - 74 * st - 6 * (1 - arc)];
    out += curve(p0, p1, p2, '#6a8a4f', 1);
    var blooms = Math.round(ramp(g, 0.55, 0.95) * 5);
    for (var i = 0; i < blooms; i++) {
      var pt = along(p0, p1, p2, 0.52 + i * 0.1), s = 6.8 - i * 0.45;
      out += '<g transform="translate(' + f(pt.x) + ' ' + f(pt.y + 2) + ')">' +
        leaf(0, 0, s * 1.2, s * 0.7, 0, tone.e) + leaf(0, 0, s * 1.1, s * 0.6, 125, tone.e) + leaf(0, 0, s * 1.1, s * 0.6, -125, tone.e) +
        '<ellipse cx="' + f(-s * 0.75) + '" cy="' + f(-s * 0.1) + '" rx="' + f(s * 0.85) + '" ry="' + f(s * 0.7) + '" fill="' + tone.p + '"/>' +
        '<ellipse cx="' + f(s * 0.75) + '" cy="' + f(-s * 0.1) + '" rx="' + f(s * 0.85) + '" ry="' + f(s * 0.7) + '" fill="' + tone.p + '"/>' +
        '<path d="M0 ' + f(-s * 0.15) + 'c' + f(-s * 0.5) + ' ' + f(s * 0.2) + ' ' + f(-s * 0.4) + ' ' + f(s * 0.9) + ' 0 ' + f(s * 0.95) + 'c' + f(s * 0.4) + ' ' + f(-s * 0.05) + ' ' + f(s * 0.5) + ' ' + f(-s * 0.75) + ' 0 ' + f(-s * 0.95) + 'z" fill="' + tone.c + '"/>' +
        '<circle cx="0" cy="' + f(-s * 0.35) + '" r="' + f(s * 0.16) + '" fill="#f7d25c"/></g>';
    }
    if (arc > 0 && blooms < 5) {
      for (var k = blooms; k < Math.min(blooms + 2, 6); k++) {
        var bp = along(p0, p1, p2, 0.52 + k * 0.1);
        out += '<ellipse cx="' + f(bp.x) + '" cy="' + f(bp.y + 1.5) + '" rx="1.7" ry="2.2" fill="' + mix('#9cbf7a', tone.e, 0.5) + '"/>';
      }
    }
    return out;
  };

  // a twisting trunk with clouds of foliage, in a shallow tray
  DRAW.bonsai = function (id, g, r) {
    var out = '', t = ramp(g, 0.05, 0.9), lean = between(r, 8, 14) * (r() < 0.5 ? -1 : 1);
    if (t <= 0) return '';
    var H = 18 + 46 * ease(t), p0 = [60, 118], p1 = [60 - lean * 1.4, 118 - H * 0.5], p2 = [60 + lean * 0.6, 118 - H];
    var left = [], right = [];
    for (var i = 0; i <= 12; i++) {
      var s = i / 12, pt = along(p0, p1, p2, s), w = (5.5 * (1 - s) + 1.4) * (0.45 + 0.55 * t), a = (pt.a + 90) * Math.PI / 180;
      left.push(f(pt.x - Math.sin(a) * w) + ' ' + f(pt.y + Math.cos(a) * w));
      right.unshift(f(pt.x + Math.sin(a) * w) + ' ' + f(pt.y - Math.cos(a) * w));
    }
    out += '<path d="M' + left.join('L') + 'L' + right.join('L') + 'Z" fill="url(#' + id + 'tb)"/>';
    var pads = [];
    var b1 = ramp(g, 0.3, 0.6), b2 = ramp(g, 0.45, 0.75);
    if (b1 > 0) { var q = along(p0, p1, p2, 0.45); pads.push([q.x - lean * 1.6 * b1 - 10 * b1, q.y - 6 * b1, 9 + 4 * b1]); out += curve([q.x, q.y], [q.x - 6, q.y - 2], [q.x - lean * 1.6 * b1 - 10 * b1, q.y - 4 * b1], '#7a5a44', 2); }
    if (b2 > 0) { var q2 = along(p0, p1, p2, 0.7); pads.push([q2.x + 12 * b2 + lean * 0.6, q2.y - 4 * b2, 8 + 4 * b2]); out += curve([q2.x, q2.y], [q2.x + 5, q2.y - 2], [q2.x + 12 * b2 + lean * 0.6, q2.y - 3 * b2], '#7a5a44', 1.8); }
    pads.push([p2[0], p2[1] - 2, 9 + 7 * t]);
    pads.forEach(function (pd) {
      out += blob(pd[0], pd[1], pd[2], ['#2f6b45', '#3d7d52', '#4d8f5f'], 7, r, 0.7) + blob(pd[0] - pd[2] * 0.2, pd[1] - pd[2] * 0.25, pd[2] * 0.6, '#6aa874', 3, r, 0.6);
    });
    out += '<circle cx="50" cy="117.6" r="1.2" fill="#6aa874"/><circle cx="68" cy="117.8" r="1" fill="#5a9a63"/>';
    return out;
  };

  // glossy leaves, and white hoods with a cream spike, on tall stalks
  DRAW.lily = function (id, g, r) {
    var out = '', n = 4 + Math.round(ramp(g, 0.1, 0.8) * 6), leaves = [];
    for (var i = 0; i < n; i++) leaves.push({ ang: (i % 2 ? 1 : -1) * (6 + Math.floor((i + 1) / 2) * 12) + between(r, -5, 5), t: 0.06 + i * 0.05 });
    leaves.sort(function (a, b) { return Math.abs(b.ang) - Math.abs(a.ang); });
    leaves.forEach(function (lf, j) {
      var gi = ramp(g, lf.t, lf.t + 0.4);
      if (gi <= 0) return;
      var rad = lf.ang * Math.PI / 180, L = between(r, 22, 34) * ease(gi), tip = [60 + Math.sin(rad) * L, 118 - Math.cos(rad) * L];
      out += curve([60, 118], [60 + Math.sin(rad) * L * 0.4, 118 - L * 0.9], tip, '#3f7a4d', 1) +
        leaf(tip[0], tip[1], (18 + 6 * gi) * ease(gi), 8.5, lf.ang * 1.6, 'url(#' + id + (j % 2 ? 'k' : 'l') + ')', '#9fcfa6');
    });
    var flowers = Math.round(ramp(g, 0.5, 0.9) * 3);
    for (var k = 0; k < flowers; k++) {
      var fg = ramp(g, 0.5 + k * 0.12, 0.75 + k * 0.1), ang = [-6, 18, -24][k], rad2 = ang * Math.PI / 180, L2 = 70 - k * 10;
      var top = [60 + Math.sin(rad2) * L2, 118 - Math.cos(rad2) * L2];
      out += curve([60, 118], [60 + Math.sin(rad2) * L2 * 0.2, 118 - L2 * 0.6], top, '#4f8a55', 1.1) +
        '<g transform="translate(' + f(top[0]) + ' ' + f(top[1] + 2) + ') rotate(' + f(ang * 0.6) + ')"><path d="M0 0C' + f(10 * fg) + ' -3 ' + f(10 * fg) + ' ' + f(-17 * fg) + ' 0 ' + f(-27 * fg) +
        'C' + f(-10 * fg) + ' ' + f(-17 * fg) + ' ' + f(-10 * fg) + ' -3 0 0Z" fill="url(#' + id + 'ws)" stroke="#e3ecdf" stroke-width="0.4"/>' +
        '<path d="M0 ' + f(-2 * fg) + 'L0 ' + f(-24 * fg) + '" stroke="#e6efe2" stroke-width="0.5"/>' +
        '<ellipse cx="' + f(0.8) + '" cy="' + f(-8 * fg) + '" rx="' + f(1.6 * fg + 0.3) + '" ry="' + f(5.5 * fg) + '" fill="#efe3a8"/></g>';
    }
    return out;
  };

  /* ---------- the legendary ones ---------- */

  function sparkles(r, n, area, colours) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var x = between(r, area[0], area[2]), y = between(r, area[1], area[3]), s = between(r, 1.2, 2.6);
      out += '<path class="plant-sparkle" d="M' + f(x) + ' ' + f(y - s) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x + s) + ' ' + f(y) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x) + ' ' + f(y + s) +
        'Q' + f(x) + ' ' + f(y) + ' ' + f(x - s) + ' ' + f(y) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x) + ' ' + f(y - s) + 'Z" fill="' + colours[i % colours.length] + '" style="animation-delay:' + f(i * 0.37) + 's"/>';
    }
    return out;
  }

  // a vine on a hoop, with luminous moon-white trumpets that glow
  DRAW.moonflower = function (id, g, r) {
    var out = '', t = ramp(g, 0.06, 0.8);
    if (t <= 0) return '';
    var hoop = ramp(g, 0.1, 0.35);
    out += '<path d="M44 118C40 ' + f(118 - 70 * hoop) + ' 80 ' + f(118 - 70 * hoop) + ' 76 118" fill="none" stroke="#b9a77c" stroke-width="1.2" opacity="' + f(hoop) + '"/>';
    [[-1, 0], [1, 0.08]].forEach(function (v) {
      var vt = ramp(g, 0.06 + v[1], 0.8 + v[1]);
      if (vt <= 0) return;
      var p0 = [60 + v[0] * 3, 118], p1 = [60 + v[0] * 26, 118 - 40 * vt], p2 = [60 - v[0] * 6, 118 - 74 * ease(vt)];
      out += curve(p0, p1, p2, '#3d6e5a', 1.1);
      var m = 2 + Math.floor(vt * 5);
      for (var k = 1; k <= m; k++) {
        var pt = along(p0, p1, p2, k / (m + 0.5));
        out += heart(pt.x, pt.y, (5 + 4 * (1 - k / m)) * ramp(vt, k / m * 0.6, k / m * 0.6 + 0.3), pt.a + (k % 2 ? 75 : -75), 'url(#' + id + 'tk)', '#8fc2b4');
      }
    });
    var bloom = Math.round(ramp(g, 0.5, 0.9) * 3);
    [[45, 66], [74, 54], [58, 40]].slice(0, bloom).forEach(function (pos, i) {
      var open = ramp(g, 0.5 + i * 0.12, 0.8 + i * 0.07), R = 4 + 5 * open;
      out += '<circle cx="' + pos[0] + '" cy="' + pos[1] + '" r="' + f(R * 1.7) + '" fill="url(#' + id + 'glow)" class="plant-glow"/>';
      out += '<circle cx="' + pos[0] + '" cy="' + pos[1] + '" r="' + f(R) + '" fill="#f7faff" stroke="#dce9ff" stroke-width="0.6"/>';
      for (var p = 0; p < 5; p++) {
        var a = (p * 72 - 90) * Math.PI / 180;
        out += '<path d="M' + pos[0] + ' ' + pos[1] + 'L' + f(pos[0] + Math.cos(a) * R * 0.95) + ' ' + f(pos[1] + Math.sin(a) * R * 0.95) + '" stroke="#c9dcfb" stroke-width="0.8" stroke-linecap="round"/>';
      }
      out += '<circle cx="' + pos[0] + '" cy="' + pos[1] + '" r="' + f(R * 0.32) + '" fill="#dbe8ff"/>' +
        '<circle cx="' + pos[0] + '" cy="' + pos[1] + '" r="' + f(R * 0.14) + '" fill="#f5e8a6"/>';
    });
    if (bloom) out += sparkles(r, 4 + bloom * 2, [34, 24, 88, 96], ['#fff3b8', '#d8e8ff', '#ffffff']);
    return out;
  };

  // pads on still water, a stem, and a pink lotus that opens in layers
  DRAW.lotus = function (id, g, r) {
    var out = '', pads = Math.round(ramp(g, 0.06, 0.5) * 3);
    [[42, 119.5, 9], [78, 120, 8], [64, 121.2, 6]].slice(0, pads).forEach(function (p, i) {
      var s = p[2] * ramp(g, 0.06 + i * 0.1, 0.4 + i * 0.1);
      if (s < 0.5) return;
      out += '<ellipse cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" rx="' + f(s) + '" ry="' + f(s * 0.34) + '" fill="url(#' + id + 'l)"/>' +
        '<path d="M' + f(p[0]) + ' ' + f(p[1]) + 'L' + f(p[0] + s * 1.02) + ' ' + f(p[1] - s * 0.12) + 'L' + f(p[0] + s * 1.02) + ' ' + f(p[1] + s * 0.08) + 'Z" fill="#9fcbd3"/>' +
        '<path d="M' + f(p[0] - s * 0.6) + ' ' + f(p[1] - s * 0.05) + 'L' + f(p[0]) + ' ' + f(p[1]) + '" stroke="#bfe0c2" stroke-width="0.5"/>';
    });
    var st = ramp(g, 0.2, 0.6), H = 38 * ease(st);
    if (st <= 0) return out;
    var c = [60, 118 - H];
    out += curve([60, 119], [61, 119 - H * 0.5], c, '#4f8a55', 1.6);
    var open = ramp(g, 0.6, 0.95), bud = ramp(g, 0.42, 0.6);
    if (open > 0) out += '<circle cx="' + c[0] + '" cy="' + f(c[1] - 8) + '" r="' + f(26 * open) + '" fill="url(#' + id + 'pglow)" class="plant-glow"/>';
    if (bud > 0) {
      var rows = [[5, 64 * open + 8, 23, 'url(#' + id + 'lo)'], [4, 34 * open + 6, 26, 'url(#' + id + 'lp)'], [3, 12 * open + 2, 19, 'url(#' + id + 'lo)']];
      rows.forEach(function (row) {
        for (var p = 0; p < row[0]; p++) {
          var a = row[0] === 1 ? 0 : -row[1] + (2 * row[1]) * p / (row[0] - 1);
          out += leaf(c[0], c[1], (row[2] * (0.5 + 0.5 * bud)), row[2] * 0.5, a, row[3]);
        }
      });
      if (open > 0.3) out += '<ellipse cx="' + c[0] + '" cy="' + f(c[1] - 5) + '" rx="' + f(4.4 * open) + '" ry="' + f(2.2 * open) + '" fill="#f4d35e"/>';
    }
    if (open > 0.3) out += sparkles(r, 5, [40, 60, 82, 108], ['#ffe6f0', '#fff3b8']);
    return out;
  };

  // a fern grown in gold, glinting
  DRAW.goldfern = function (id, g, r) {
    return DRAW.fern(id, g, r, { a: 'ga', b: 'gb', stem: '#b98f2e', tip: '#d4af45' }) +
      (g > 0.4 ? sparkles(r, 3 + Math.round(g * 5), [26, 20, 94, 104], ['#fff1b3', '#ffe082', '#ffffff']) : '');
  };

  /* ---------- colour arithmetic, for buds turning ---------- */

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
  function darken(c, t) { return mix(c, '#000000', t); }

  /* ---------- putting it together ---------- */

  // the gradients only some plants need
  function extras(id, kind) {
    var out = '';
    if (kind === 'aloe') out += grad(id + 'aa', [[0, '#6f9f80'], [1, '#a8cdb0']]) + grad(id + 'ab', [[0, '#5e8f72'], [1, '#93bf9d']]);
    if (kind === 'bamboo') out += grad(id + 'bb', [[0, '#8fc06a'], [0.5, '#b7dc8c'], [1, '#86b862']], true);
    if (kind === 'bonsai') out += grad(id + 'tb', [[0, '#6b4b36'], [1, '#9a7457']], true);
    if (kind === 'lily') out += grad(id + 'ws', [[0, '#dfeedd'], [0.35, '#ffffff'], [1, '#fbfdf8']]);
    if (kind === 'moonflower') out += grad(id + 'tk', [[0, '#2f5e57'], [1, '#5f9c8c']]) + radial(id + 'glow', [[0, 'rgba(206,226,255,0.7)'], [1, 'rgba(206,226,255,0)']]);
    if (kind === 'lotus') {
      out += grad(id + 'lp', [[0, '#ee86ab'], [1, '#fde3ee']]) + grad(id + 'lo', [[0, '#f4a2c1'], [1, '#fff4f8']]) +
        radial(id + 'pglow', [[0, 'rgba(255,214,230,0.75)'], [1, 'rgba(255,214,230,0)']]) +
        grad(id + 'wa', [[0, '#7fb6c4'], [1, '#b9dde4']]);
    }
    if (kind === 'goldfern') out += grad(id + 'ga', [[0, '#c9952a'], [1, '#f6d873']]) + grad(id + 'gb', [[0, '#a87a1f'], [1, '#e8c25a']]);
    return out;
  }

  var made = 0;

  function svg(o) {
    o = o || {};
    var kind = KINDS.indexOf(o.kind) === -1 ? pick(o.seed || 'x') : o.kind;
    var g = clamp(Number(o.g) || 0, 0, 1);
    var r = random(String(o.seed || kind) + kind);
    var id = 'pl' + (++made) + '_';
    var style = SPECIAL[kind] || (kind === 'bonsai' ? { body: ['#4d5b66', '#323d46'], rim: '#56646f', line: '#3a464f' }
      : kind === 'lotus' ? { body: ['#f2efe7', '#d9d3c4'], rim: '#efebe2', line: '#cfc8b8' }
      : POTS[hash(String(o.seed || kind) + 'pot') % POTS.length]);
    var defs = palette(id,
      grad(id + 'p', [[0, style.body[0]], [1, style.body[1]]], true) +
      grad(id + 'c', [[0, '#4f9161'], [0.5, '#6fb27c'], [1, '#4c8b5d']], true) +
      grad(id + 'sa', [[0, '#7aa898'], [0.75, '#a9cdbf'], [1, '#e9a3a6']]) +
      grad(id + 'sb', [[0, '#8fb8a7'], [0.8, '#bfdccf'], [1, '#f0b2b2']]) +
      extras(id, kind));
    var plant = sprout(id, g) + (g > 0.06 ? DRAW[kind](id, g, r) : '');
    var trailing = kind === 'pothos' || kind === 'strawberry' || kind === 'lotus';
    var body = kind === 'bonsai' ? tray(id, style) + soil() : kind === 'lotus' ? bowl(id) : pot(id, style) + soil();
    var label = o.label ? ' role="img" aria-label="' + o.label + '"' : ' aria-hidden="true"';
    return '<svg class="plant-svg is-' + tierOf(kind) + '" viewBox="0 0 120 160"' + label + ' data-kind="' + kind + '" data-g="' + f(g) + '">' +
      '<defs>' + defs + '</defs>' +
      (trailing ? body + '<g class="plant-sway">' + plant + '</g>' : '<g class="plant-sway">' + plant + '</g>' + body) + '</svg>';
  }

  /* ---------- trees ---------- */

  var TREE = {};

  function trunk(id, x, base, h, w, colour) {
    return '<path d="M' + f(x - w) + ' ' + f(base) + 'Q' + f(x - w * 0.55) + ' ' + f(base - h * 0.5) + ' ' + f(x - w * 0.35) + ' ' + f(base - h) +
      'L' + f(x + w * 0.35) + ' ' + f(base - h) + 'Q' + f(x + w * 0.55) + ' ' + f(base - h * 0.5) + ' ' + f(x + w) + ' ' + f(base) + 'Z" fill="' + colour + '"/>';
  }

  function blob(cx, cy, R, fill, n, r, jitter) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * (jitter || 0.62);
      out += '<circle cx="' + f(cx + Math.cos(a) * d) + '" cy="' + f(cy + Math.sin(a) * d * 0.8) + '" r="' + f(R * between(r, 0.32, 0.5)) + '" fill="' + (Array.isArray(fill) ? fill[i % fill.length] : fill) + '"/>';
    }
    return out;
  }

  TREE.oak = function (id, g, r) {
    var H = 30 + 70 * g, R = 14 + 26 * g, top = 150 - H;
    return trunk(id, 60, 150, H * 0.62, 3 + g * 4, '#8a6247') +
      curve([60, 150 - H * 0.42], [52, 150 - H * 0.56], [47, top + R * 0.5], '#8a6247', 1.6 + g) +
      curve([60, 150 - H * 0.46], [68, 150 - H * 0.6], [73, top + R * 0.45], '#8a6247', 1.4 + g) +
      blob(60, top + R * 0.55, R, ['#3f7f4f', '#4d9160', '#5aa26b'], 10, r) +
      blob(56, top + R * 0.4, R * 0.75, ['#6db47a', '#7fc18a'], 6, r) +
      blob(52, top + R * 0.25, R * 0.4, '#9ad3a2', 3, r);
  };

  TREE.pine = function (id, g, r) {
    var H = 34 + 74 * g, W = 13 + 20 * g, out = trunk(id, 60, 150, H * 0.2, 2 + g * 2.5, '#7a5640');
    var tiers = 4 + Math.round(g * 2);
    for (var i = 0; i < tiers; i++) {
      var y = 150 - H * 0.16 - i * (H * 0.8 / tiers), w = W * (1 - i / (tiers + 0.6)), h = H * 0.3;
      var fill = i % 2 ? '#2f6b47' : '#3a7c53';
      out += '<path d="M' + f(60 - w) + ' ' + f(y) + 'L' + f(60 - w * 0.5) + ' ' + f(y - h * 0.4) + 'L' + f(60 - w * 0.62) + ' ' + f(y - h * 0.38) +
        'L60 ' + f(y - h) + 'L' + f(60 + w * 0.62) + ' ' + f(y - h * 0.38) + 'L' + f(60 + w * 0.5) + ' ' + f(y - h * 0.4) + 'L' + f(60 + w) + ' ' + f(y) + 'Z" fill="' + fill + '"/>' +
        '<path d="M60 ' + f(y - h * 0.95) + 'L' + f(60 - w * 0.45) + ' ' + f(y - h * 0.1) + '" stroke="#5c9a6e" stroke-width="1" opacity="0.6"/>';
    }
    return out;
  };

  TREE.cherry = function (id, g, r) {
    var H = 30 + 64 * g, R = 15 + 25 * g, top = 150 - H, out = trunk(id, 60, 150, H * 0.6, 3 + g * 3.5, '#6b4a3c');
    out += curve([60, 150 - H * 0.45], [50, 150 - H * 0.62], [43, top + R * 0.55], '#6b4a3c', 1.4 + g) +
      curve([60, 150 - H * 0.5], [71, 150 - H * 0.66], [77, top + R * 0.5], '#6b4a3c', 1.3 + g);
    out += blob(60, top + R * 0.55, R, ['#f3b6c8', '#f7c9d6', '#eea3b9'], 12, r) + blob(56, top + R * 0.35, R * 0.6, '#fbdbe4', 5, r);
    // a few petals on their way down
    for (var i = 0; i < 4; i++) {
      var px = between(r, 60 - R, 60 + R), py = between(r, top + R * 1.4, 147);
      out += '<ellipse cx="' + f(px) + '" cy="' + f(py) + '" rx="1.5" ry="0.9" fill="#f3b6c8" transform="rotate(' + f(between(r, -40, 40)) + ' ' + f(px) + ' ' + f(py) + ')"/>';
    }
    return out;
  };

  TREE.birch = function (id, g, r) {
    var H = 40 + 70 * g, out = trunk(id, 60, 150, H * 0.82, 2.2 + g * 2.2, '#f1efe8');
    for (var y = 146; y > 150 - H * 0.8; y -= between(r, 5, 9)) {
      out += '<path d="M' + f(60 - between(r, 0.5, 2.5)) + ' ' + f(y) + 'l' + f(between(r, 1.5, 3)) + ' 0" stroke="#4a4642" stroke-width="1" stroke-linecap="round"/>';
    }
    out += blob(60, 150 - H * 0.8, 12 + 15 * g, ['#a9cf6e', '#bcdb85', '#94c063'], 12, r, 0.75);
    return out;
  };

  TREE.maple = function (id, g, r) {
    var H = 30 + 66 * g, R = 15 + 24 * g, top = 150 - H, out = trunk(id, 60, 150, H * 0.6, 3 + g * 3.5, '#7a5240');
    out += curve([60, 150 - H * 0.44], [51, 150 - H * 0.6], [45, top + R * 0.5], '#7a5240', 1.4 + g) +
      curve([60, 150 - H * 0.48], [70, 150 - H * 0.62], [75, top + R * 0.45], '#7a5240', 1.3 + g);
    out += blob(60, top + R * 0.55, R, ['#e2733e', '#ea8d45', '#d85c3a', '#f2b04f'], 12, r) + blob(55, top + R * 0.3, R * 0.5, '#f5c46a', 4, r);
    return out;
  };

  // rare: a dome of green with long strands hanging like a curtain
  TREE.willow = function (id, g, r) {
    var H = 34 + 60 * g, R = 16 + 22 * g, top = 150 - H, out = trunk(id, 60, 150, H * 0.7, 3 + g * 3.5, '#7b6248');
    out += blob(60, top + R * 0.5, R, ['#8fc27a', '#a3cf8a', '#7db56c'], 11, r, 0.7);
    for (var i = 0; i < 16; i++) {
      var x = 60 - R * 1.05 + (2.1 * R) * (i / 15) + between(r, -2, 2), y = top + R * (0.55 + 0.35 * Math.sin(i / 15 * Math.PI)), L = between(r, 18, 34) * (0.5 + 0.5 * g);
      out += curve([x, y], [x + between(r, -3, 3), y + L * 0.5], [x + between(r, -4, 4), y + L], i % 2 ? '#86bd70' : '#9ccb84', 1.3);
    }
    return out + blob(56, top + R * 0.3, R * 0.5, '#b9dd9e', 4, r);
  };

  // legendary: a ginkgo turned gold, little fans drifting down
  TREE.ginkgo = function (id, g, r) {
    var H = 34 + 66 * g, R = 16 + 24 * g, top = 150 - H, out = trunk(id, 60, 150, H * 0.62, 3 + g * 3.5, '#7a5a42');
    out += curve([60, 150 - H * 0.44], [50, 150 - H * 0.6], [44, top + R * 0.55], '#7a5a42', 1.4 + g) +
      curve([60, 150 - H * 0.5], [70, 150 - H * 0.64], [76, top + R * 0.5], '#7a5a42', 1.3 + g);
    out += '<circle cx="60" cy="' + f(top + R * 0.55) + '" r="' + f(R * 1.05) + '" fill="url(#' + id + 'gglow)" class="plant-glow"/>';
    var fans = ['#f2c84b', '#e8b13a', '#f7d76b', '#efbe3f'];
    for (var i = 0; i < 46; i++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.95, x = 60 + Math.cos(a) * d, y = top + R * 0.55 + Math.sin(a) * d * 0.8, s = between(r, 2.4, 3.6);
      out += '<path d="M' + f(x) + ' ' + f(y) + 'L' + f(x - s) + ' ' + f(y - s * 1.1) + 'A' + f(s * 1.3) + ' ' + f(s * 1.3) + ' 0 0 1 ' + f(x + s) + ' ' + f(y - s * 1.1) + 'Z" fill="' + fans[i % 4] +
        '" transform="rotate(' + f(between(r, -50, 50)) + ' ' + f(x) + ' ' + f(y) + ')"/>';
    }
    for (var k = 0; k < 5; k++) {
      var fx = between(r, 60 - R * 1.2, 60 + R * 1.2), fy = between(r, top + R * 1.5, 146);
      out += '<path d="M' + f(fx) + ' ' + f(fy) + 'l-2 -2.2a2.8 2.8 0 0 1 4 0z" fill="#f2c84b" transform="rotate(' + f(between(r, -60, 60)) + ' ' + f(fx) + ' ' + f(fy) + ')"/>';
    }
    return out + sparkles(r, 4, [60 - R, top, 60 + R, top + R * 1.4], ['#fff3b8', '#ffffff']);
  };

  function tree(o) {
    o = o || {};
    var kind = TREES.indexOf(o.kind) === -1 ? pickTree(o.seed || 'x') : o.kind;
    var g = clamp(Number(o.g) || 0, 0, 1);
    var r = random(String(o.seed || kind) + kind);
    var id = 'tr' + (++made) + '_';
    var label = o.label ? ' role="img" aria-label="' + o.label + '"' : ' aria-hidden="true"';
    var defs = kind === 'ginkgo' ? '<defs>' + radial(id + 'gglow', [[0, 'rgba(255,226,140,0.4)'], [1, 'rgba(255,226,140,0)']]) + '</defs>' : '';
    return '<svg class="tree-svg is-' + treeTier(kind) + '" viewBox="0 0 120 160"' + label + ' data-kind="' + kind + '">' + defs +
      '<ellipse cx="60" cy="151" rx="' + f(20 + g * 18) + '" ry="3.4" fill="#1f3a26" opacity="0.1"/>' +
      '<g class="plant-sway">' + TREE[kind](id, g, r) + '</g>' +
      '<path d="M' + f(44 - g * 10) + ' 150.5Q60 147.5 ' + f(76 + g * 10) + ' 150.5" stroke="#8cbf87" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  }

  /* ---------- how far a session gets ---------- */

  /* Two hours grows a plant all the way; the first minutes count most, so a
     short session still shows something. Twenty-five minutes is a leafy young
     plant, forty-five has buds, an hour is in flower. */
  var FULL = 120;
  function growthFor(minutes) {
    return clamp(Math.sqrt(Math.max(0, minutes) / FULL), 0, 1);
  }

  /* ---------- how rare ---------- */

  /* Every fifteen minutes of focus -- at 15, 30, 45, an hour, and on -- the
     session rolls once to turn rarer. The rolls come from the seed, so the
     same session always turns out the same way, on every device. Luck (from
     how much you have studied this week, 1 to 1.6) makes the rare and
     legendary chances bigger; it never makes a short session long. */
  var ROLLS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
  var ODDS = { legendary: 0.012, rare: 0.06, uncommon: 0.26 };

  function tierFor(seed, minutes, luck) {
    var r = random(String(seed) + 'rolls'), tier = 0, l = clamp(Number(luck) || 1, 1, 1.6);
    for (var i = 0; i < ROLLS.length && minutes >= ROLLS[i]; i++) {
      var x = r();
      var t = x < ODDS.legendary * l ? 3 : x < (ODDS.legendary + ODDS.rare) * l ? 2 : x < (ODDS.legendary + ODDS.rare) * l + ODDS.uncommon ? 1 : 0;
      if (t > tier) tier = t;
    }
    return tier;
  }

  // what a session has grown into, so far
  function kindFor(seed, minutes, luck) {
    var tier = TIERS[tierFor(seed, minutes || 0, luck)], pool = POOL[tier];
    return pool[hash(String(seed) + 'kind' + tier) % pool.length];
  }

  function pick(seed) { return kindFor(seed, 0, 1); }

  function tierOf(kind) {
    for (var i = TIERS.length - 1; i >= 0; i--) if (POOL[TIERS[i]].indexOf(kind) !== -1) return TIERS[i];
    return 'common';
  }

  function treeTier(kind) {
    return TREE_POOL.legendary.indexOf(kind) !== -1 ? 'legendary' : TREE_POOL.rare.indexOf(kind) !== -1 ? 'rare' : 'common';
  }

  /* A week's five plants make a tree as rare as the rarest of them -- an
     uncommon one does not count, a rare one does -- and five long sessions
     (six hours between them) make at least a rare one on their own. */
  function treeFor(seed, plants) {
    var best = 0, mins = 0;
    (plants || []).forEach(function (p) { best = Math.max(best, TIERS.indexOf(tierOf(p.kind))); mins += p.mins || 0; });
    var tier = best >= 3 ? 'legendary' : best >= 2 || mins >= 360 ? 'rare' : 'common';
    if (tier === 'common') return pickTree(seed);
    var pool = TREE_POOL[tier];
    return pool[hash(String(seed) + 'tree' + tier) % pool.length];
  }

  // a common tree; as it always was, so the trees grown before rarities stay the trees they were
  function pickTree(seed) {
    var kind = OLD_TREES[hash(String(seed) + 'tree') % OLD_TREES.length];
    return TREE_POOL.common.indexOf(kind) === -1 ? TREE_POOL.common[hash(String(seed) + 'tree') % TREE_POOL.common.length] : kind;
  }

  return {
    KINDS: KINDS, TREES: TREES, TIERS: TIERS, POOL: POOL, TREE_POOL: TREE_POOL, ROLLS: ROLLS,
    svg: svg, tree: tree,
    growthFor: growthFor, pick: pick, pickTree: pickTree,
    kindFor: kindFor, tierFor: tierFor, tierOf: tierOf, treeTier: treeTier, treeFor: treeFor,
    name: function (kind) { return NAMES[kind] || 'plant'; }
  };
})();
