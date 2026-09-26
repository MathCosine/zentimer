const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const aim = p => p.evaluate(() => {
    const a = document.getElementById('aim');
    if (a.hidden) return null;
    return { lines: [...a.querySelectorAll('.aim-line')].map(l => ({
        name: l.querySelector('.aim-name').textContent,
        num: l.querySelector('.aim-num').textContent,
        met: l.classList.contains('is-met'),
        over: l.classList.contains('is-over') })),
      warn: a.querySelector('.aim-warn') ? a.querySelector('.aim-warn').textContent : null,
      clear: a.querySelector('.aim-clear') ? a.querySelector('.aim-clear').textContent : null }; });

  const p = await (await b.newContext({viewport:{width:440,height:1000}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  console.log('--- nothing due, nothing asked of you ---');
  check('it stays out of the way', await aim(p), null);

  console.log('--- work is spread to finish two days early ---');
  await p.evaluate(() => {
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    /* Six hours due in six days. Finishing two days early means it has to be
       done by day four, and today is one of those days, so five days share it. */
    Store.addTask({ title: 'MSB Big project', due: on(6), mins: 360 });
  });
  await p.waitForTimeout(800);
  check('six hours over five days is seventy minutes', (await aim(p)).lines[0].num, '1h 10m to go');

  console.log('--- something due tomorrow is all today ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    const d = new Date(); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'PHY Essay', due: Store.dayKey(d), mins: 90 });
  });
  await p.waitForTimeout(800);
  check('no room to spread it, so all of it', (await aim(p)).lines[0].num, '1h 30m to go');

  console.log('--- practice is a day’s worth, not a deadline ---');
  await p.evaluate(() => {
    ['USACO','OTIS','Physics','SAT'].forEach(n =>
      Store.addTask({ title: 'EXTRA ' + n, repeat: 'daily', mins: 30 }));
    const t = Store.tags().find(x => x.name === 'EXTRA');
    Store.setTagKind(t.id, 'practice', 2);
  });
  await p.waitForTimeout(800);
  const both = await aim(p);
  check('two rows now', both.lines.map(l => l.name), ['homework','practice']);
  check('two of the four drills is an hour', both.lines[1].num, '1h to go');

  console.log('--- doing the work fills the bar ---');
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Essay');
    Store.logTime(t.id, null, 90 * 60000); });
  await p.waitForTimeout(800);
  const after = await aim(p);
  check('homework reads done', { num: after.lines[0].num, met: after.lines[0].met }, { num: 'done ✓', met: true });
  check('practice still waiting', after.lines[1].met, false);
  check('and it does not say you are finished yet', after.clear, null);

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'EXTRA USACO');
    Store.logTime(t.id, null, 60 * 60000); });
  await p.waitForTimeout(800);
  check('with both met it says so', (await aim(p)).clear, 'deadlines are covered — the rest is yours');

  console.log('--- and when the day is asking too much ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    const d = new Date(); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'MSB Enormous', due: Store.dayKey(d), mins: 480 });
  });
  await p.waitForTimeout(800);
  const heavy = await aim(p);
  check('the row is marked', heavy.lines[0].over, true);
  check('and it says what to do about it', heavy.warn,
    'more than a day holds — push something back or accept a late one');

  console.log('--- the ceiling is yours to set ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(700);
  check('it shows the hours', await p.evaluate(() => {
    const g = [...document.querySelectorAll('.set-group')].find(x =>
      x.querySelector('.set-title') && x.querySelector('.set-title').textContent === 'a full day');
    return [...g.querySelectorAll('.set-number')].map(i => i.value); }), ['5.5','4']);
  await p.evaluate(() => {
    const g = [...document.querySelectorAll('.set-group')].find(x =>
      x.querySelector('.set-title') && x.querySelector('.set-title').textContent === 'a full day');
    const input = g.querySelector('.set-number');
    input.value = '9'; input.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(700);
  await p.click('#settingsClose'); await p.waitForTimeout(600);
  check('raising it clears the warning', (await aim(p)).warn, null);
  await p.reload(); await p.waitForTimeout(1200);
  check('and it is remembered', await p.evaluate(() => Plan.caps().work), 540);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
