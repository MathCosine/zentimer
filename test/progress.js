const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const queue = p => p.evaluate(() => {
    const q = document.getElementById('queue');
    if (q.hidden) return null;
    return [...q.querySelectorAll('.queue-row')].map(r => ({
      title: r.querySelector('.queue-title').textContent,
      why: r.querySelector('.queue-why').textContent,
      mins: r.querySelector('.queue-mins').textContent })); });

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  console.log('--- setting how far in you are ---');
  await p.fill('#taskInput','PHY Big essay 2h'); await p.press('#taskInput','Enter'); await p.waitForTimeout(250);
  await p.locator('.task-body').first().click(); await p.waitForTimeout(350);
  const steps = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.edit-grid label')].find(l => l.querySelector('span').textContent === 'how far in');
    return [...row.querySelectorAll('.pick')].map(c => c.textContent); });
  check('four steps offered', steps, ['not started','25%','50%','75%']);
  await p.locator('.pick', { hasText: /^75%$/ }).click(); await p.waitForTimeout(450);
  check('it sticks', await p.evaluate(() => Store.tasks()[0].progress), 75);
  await p.keyboard.press('Escape'); await p.waitForTimeout(350);
  check('the row shows a bar', await p.evaluate(() => {
    const f = document.querySelector('.task-fill'); return f ? f.style.width : null; }), '75%');

  console.log('\n--- what is left, not what it started as ---');
  await p.waitForTimeout(400);
  const q = await queue(p);
  check('a two hour task at 75% needs half an hour', q[0].mins, '30m left');
  check('and says how far in it is', q[0].why, '75% done');

  console.log('\n--- so it fits a gap the whole thing never would ---');
  await p.evaluate(() => {
    const at = Store.minutesNow();
    Store.addBlock({ date: Store.dayKey(), start: at + 40, end: at + 70, title: 'later' });
    Store.addTask({ title: 'MSB Untouched two hours', mins: 120 });
  });
  await p.waitForTimeout(700);
  const tight = await queue(p);
  check('40 minutes free', await p.evaluate(() =>
    document.querySelector('.queue-head span').textContent), '40m free');
  check('the part-done one is offered first', tight[0].title, 'PHY Big essay');
  check('the untouched two-hour one is not', tight.findIndex(r => r.title.includes('Untouched')) > 0 ||
    !tight.some(r => r.title.includes('Untouched')), true);

  console.log('\n--- finishing and unfinishing ---');
  await p.evaluate(() => { const t = Store.tasks().find(x => x.title === 'PHY Big essay'); Store.toggleDone(t.id); });
  await p.waitForTimeout(500);
  check('ticking it off means all of it', await p.evaluate(() =>
    Store.state().tasks.find(t => t.title === 'PHY Big essay').progress), 100);
  await p.evaluate(() => { const t = Store.state().tasks.find(x => x.title === 'PHY Big essay'); Store.toggleDone(t.id); });
  await p.waitForTimeout(500);
  check('unticking does not throw the work away', await p.evaluate(() =>
    Store.state().tasks.find(t => t.title === 'PHY Big essay').progress), 75);

  console.log('\n--- it travels with the task ---');
  check('stored on the row', await p.evaluate(() =>
    JSON.parse(localStorage.getItem('pip.plan.v1')).tasks.some(t => t.progress === 75)), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
