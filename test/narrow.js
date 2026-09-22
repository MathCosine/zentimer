const { chromium } = require('playwright');
const WIDTHS = [260, 280, 300, 320, 360, 380, 412, 430];
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  console.log('--- the app on its own ---');
  for (const w of WIDTHS) {
    const p = await (await b.newContext({viewport:{width:w,height:880}})).newPage();
    p.on('pageerror', e => errs.push(w+': '+e.message));
    await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(700);
    await p.fill('#taskInput','PHY Mastering Week 5'); await p.press('#taskInput','Enter'); await p.waitForTimeout(250);
    const r = await p.evaluate(() => {
      const spill = [];
      document.querySelectorAll('.app *').forEach(n => {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.position === 'fixed') return;
        if (n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0)
          spill.push((n.id || String(n.className).split(' ')[0]) + ' ' + n.clientWidth + '<' + n.scrollWidth);
      });
      const card = document.querySelector('.bar').getBoundingClientRect();
      return { page: document.documentElement.scrollWidth <= innerWidth,
               barInside: card.right <= innerWidth + 1,
               spill: spill.slice(0, 3) };
    });
    check(w + 'px: nothing runs off the side', r, { page: true, barInside: true, spill: [] });
    await p.close();
  }

  console.log('\n--- and inside the frame on the front page ---');
  for (const w of [360, 430, 768, 1280]) {
    const p = await (await b.newContext({viewport:{width:w,height:900}})).newPage();
    p.on('pageerror', e => errs.push('front '+w+': '+e.message));
    await p.goto('http://127.0.0.1:8899/'); await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelector('.front-demo').scrollIntoView());
    await p.waitForTimeout(2200);
    const frame = p.frames().find(f => f.url().includes('/app/'));
    if (!frame) { check(w + 'px: the frame loaded', false, true); await p.close(); continue; }
    const r = await frame.evaluate(() => ({
      width: innerWidth,
      fits: document.documentElement.scrollWidth <= innerWidth,
      barInside: document.querySelector('.bar').getBoundingClientRect().right <= innerWidth + 1
    }));
    check(w + 'px page: the desk fits its frame (' + r.width + 'px)', { fits: r.fits, barInside: r.barInside }, { fits: true, barInside: true });
    if (w === 430) await p.screenshot({ path:'./frame-narrow.png' });
    await p.close();
  }

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
