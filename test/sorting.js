const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const titles = p => p.evaluate(() => [...document.querySelectorAll('.task-title')].map(t=>t.textContent));

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  // added in this order, with deliberately crossed due dates, tags and times
  for (const t of [
    'ZED Zebra task 12/20 9am',
    'ALPHA Apple task 12/05 7am',
    'ZED Yak task',
    'MID Middle task 12/10 8am'
  ]) { await p.fill('#taskInput', t); await p.press('#taskInput','Enter'); await p.waitForTimeout(120); }

  await p.click('#sortBtn'); await p.waitForTimeout(400);
  check('the picker opens', await p.evaluate(() => !document.getElementById('sortRow').hidden), true);

  const pick = async (label) => {
    await p.locator('#sortPicks .pick', { hasText: new RegExp('^'+label+'$') }).first().click();
    await p.waitForTimeout(350);
  };
  const dirText = () => p.evaluate(() => document.getElementById('sortDir').textContent);

  console.log('\n--- by due date, which is where it starts ---');
  check('soonest first, out of the box', await titles(p), ['ALPHA Apple task','MID Middle task','ZED Zebra task','ZED Yak task']);
  check('and it says which way', await dirText(), '↓ soonest first');
  check('a task with no due date goes last', await titles(p).then(t => t[3]), 'ZED Yak task');
  await pick('due');
  check('picking the one already picked turns it round', await titles(p), ['ZED Zebra task','MID Middle task','ALPHA Apple task','ZED Yak task']);
  check('the label follows', await dirText(), '↑ latest first');
  check('and the undated one still goes last', await titles(p).then(t => t[3]), 'ZED Yak task');

  console.log('\n--- by when it was added ---');
  await pick('added');
  check('oldest first', await titles(p), ['ZED Zebra task','ALPHA Apple task','ZED Yak task','MID Middle task']);
  await p.click('#sortDir'); await p.waitForTimeout(350);
  check('newest first', await titles(p), ['MID Middle task','ZED Yak task','ALPHA Apple task','ZED Zebra task']);
  check('the arrow flipped', await dirText(), '↑ newest first');

  console.log('\n--- by tag, so the same class sits together ---');
  await pick('tag');
  check('grouped by tag, a to z', await titles(p), ['ALPHA Apple task','MID Middle task','ZED Zebra task','ZED Yak task']);
  check('the two ZED ones are adjacent', await p.evaluate(() => {
    const t = [...document.querySelectorAll('.task-title')].map(x=>x.textContent);
    const at = t.map((x,i) => x.startsWith('ZED') ? i : -1).filter(i => i>=0);
    return at[1] - at[0]; }), 1);

  console.log('\n--- by name, and by time of day ---');
  await pick('name');
  check('alphabetical', await titles(p), ['ALPHA Apple task','MID Middle task','ZED Yak task','ZED Zebra task']);
  await pick('time');
  check('earliest first, no-time last', await titles(p), ['ALPHA Apple task','MID Middle task','ZED Zebra task','ZED Yak task']);

  console.log('\n--- it survives a reload ---');
  await p.reload(); await p.waitForTimeout(1100);
  check('the order is remembered', await p.evaluate(() =>
    JSON.parse(localStorage.getItem('pip_view')).sort), 'at');
  check('and so is the direction', await p.evaluate(() =>
    JSON.parse(localStorage.getItem('pip_view')).desc), false);

  console.log('\n--- and it sorts inside each half of a split ---');
  await p.click('#splitBtn'); await p.waitForTimeout(300);
  await p.locator('.chips .chip', { hasText: /^ZED$/ }).first().click(); await p.waitForTimeout(400);
  await p.click('#sortBtn'); await p.waitForTimeout(300);
  await pick('name');
  check('each group alphabetical on its own', await p.evaluate(() => {
    const out = []; let group = null;
    [...document.getElementById('taskList').children].forEach(n => {
      if (n.classList.contains('pane-head')) { group = n.querySelector('b').textContent; out.push('[' + group + ']'); }
      else if (n.querySelector('.task-title')) out.push(n.querySelector('.task-title').textContent);
    });
    return out; }), ['[ZED]','ZED Yak task','ZED Zebra task','[everything else]','ALPHA Apple task','MID Middle task']);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
