const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const titles = p => p.evaluate(() => [...document.querySelectorAll('.task-title')].map(t=>t.textContent).sort());

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1200);
  for (const t of ['PHY Mastering Week 5','PHY Workbook','MSB Reading','EXTRA OTIS','LATIN Translation','ANALYSIS Quiz'])
    { await p.fill('#taskInput',t); await p.press('#taskInput','Enter'); await p.waitForTimeout(80); }

  console.log('--- finding ---');
  await p.click('#findBtn'); await p.waitForTimeout(350);
  check('the box opens and takes focus', await p.evaluate(() =>
    !document.getElementById('findRow').hidden && document.activeElement.id === 'findInput'), true);
  await p.fill('#findInput','phy'); await p.waitForTimeout(400);
  check('matches by title', await titles(p), ['PHY Mastering Week 5','PHY Workbook']);
  check('and says how many', await p.evaluate(() => {
    const h = document.querySelector('.pane-head'); return h ? h.textContent : null; }), 'found2');
  await p.fill('#findInput','phy week'); await p.waitForTimeout(400);
  check('every word has to match', await titles(p), ['PHY Mastering Week 5']);
  await p.fill('#findInput','latin'); await p.waitForTimeout(400);
  check('matches by tag too', await titles(p), ['LATIN Translation']);
  await p.fill('#findInput','zzz'); await p.waitForTimeout(400);
  check('and says when nothing does', await p.evaluate(() => document.querySelector('.task-empty').textContent), 'nothing matches “zzz”');

  // searching reaches past the list you happen to be on
  await p.fill('#findInput',''); await p.waitForTimeout(200);
  await p.locator('.views button').nth(1).click(); await p.waitForTimeout(300);
  await p.fill('#findInput','otis'); await p.waitForTimeout(400);
  check('it looks past the current list', await titles(p), ['EXTRA OTIS']);
  await p.locator('.views button').first().click(); await p.waitForTimeout(200);

  await p.press('#findInput','Escape'); await p.waitForTimeout(400);
  check('escape puts it away and everything is back', (await titles(p)).length, 6);

  console.log('\n--- the week ---');
  await p.locator('.task-plan').first().click(); await p.waitForTimeout(500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('#weekBtn'); await p.waitForTimeout(600);
  check('seven days', await p.evaluate(() => document.querySelectorAll('.week-day').length), 7);
  check('the day view steps aside', await p.evaluate(() => document.getElementById('timelineWrap').hidden), true);
  check('today is marked', await p.evaluate(() => document.querySelectorAll('.week-day.is-today').length), 1);
  check('the block is on a day', await p.evaluate(() => document.querySelectorAll('.week-block').length), 1);

  const before = await p.evaluate(() => {
    const b = Store.state().blocks.find(x => !x.deletedAt); return b.date; });
  const cols = await p.evaluate(() => [...document.querySelectorAll('.week-day')].map(c => c.dataset.date));
  const target = cols.find(d => d !== before);
  const chip = await p.locator('.week-block').first().boundingBox();
  const col = await p.locator(`.week-day[data-date="${target}"]`).boundingBox();
  await p.mouse.move(chip.x + chip.width/2, chip.y + chip.height/2);
  await p.mouse.down();
  await p.mouse.move(col.x + col.width/2, col.y + 80, { steps: 10 });
  await p.waitForTimeout(250);
  check('the day it would land on lights up', await p.evaluate(() => !!document.querySelector('.week-day.is-target')), true);
  await p.mouse.up(); await p.waitForTimeout(600);
  check('dropping moves it to that day', await p.evaluate(() => {
    const b = Store.state().blocks.find(x => !x.deletedAt); return b.date; }), target);

  const monday = await p.evaluate(() => document.querySelector('.week-day').dataset.date);
  await p.locator('.week-head').first().click(); await p.waitForTimeout(500);
  check('a day heading leaves the week for that day', await p.evaluate(() => ({
    weekGone: document.getElementById('weekWrap').hidden,
    showing: Plan.day() })), { weekGone: true, showing: monday });

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,6).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
