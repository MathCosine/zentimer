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
      why: r.querySelector('.queue-why').textContent })); });

  const p = await (await b.newContext({viewport:{width:430,height:950}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  // five daily EXTRA drills, and some real homework
  await p.evaluate(() => {
    ['USACO','OTIS','Physics','SAT','HMMT'].forEach(n =>
      Store.addTask({ title: 'EXTRA ' + n, repeat: 'daily', mins: 30 }));
    Store.addTask({ title: 'MSB WA1', due: Store.dayKey(), mins: 30 });
    Store.addTask({ title: 'TAA Reading', mins: 30 });
  });
  await p.waitForTimeout(800);

  console.log('--- three suggestions never repeat a tag ---');
  const before = await queue(p);
  check('one per tag, even before any of this', before.map(r => r.tag).sort(), ['EXTRA','MSB','TAA']);
  check('and a date you wrote down outranks a daily repeat', before[0].title, 'MSB WA1');
  check('the repeat says "today", not "due today"', before.find(r => r.tag === 'EXTRA').why, 'today');

  console.log('\n--- a tag can say what it is for ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  check('every tag starts as a subject', await p.evaluate(() =>
    [...document.querySelectorAll('.tag-kind')].map(k => k.textContent)), ['subject','subject','subject']);
  const flipExtra = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('.tag-row')]
      .find(r => r.querySelector('.tag-name') && r.querySelector('.tag-name').value === 'EXTRA');
    row.querySelector('.tag-kind').click(); });
  await flipExtra(); await p.waitForTimeout(500);
  check('EXTRA is practice now', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return t.kind; }), 'practice');
  check('and a day’s worth defaults to most of it', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return Store.practiceToday(t.id); }),
    { done: 0, want: 3, enough: false, of: 5 });
  await p.click('#settingsClose'); await p.waitForTimeout(600);

  console.log('\n--- so the queue stops repeating itself ---');
  const after = await queue(p);
  check('three suggestions, three different tags', after.map(r => r.tag).sort(),
    ['EXTRA','MSB','TAA']);
  check('the real deadline comes first', after[0].title, 'MSB WA1');
  check('and the drill says what it is', after.find(r => r.tag === 'EXTRA').why, 'practice · 0 of 3 today');

  console.log('\n--- doing most of it is enough ---');
  await p.evaluate(() => {
    ['EXTRA USACO','EXTRA OTIS','EXTRA Physics'].forEach(title => {
      const t = Store.tasks().find(x => x.title === title);
      Store.toggleDone(t.id, Store.dayKey()); }); });
  await p.waitForTimeout(800);
  check('three of five done', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return Store.practiceToday(t.id); }),
    { done: 3, want: 3, enough: true, of: 5 });
  check('the other two stop asking', (await queue(p)).some(r => r.tag === 'EXTRA'), false);

  console.log('\n--- but a real deadline on a practice tag is still real ---');
  await p.evaluate(() => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    Store.addTask({ title: 'EXTRA Competition entry', due: Store.dayKey(y), mins: 20 }); });
  await p.waitForTimeout(800);
  check('an overdue one comes back to the top', (await queue(p))[0].title, 'EXTRA Competition entry');
  check('and says so', (await queue(p))[0].why, 'overdue');

  console.log('\n--- turning it back off ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  await flipExtra(); await p.waitForTimeout(500);
  check('it is a subject again', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return [t.kind, t.daily]; }), ['work', null]);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
