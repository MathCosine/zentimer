/* The two bugs that started all this, kept from coming back:
     - task titles the same colour as the paper they are written on
     - clicking to get out of a block editor leaving another block behind   */
const { chromium } = require('./browser');

const CONTRAST = `(() => {
  /* color-mix() computes to color(srgb 0.9 0.94 0.97), whose channels run 0..1 */
  const rgb = s => { const n = (s.match(/[\\d.]+/g) || []).map(Number);
    return /^color\\(/.test(s) ? n.slice(0, 3).map(v => v * 255).concat(n.slice(3)) : n; };
  const lum = c => { const f = c.map(v => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const paper = node => {
    for (let n = node; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c;
    }
    return [255, 255, 255];
  };
  const out = [];
  document.querySelectorAll('.task-title, .queue-title, .tile-task, .aim-name').forEach(n => {
    if (!n.offsetParent) return;
    const a = lum(rgb(getComputedStyle(n).color)), b = lum(paper(n));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    out.push({ what: n.className, text: n.textContent.slice(0, 18), ratio: Math.round(ratio * 10) / 10 });
  });
  return out;
})()`;

(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const seed = p => p.evaluate(() => {
    const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    Store.addTask({ title: 'PHY Mastering Week 5', due: on(1), mins: 45 });
    Store.addTask({ title: 'TAA Research essay', due: on(6), mins: 360 });
    Store.addTask({ title: 'EXTRA OTIS', repeat: 'daily', mins: 30 });
  });

  for (const scheme of ['light', 'dark']) {
    console.log(`--- the writing shows up against the paper (${scheme}) ---`);
    const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(scheme + ': ' + e.message));
    await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1000);
    await seed(p); await p.waitForTimeout(800);

    const lines = await p.evaluate(CONTRAST);
    check('there is something to read', lines.length > 3, true);
    check('and all of it is legible', lines.filter(l => l.ratio < 4.5), []);

    // the tiles too, which draw their own colours
    await p.click('#tagsBtn'); await p.waitForTimeout(600);
    const tiles = await p.evaluate(CONTRAST);
    check('the tag tiles as well', tiles.filter(l => l.ratio < 4.5), []);
    await p.close(); await ctx.close();
  }

  console.log('\n--- clicking out of a block editor is not a new block ---');
  const p = await (await b.newContext({ viewport: { width: 430, height: 950 } })).newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: ' + t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1000);
  await seed(p);
  await p.click('#timesBtn'); await p.waitForTimeout(700);     // show the hours

  const count = () => p.evaluate(() => Store.blocks(Store.dayKey()).length);
  const box = async () => (await p.locator('#timeline').boundingBox());

  /* An empty stretch of timeline that is really on screen: drawing opens the
     day, which makes the strip taller than the window, so a fixed offset from
     its foot ends up outside the viewport and clicks nothing. */
  const emptySpot = () => p.evaluate(() => {
    const tl = document.getElementById('timeline').getBoundingClientRect();
    const taken = [...document.querySelectorAll('#timeline .block')].map(n => n.getBoundingClientRect());
    const x = tl.left + tl.width / 2;
    for (let y = Math.max(tl.top + 10, 10); y < Math.min(tl.bottom - 10, innerHeight - 10); y += 10) {
      if (taken.some(r => y > r.top - 4 && y < r.bottom + 4)) continue;
      const n = document.elementFromPoint(x, y);
      if (n && n.id === 'timeline') return { x: x, y: y };
    }
    return null;
  });

  let bb = await box();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + 60);          // draw one
  await p.waitForTimeout(500);
  check('a press on an empty hour makes one', await count(), 1);
  check('and it opens for editing', await p.evaluate(() =>
    !document.getElementById('blockBar').hidden), true);

  let spot = await emptySpot();
  check('there is empty timeline to click on', !!spot, true);
  await p.mouse.click(spot.x, spot.y);
  await p.waitForTimeout(500);
  check('clicking away just puts the editor down', await count(), 1);
  check('the bar is gone', await p.evaluate(() =>
    document.getElementById('blockBar').hidden), true);

  // and the very next click is a real one again -- the old code ate it
  spot = await emptySpot();
  await p.mouse.click(spot.x, spot.y);
  await p.waitForTimeout(500);
  check('the next press draws again, first time', await count(), 2);

  /* Escape means cancel, so a block you never named goes away again -- but one
     you did name, or one that came from a task, stays put. */
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check('escape on one you never named takes it back', await count(), 1);

  const spot2 = await emptySpot();
  await p.mouse.click(spot2.x, spot2.y); await p.waitForTimeout(400);
  await p.fill('#blockBar input[type="text"]', 'Deep work'); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check('one you named stays', await count(), 2);
  check('with the name on it', await p.evaluate(() =>
    Store.blocks(Store.dayKey()).some(x => x.title === 'Deep work')), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
