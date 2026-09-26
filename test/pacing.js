const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const queue = p => p.evaluate(() => {
    const q = document.getElementById('queue');
    if (q.hidden) return [];
    return [...q.querySelectorAll('.queue-row')].map(r => ({
      title: r.querySelector('.queue-title').textContent,
      tag: (r.querySelector('.queue-tag')||{}).textContent || null,
      why: r.querySelector('.queue-why').textContent,
      mins: r.querySelector('.queue-mins').textContent })); });

  const p = await (await b.newContext({viewport:{width:440,height:1000}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  await p.evaluate(() => {
    const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    // plenty of homework, some practice, and one thing you can tick off fast
    Store.addTask({ title: 'MSB Problem set', due: on(1), mins: 60 });
    Store.addTask({ title: 'MSB Reading', due: on(2), mins: 50 });
    Store.addTask({ title: 'PHY Lab writeup', due: on(1), mins: 55 });
    Store.addTask({ title: 'TAA Email the teacher', due: on(1), mins: 10 });
    ['USACO','OTIS','Physics'].forEach(n =>
      Store.addTask({ title: 'EXTRA ' + n, repeat: 'daily', mins: 30 }));
    const t = Store.tags().find(x => x.name === 'EXTRA');
    Store.setTagKind(t.id, 'practice');
  });
  await p.waitForTimeout(900);

  console.log('--- the three rows are three roles ---');
  const rows = await queue(p);
  check('three of them', rows.length, 3);
  check('work first', rows[0].tag !== 'EXTRA', true);
  check('then a change of gear', rows[1].tag, 'EXTRA');
  check('then something quick to finish on', rows[2].title, 'TAA Email the teacher');
  check('and it says so', rows[2].why, 'quick one');

  console.log('--- a run of quick wins is how an afternoon disappears ---');
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'TAA Email the teacher');
    Store.logTime(t.id, null, 10 * 60000); });      // a short session, just now
  await p.waitForTimeout(900);
  const after = await queue(p);
  check('so it stops offering one straight after', after.some(r => r.why === 'quick one'), false);
  check('and still gives three', after.length, 3);
  check('still alternating', after[1].tag === 'EXTRA' || after[0].tag === 'EXTRA', true);

  console.log('--- a long session earns the next one back ---');
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'MSB Problem set');
    Store.logTime(t.id, null, 45 * 60000); });      // the most recent is a proper stretch
  await p.waitForTimeout(900);
  check('a quick one is on offer again', (await queue(p)).some(r => r.why === 'quick one'), true);

  console.log('--- with no practice at all it does not sulk ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => {
      if (Store.tagsOf(t).some(x => x.kind === 'practice')) Store.removeTask(t.id); }); });
  await p.waitForTimeout(900);
  const noPractice = await queue(p);
  check('it still fills three rows', noPractice.length, 3);
  check('and never repeats a class more than twice', await p.evaluate(() => {
    const tags = [...document.querySelectorAll('.queue-tag')].map(t => t.textContent);
    return tags.every(t => tags.filter(x => x === t).length <= 2); }), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
