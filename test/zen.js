/* Focus mode and counting up. Focus mode is the timer alone, filling the
   screen -- the rest of the desk stepped away, the plant big -- and Esc, the
   cross or the button again brings it all back. Counting up runs from zero
   with no end, the plant growing all the way; finish puts it in the garden
   and starts the break; a length picked between sessions goes back to
   counting down. Both are remembered. */
const { chromium } = require('./browser');
const MIN = 60 * 1000;

(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|fullscreen/i.test(t)) errs.push('CON: ' + t); });
  await p.clock.install({ time: new Date(2026, 10, 16, 16, 0) });
  await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
  const face = () => p.evaluate(() => document.getElementById('countdown').textContent);
  const hidden = sel => p.evaluate(s => getComputedStyle(document.querySelector(s)).display === 'none', sel);

  console.log('--- counting up ---');
  await p.click('#countUp'); await p.clock.runFor(300);
  check('it starts from nothing', [await face(), await p.evaluate(() => document.getElementById('countUp').getAttribute('aria-pressed'))], ['0:00', 'true']);
  check('no length is picked', await p.evaluate(() => document.querySelectorAll('#presets [aria-current="true"]').length), 0);
  await p.click('#startPause'); await p.clock.runFor(500);
  await p.clock.fastForward(10 * MIN); await p.clock.runFor(1200);
  check('ten minutes in, it says ten minutes', /^10:0\d$/.test(await face()), true);
  check('the button beside pause finishes it', await p.evaluate(() => document.getElementById('reset').textContent), 'finish');
  await p.clock.fastForward(130 * MIN); await p.clock.runFor(1500);
  check('past two hours it is still going, and the plant is fully grown', [/^2:20:0\d$/.test(await face()), await p.evaluate(() => document.body.dataset.status),
    await p.evaluate(() => +document.querySelector('#potNow svg').dataset.g)], [true, 'running', 1]);
  check('a length cannot be picked in the middle of it', await (async () => {
    await p.locator('#presets button', { hasText: '45' }).click(); await p.clock.runFor(300);
    return p.evaluate(() => [document.getElementById('countUp').getAttribute('aria-pressed'), document.body.dataset.status]); })(), ['true', 'running']);
  await p.click('#reset'); await p.clock.runFor(800);
  check('finish: the plant goes into the garden, as long as the session was', await p.evaluate(() => Garden.last().mins), 140);
  check('and the break begins, counting down', [await p.evaluate(() => document.body.dataset.mode), /^(10:00|9:5\d)$/.test(await face())], ['break', true]);
  await p.click('#reset'); await p.clock.runFor(500);
  check('the next session counts up again', await face(), '0:00');

  console.log('\n--- too short to grow ---');
  await p.click('#startPause'); await p.clock.runFor(500);
  await p.clock.fastForward(2 * MIN); await p.clock.runFor(1000);
  await p.click('#reset'); await p.clock.runFor(500);
  check('two minutes, finished: nothing grown, no break', [await p.evaluate(() => Garden.count()), await p.evaluate(() => document.body.dataset.mode), await face()],
    [1, 'focus', '0:00']);

  console.log('\n--- remembered ---');
  await p.reload(); await p.clock.runFor(1500);
  check('after a reload it still counts up', [await face(), await p.evaluate(() => document.getElementById('countUp').getAttribute('aria-pressed'))], ['0:00', 'true']);
  await p.locator('#presets button', { hasText: '45' }).click(); await p.clock.runFor(300);
  check('picking a length between sessions goes back to counting down', [await face(),
    await p.evaluate(() => document.getElementById('countUp').getAttribute('aria-pressed'))], ['45:00', 'false']);

  console.log('\n--- focus mode ---');
  await p.click('#zenBtn'); await p.clock.runFor(800);
  check('the rest of the desk steps away', [await hidden('.top'), await hidden('.plan-card'), await hidden('.tasks-card')], [true, true, true]);
  check('the timer fills the screen', await p.evaluate(() => { const r = document.querySelector('.bar').getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }), [0, 0, 1280, 820]);
  check('with the plant big in the middle', await p.evaluate(() => document.getElementById('potNow').getBoundingClientRect().height > 820 * 0.35), true);
  check('and only what a session needs', [await hidden('.sill'), await hidden('.timer-lengths'), await hidden('.today-line'), await hidden('#zenExit')],
    [true, true, true, false]);
  await p.click('#startPause'); await p.clock.runFor(800);
  check('start works from here', await p.evaluate(() => document.body.dataset.status), 'running');
  await p.click('#potNow'); await p.clock.runFor(400);
  check('the plant is just the plant here: no garden', await p.evaluate(() => document.body.classList.contains('garden-open')), false);
  await p.keyboard.press('Escape'); await p.clock.runFor(400);
  check('Esc brings the desk back, still running', [await hidden('.tasks-card'), await p.evaluate(() => document.body.dataset.status)], [false, 'running']);
  await p.keyboard.press('f'); await p.clock.runFor(400);
  check('f goes back in', await p.evaluate(() => document.body.classList.contains('zen')), true);
  await p.click('#zenExit'); await p.clock.runFor(400);
  check('and the cross comes out', await p.evaluate(() => document.body.classList.contains('zen')), false);
  await p.click('#menuBtn'); await p.click('#fullBtn'); await p.clock.runFor(400);
  check('the menu has it as well', await p.evaluate(() => document.body.classList.contains('zen')), true);
  await p.keyboard.press('Escape'); await p.clock.runFor(300);

  console.log('\n--- on a phone ---');
  const q = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  q.on('pageerror', e => errs.push('PHONE: ' + e.message));
  await q.goto('http://127.0.0.1:8899/app/'); await q.waitForTimeout(1200);
  await q.click('#zenBtn'); await q.waitForTimeout(700);
  check('it fits a phone, nothing off the edge', await q.evaluate(() => {
    const els = ['#potNow', '#countdown', '#startPause', '#zenExit'].map(s => document.querySelector(s).getBoundingClientRect());
    return els.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight); }), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
