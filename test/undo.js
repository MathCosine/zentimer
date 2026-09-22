const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1200);
  for (const t of ['PHY Mastering','MSB Reading','EXTRA OTIS']) {
    await p.fill('#taskInput',t); await p.press('#taskInput','Enter'); await p.waitForTimeout(90); }

  console.log('--- deleting a task offers it back ---');
  await p.locator('.task-body').first().click(); await p.waitForTimeout(300);
  await p.locator('.task-edit button', { hasText: /delete|remove/i }).first().click();
  await p.waitForTimeout(450);
  check('two left', await p.evaluate(() => document.querySelectorAll('.task').length), 2);
  check('the line says what went', await p.evaluate(() => {
    const u = document.querySelector('.undo-bar'); return u ? u.textContent : null; }), '“PHY Mastering” deletedundo');
  await p.locator('.undo-go').click(); await p.waitForTimeout(450);
  check('undo puts it back', await p.evaluate(() =>
    [...document.querySelectorAll('.task-title')].map(t=>t.textContent).sort()),
    ['EXTRA OTIS','MSB Reading','PHY Mastering']);
  check('and the line goes away', await p.evaluate(() => !document.querySelector('.undo-bar')), true);

  console.log('\n--- without undo, it waits in the bin ---');
  await p.locator('.task-body').first().click(); await p.waitForTimeout(300);
  await p.locator('.task-edit button', { hasText: /delete|remove/i }).first().click();
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.undo-bar')?.remove());
  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  check('the bin lists it', await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.set-title')].map(t=>t.textContent);
    return heads.includes('the bin'); }), true);
  const binned = await p.evaluate(() => {
    const idx = [...document.querySelectorAll('.set-group')].findIndex(g => g.querySelector('.set-title')?.textContent === 'the bin');
    const g = document.querySelectorAll('.set-group')[idx];
    return [...g.querySelectorAll('.set-label span')].map(s => s.textContent); });
  check('with the right thing in it', binned, ['PHY Mastering']);
  check('and how long it has', await p.evaluate(() => {
    const g = [...document.querySelectorAll('.set-group')].find(x => x.querySelector('.set-title')?.textContent === 'the bin');
    return /\d+ days left/.test(g.querySelector('.set-label small').textContent); }), true);

  console.log('\n--- put back from the bin ---');
  await p.locator('.tag-act', { hasText: 'put back' }).first().click(); await p.waitForTimeout(500);
  check('the bin is empty again', await p.evaluate(() =>
    ![...document.querySelectorAll('.set-title')].some(t => t.textContent === 'the bin')), true);
  await p.click('#settingsClose'); await p.waitForTimeout(400);
  check('and the task is back in the list', await p.evaluate(() => document.querySelectorAll('.task').length), 3);

  console.log('\n--- a deleted row stays a row, so the delete can travel ---');
  check('it is a tombstone, not a hole', await p.evaluate(() => {
    const t = Store.tasks()[0];
    Store.removeTask(t.id);
    const raw = Store.state().tasks;
    return { stored: raw.length, buried: raw.filter(r => r.deletedAt).length, shown: Store.tasks().length };
  }), { stored: 3, buried: 1, shown: 2 });

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,6).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
