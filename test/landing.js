const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  for (const vp of [{width:1280,height:900},{width:430,height:900}]) {
    const p = await (await b.newContext({viewport:vp})).newPage();
    p.on('pageerror', e => errs.push(vp.width+' PAGE: '+e.message));
    p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push(vp.width+' CON: '+t); });
    await p.goto('http://127.0.0.1:8899/'); await p.waitForTimeout(900);
    check(vp.width+': no pricing words anywhere', await p.evaluate(() =>
      /start free|free forever|upgrade|pricing|per month|trial/i.test(document.body.innerText)), false);
    check(vp.width+': it says it is free', await p.evaluate(() =>
      /free, and staying that way/i.test(document.body.innerText)), true);
    check(vp.width+': no sideways scroll', await p.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    if (vp.width === 1280) {
      await p.evaluate(() => document.querySelector('.front-demo').scrollIntoView());
      await p.waitForTimeout(2500);
      const frame = p.frames().find(f => f.url().includes('/app/'));
      check('the demo frame is the real desk', !!frame && await frame.evaluate(() => !!document.getElementById('taskInput')), true);
      if (frame) {
        await frame.fill('#taskInput', 'PHY typed in the demo');
        await frame.press('#taskInput','Enter'); await p.waitForTimeout(500);
        check('you can type in it', await frame.evaluate(() => document.querySelectorAll('.task').length), 1);
      }
      await p.screenshot({ path:'./test/shots/landing-wide.png', fullPage:true });
    } else {
      await p.screenshot({ path:'./test/shots/landing-narrow.png' });
    }
    await p.close();
  }

  console.log('\n--- the app still works at its new address ---');
  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('APP: '+e.message));
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1000);
  await p.fill('#taskInput','MSB Reading'); await p.press('#taskInput','Enter'); await p.waitForTimeout(300);
  check('tasks still add', await p.evaluate(() => document.querySelectorAll('.task').length), 1);
  check('stylesheet resolved', await p.evaluate(() =>
    getComputedStyle(document.querySelector('.card')).borderRadius !== '0px'), true);
  check('scripts resolved', await p.evaluate(() => !!(window.Store && window.Plan && window.Sync && window.Panel)), true);

  console.log('\n--- the sign-in link opens the panel ---');
  await p.goto('http://127.0.0.1:8899/app/#sign-in'); await p.waitForTimeout(1400);
  check('panel open, hash tidied', await p.evaluate(() => ({
    open: !document.getElementById('syncPop').hidden, hash: location.hash })), { open:true, hash:'' });

  console.log('\n--- the privacy page ---');
  await p.goto('http://127.0.0.1:8899/privacy.html'); await p.waitForTimeout(500);
  check('it says how to delete', await p.evaluate(() => /delete account/i.test(document.body.innerText)), true);
  check('and how to export', await p.evaluate(() => /export/i.test(document.body.innerText)), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,6).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
