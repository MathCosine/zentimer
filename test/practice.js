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

  console.log('\n--- the name already says what it is for ---');
  check('EXTRA came in as practice, unasked', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return t.kind; }), 'practice');
  check('a class did not', await p.evaluate(() =>
    Store.tags().filter(t => t.name !== 'EXTRA').map(t => t.kind)), ['work','work']);
  check('and a day’s worth defaults to most of it', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return Store.practiceToday(t.id); }),
    { done: 0, want: 3, enough: false, of: 5 });
  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  check('the settings say so too', await p.evaluate(() =>
    [...document.querySelectorAll('.tag-kind')].map(k => k.textContent)), ['practice','subject','subject']);
  const flipExtra = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('.tag-row')]
      .find(r => r.querySelector('.tag-name') && r.querySelector('.tag-name').value === 'EXTRA');
    row.querySelector('.tag-kind').click(); });
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

  console.log('\n--- when there is not time for all of it, a place decides ---');
  await p.evaluate(() => {
    // only drills in the running, so the order is about them and nothing else
    Store.tasks().filter(t => !(/^EXTRA /.test(t.title) && t.repeat === 'daily'))
      .forEach(t => Store.removeTask(t.id));
    ['Reading','Listening'].forEach(n => Store.addTask({ title: 'DRILLS ' + n, repeat: 'daily', mins: 20 }));
    Store.addTask({ title: 'PRACTICE Piano', repeat: 'daily', mins: 25 });
    Store.tasks().forEach(t => { if (Store.isDone(t, Store.dayKey())) Store.toggleDone(t.id, Store.dayKey()); });
  });
  await p.waitForTimeout(800);
  check('the new names are practice too', await p.evaluate(() =>
    Store.tags().filter(t => ['DRILLS','PRACTICE'].indexOf(t.name) !== -1).map(t => t.kind)),
    ['practice','practice']);
  const titles = async () => (await queue(p)).map(r => r.title);
  const first = await titles();

  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  const rankOf = name => p.evaluate(n => {
    const row = [...document.querySelectorAll('.tag-row')]
      .find(r => r.querySelector('.tag-name') && r.querySelector('.tag-name').value === n);
    const sub = row.nextElementSibling;
    return sub && sub.querySelector('.tag-rank') ? sub.querySelector('.tag-rank').textContent : null; }, name);
  const tapRank = name => p.evaluate(n => {
    const row = [...document.querySelectorAll('.tag-row')]
      .find(r => r.querySelector('.tag-name') && r.querySelector('.tag-name').value === n);
    row.nextElementSibling.querySelector('.tag-rank').click(); }, name);

  check('every practice tag starts in no fixed place', await rankOf('DRILLS'), 'any order');
  await tapRank('DRILLS'); await p.waitForTimeout(400);
  check('one tap makes it first', await rankOf('DRILLS'), '1st');
  /* Two taps walk PRACTICE past first place into second -- and DRILLS is
     moved along rather than turfed out, so it is first again. */
  await tapRank('PRACTICE'); await p.waitForTimeout(400);
  await tapRank('PRACTICE'); await p.waitForTimeout(400);
  check('another can be second', await rankOf('PRACTICE'), '2nd');
  check('and the first one kept its place', await rankOf('DRILLS'), '1st');
  await p.click('#settingsClose'); await p.waitForTimeout(700);

  const ranked = await titles();
  check('first place is asked for first', ranked[0], 'DRILLS Reading');
  check('then second place', ranked[1], 'PRACTICE Piano');
  check('and the unplaced one takes what is left', ranked[2].indexOf('EXTRA'), 0);
  check('which is not the order it had before', JSON.stringify(ranked) !== JSON.stringify(first), true);

  await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); Store.setTagRank(t.id, 1); });
  await p.waitForTimeout(700);
  check('a second tag cannot also be first', await p.evaluate(() =>
    Store.tags().filter(t => t.rank === 1).map(t => t.name)), ['EXTRA']);
  check('and the queue follows it', (await titles())[0].indexOf('EXTRA'), 0);

  /* Once first place has had its day's worth, it stops asking and second place
     takes over -- which is the whole point of putting them in an order. */
  await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA');
    Store.tasks().filter(x => (x.tags || []).indexOf(t.id) !== -1)
      .forEach(x => { if (!Store.isDone(x, Store.dayKey())) Store.toggleDone(x.id, Store.dayKey()); }); });
  await p.waitForTimeout(800);
  check('with first place done, second leads', (await titles())[0], 'DRILLS Reading');

  await p.evaluate(() => {
    ['DRILLS','PRACTICE','EXTRA'].forEach(n => {
      const t = Store.tags().find(x => x.name === n); Store.setTagRank(t.id, null); });
    Store.tasks().filter(t => /^(DRILLS|PRACTICE) /.test(t.title)).forEach(t => Store.removeTask(t.id));
    Store.tasks().forEach(t => { if (Store.isDone(t, Store.dayKey())) Store.toggleDone(t.id, Store.dayKey()); });
  });
  await p.waitForTimeout(800);

  console.log('\n--- and the guess is only a guess ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(600);
  await flipExtra(); await p.waitForTimeout(500);
  check('one tap makes it a subject', await p.evaluate(() => {
    const t = Store.tags().find(x => x.name === 'EXTRA'); return [t.kind, t.daily]; }), ['work', null]);
  await p.click('#settingsClose'); await p.waitForTimeout(700);
  await p.reload(); await p.waitForTimeout(1100);
  check('and the choice outlives a reload', await p.evaluate(() =>
    Store.tags().find(x => x.name === 'EXTRA').kind), 'work');
  /* As a subject its daily repeat is an ordinary thing due by the end of today,
     which is the wording a repeat had before any of this existed. */
  await p.evaluate(() => {
    Store.tasks().forEach(t => { if (Store.isDone(t, Store.dayKey())) Store.toggleDone(t.id, Store.dayKey()); }); });
  await p.waitForTimeout(800);
  const back = await queue(p);
  check('the repeat says "today", not "due today"',
    (back.find(r => r.tag === 'EXTRA') || {}).why, 'today');

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
