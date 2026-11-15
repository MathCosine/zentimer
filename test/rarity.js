/* Rare plants, and the collection. Every fifteen minutes of a session is a
   roll for something rarer, so a long session finds them more often, and a
   week of study adds luck. A plant can turn rarer while you watch, and says
   so -- once, not again on a reload. What it turned into is what goes into
   the garden. Rare plants grow rarer trees. The collection shows every kind:
   the ones found, full grown, with how many; the rest only as shapes. */
const { chromium } = require('./browser');
const MIN = 60 * 1000;
const AT = new Date(2026, 10, 18, 16, 0);               // a Wednesday afternoon

(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  async function page(init) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('PAGE: ' + e.message));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push('CON: ' + t); });
    await p.clock.install({ time: AT });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
    return p;
  }

  const a = await page();

  console.log('--- the odds ---');
  const odds = await a.evaluate(() => {
    const share = (mins, luck) => { const c = [0, 0, 0, 0]; for (let i = 0; i < 4000; i++) c[Plants.tierFor('o' + i, mins, luck)]++; return c.map(n => n / 4000); };
    return { none: share(14, 1.6), short: share(25, 1), long: share(120, 1), lucky: share(120, 1.6) };
  });
  check('under fifteen minutes, always an everyday plant', odds.none[0], 1);
  check('a short session is mostly everyday, legendary very rare', [odds.short[0] > 0.55, odds.short[3] < 0.03], [true, true]);
  check('a two-hour session finds rare ones far more often', [odds.long[2] + odds.long[3] > 0.3, odds.long[0] < 0.1], [true, true]);
  check('and luck makes them likelier still', odds.lucky[2] + odds.lucky[3] > odds.long[2] + odds.long[3] + 0.08, true);
  check('the same seed and minutes are always the same plant', await a.evaluate(() =>
    ['x1', 'x2', 'x3'].every(s => Plants.kindFor(s, 47, 1.2) === Plants.kindFor(s, 47, 1.2))), true);
  check('a plant only ever turns rarer as a session goes on', await a.evaluate(() => {
    for (let i = 0; i < 400; i++) { let t = 0; for (let m = 0; m <= 240; m += 5) { const n = Plants.tierFor('m' + i, m, 1); if (n < t) return false; t = n; } }
    return true; }), true);
  check('every kind draws cleanly at every size', await a.evaluate(() => {
    const bad = [];
    Plants.KINDS.forEach(k => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].forEach(g => { const s = Plants.svg({ kind: k, seed: 'd', g }); if (/NaN|undefined/.test(s)) bad.push(k + g); }));
    Plants.TREES.forEach(k => [0.3, 0.6, 1].forEach(g => { const s = Plants.tree({ kind: k, seed: 'd', g }); if (/NaN|undefined/.test(s)) bad.push(k + g); }));
    return bad; }), []);
  check('nineteen plants and seven trees, in four rarities', await a.evaluate(() => [Plants.KINDS.length, Plants.TREES.length,
    Plants.TIERS.map(t => Plants.POOL[t].length)]), [19, 7, [7, 6, 3, 3]]);

  // a seed that is an everyday plant for its first quarter hour and rare after it
  const S = await a.evaluate(() => {
    for (let i = 0; ; i++) { const s = 'turn' + i;
      if (Plants.tierFor(s, 14, 1) === 0 && Plants.tierFor(s, 15, 1) === 2 && Plants.tierFor(s, 30, 1) === 2) return s; }
  });

  console.log('\n--- turning rarer while you watch ---');
  const t = await page(`(() => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('pip.state.v1', JSON.stringify({ mode: 'focus', status: 'idle', seed: ${JSON.stringify(S)}, grown: 0, luck: 1 })); })()`);
  const pot = () => t.evaluate(() => { const s = document.querySelector('#potNow svg'); return { kind: s.dataset.kind, tier: document.getElementById('potNow').dataset.tier }; });
  const toast = () => t.evaluate(() => { const x = [...document.querySelectorAll('.toast-text')].pop(); return x ? x.textContent : null; });
  const want = await t.evaluate(s => ({ before: Plants.kindFor(s, 10, 1), after: Plants.kindFor(s, 16, 1) }), S);
  await t.click('#startPause'); await t.clock.runFor(800);
  await t.clock.fastForward(10 * MIN); await t.clock.runFor(1500);
  check('ten minutes in, an everyday plant', await pot(), { kind: want.before, tier: 'common' });
  check('saying what it is growing', await t.evaluate(() => document.getElementById('timerDoing').textContent), 'growing ' + (/^[aeiou]/.test(want.before) ? 'an ' : 'a ') + await t.evaluate(k => Plants.name(k), want.before));
  await t.clock.fastForward(6 * MIN); await t.clock.runFor(1500);
  check('past a quarter of an hour, it has turned rare', await pot(), { kind: want.after, tier: 'rare' });
  check('and says so', /^✨ it’s turning rare — an? /.test(await toast()), true);
  check('the words under the timer say it too', /^growing a rare /.test(await t.evaluate(() => document.getElementById('timerDoing').textContent)), true);
  await t.evaluate(() => document.querySelectorAll('.toast').forEach(n => n.remove()));
  await t.reload(); await t.clock.runFor(2000);
  check('a reload keeps it rare, and does not say it again', [await pot(), await toast()], [{ kind: want.after, tier: 'rare' }, null]);
  await t.clock.fastForward(15 * MIN); await t.clock.runFor(2500);
  check('at the end, the rare one is what goes into the garden', await t.evaluate(() => Garden.last() && Garden.last().kind), want.after);
  check('said with its rarity', /^✨ an? rare .*tall — into your garden$/.test(await toast()), true);

  console.log('\n--- luck ---');
  check('nothing studied, no luck', await a.evaluate(() => Garden.luck()), 1);
  await a.evaluate(() => {
    const day = new Date(); const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const list = [];
    for (let i = 0; i < 6; i++) list.push({ id: 'w' + i, at: Date.now() - (i + 1) * 3600e3, day: key(day), mins: 100, kind: 'fern', task: '' });
    list.push({ id: 'old', at: Date.now() - 30 * 24 * 3600e3, day: '2026-10-19', mins: 600, kind: 'daisy', task: '' });
    localStorage.setItem('pip.garden.v1', JSON.stringify(list));
  });
  await a.reload(); await a.clock.runFor(1500);
  check('ten hours this week: half the luck there is (a month ago does not count)', await a.evaluate(() => Garden.luck()), 1.3);

  console.log('\n--- rarer plants grow rarer trees ---');
  check('five everyday plants: an everyday tree', await a.evaluate(() => Plants.treeTier(Plants.treeFor('t', [1, 2, 3, 4, 5].map(() => ({ kind: 'fern', mins: 30 }))))), 'common');
  check('one rare among them: a rare tree', await a.evaluate(() => Plants.treeTier(Plants.treeFor('t', ['fern', 'fern', 'orchid', 'fern', 'daisy'].map(k => ({ kind: k, mins: 30 }))))), 'rare');
  check('six hours of sessions in it: a rare tree too', await a.evaluate(() => Plants.treeTier(Plants.treeFor('t', [1, 2, 3, 4, 5].map(() => ({ kind: 'fern', mins: 75 }))))), 'rare');
  check('a legendary one: the golden ginkgo', await a.evaluate(() => Plants.treeFor('t', ['fern', 'lotus', 'fern', 'fern', 'fern'].map(k => ({ kind: k, mins: 30 })))), 'ginkgo');
  // what these trees were before there were rarities
  check('an everyday tree is the one it always was', await a.evaluate(() => ['2026-11-02:0:p0', '2026-11-02:1:p1', '2026-11-02:2:p2', '2026-11-02:0:p3', '2026-11-02:0:p6']
    .map(s => Plants.treeFor(s, [1, 2, 3, 4, 5].map(() => ({ kind: 'fern', mins: 30 }))))), ['oak', 'oak', 'birch', 'maple', 'birch']);
  check('a session given a kind keeps it; a made-up one falls back', await a.evaluate(() => {
    const one = Garden.add({ seed: 'given', mins: 20, kind: 'bonsai' }), two = Garden.add({ seed: 'madeup', mins: 20, kind: 'dragonfruit' });
    return [one.plant.kind, Plants.KINDS.indexOf(two.plant.kind) !== -1 && Plants.tierOf(two.plant.kind)]; }), ['bonsai', 'common']);

  console.log('\n--- the collection ---');
  await a.evaluate(() => Garden.open()); await a.clock.runFor(800);
  check('the garden opens on its own tab first', await a.evaluate(() => [...document.querySelectorAll('.g-tab')].map(x => [x.textContent, x.getAttribute('aria-selected')])),
    [['garden', 'true'], ['collection', 'false']]);
  check('a rare plant is marked as one', await a.evaluate(() => [...document.querySelectorAll('.g-shelf .g-plant.is-rare .g-name')].map(n => n.textContent)), ['bonsai']);
  await a.click('.g-tab[data-tab=collection]'); await a.clock.runFor(600);
  const dex = () => a.evaluate(() => ({
    sum: document.querySelector('.g-sum').textContent,
    tiers: [...document.querySelectorAll('.g-tier-head h3')].map(h => h.textContent),
    kinds: document.querySelectorAll('.g-kind').length,
    found: [...document.querySelectorAll('.g-kind:not(.is-unknown)')].map(k => k.dataset.kind + ' ' + k.querySelector('.g-mins').textContent),
    unknown: [...document.querySelectorAll('.g-kind.is-unknown .g-name')].every(n => n.textContent === '?'),
    shapes: [...document.querySelectorAll('.g-kind.is-unknown svg')].every(s => getComputedStyle(s).filter.indexOf('brightness(0)') !== -1),
    luck: document.querySelector('.g-odds').textContent }));
  const d = await dex();
  check('every kind, rarest first', [d.tiers, d.kinds], [['legendary', 'rare', 'uncommon', 'common'], 26]);
  const c = await a.evaluate(() => Garden.collection());
  check('what has grown, and how many times', d.found.sort(), c.plants.concat(c.trees).filter(k => k.count).map(k => k.kind + ' ×' + k.count).sort());
  check('six ferns, a bonsai, a daisy -- and the week’s 500 minutes grew a rare tree', [d.found.some(f => /^fern ×[67]$/.test(f)), d.found.indexOf('bonsai ×1') !== -1,
    d.found.indexOf('daisy ×1') !== -1, c.trees.filter(k => k.count).map(k => k.tier)], [true, true, true, ['rare']]);
  check('how many found', d.sum, d.found.length + ' of 26 found');
  check('the rest are only shapes', [d.unknown, d.shapes], [true, true]);
  check('and it says how the odds work, and the luck', [/^every 15 minutes of a session is a roll for something rarer/.test(d.luck), (d.luck.match(/adds (\d+)% luck/) || [])[1]],
    [true, String(await a.evaluate(() => Math.round((Garden.luck() - 1) * 100)))]);
  await a.reload(); await a.clock.runFor(1500);
  await a.evaluate(() => Garden.open()); await a.clock.runFor(600);
  check('it opens where you left it', await a.evaluate(() => document.querySelector('.g-tab.is-on').dataset.tab), 'collection');
  await a.click('.g-tab[data-tab=garden]'); await a.clock.runFor(400);
  check('and back', await a.evaluate(() => [document.querySelector('.g-tab.is-on').dataset.tab, !!document.querySelector('.g-shelf')]), ['garden', true]);

  const ph = await b.newContext({ viewport: { width: 390, height: 844 } });
  const q = await ph.newPage();
  q.on('pageerror', e => errs.push('PHONE: ' + e.message));
  await q.clock.install({ time: AT });
  await q.goto('http://127.0.0.1:8899/app/'); await q.clock.runFor(1200);
  await q.evaluate(() => { Garden.open('collection'); }); await q.clock.runFor(800);
  check('on a phone the collection fits, three or more to a row', await q.evaluate(() => {
    const tiles = [...document.querySelectorAll('.g-dex')][0].querySelectorAll('.g-kind');
    const tops = new Set([...tiles].map(t => Math.round(t.getBoundingClientRect().top)));
    return [document.documentElement.scrollWidth <= innerWidth, tiles.length / tops.size >= 3]; }), [true, true]);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
