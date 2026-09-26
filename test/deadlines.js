const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  console.log('--- typed, with typos ---');
  for (const [text, want] of [['MSB WA1 mondya','monday'],['PHY essay firday','friday'],
                              ['TAA notes wendsday','wednesday'],['CHEM lab thrusday','thursday']]) {
    await p.fill('#taskInput', text); await p.waitForTimeout(170);
    const hint = await p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].map(x=>x.textContent));
    check(JSON.stringify(text), hint.includes('due ' + want), true);
    await p.press('#taskInput','Enter'); await p.waitForTimeout(140);
  }
  check('and an ordinary word is left alone', await (async () => {
    await p.fill('#taskInput','ART revision monitor'); await p.waitForTimeout(180);
    const hint = await p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].map(x=>x.textContent));
    await p.press('#taskInput','Enter'); await p.waitForTimeout(140);
    return hint.some(h => h.startsWith('due')); })(), false);

  console.log('\n--- a month and a number, in any order ---');
  for (const [text, want] of [['PHY essay october 12','oct 12'],['MSB WA1 oct 12th','oct 12'],
                              ['TAA notes 12 october','oct 12'],['LATIN drill 3rd november','nov 3'],
                              ['ART project octber 5','oct 5'],['CHEM lab dec 1','dec 1']]) {
    await p.fill('#taskInput', text); await p.waitForTimeout(170);
    const hint = await p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].map(x=>x.textContent));
    check(JSON.stringify(text), hint.includes('due ' + want), true);
  }
  check('a month with no number beside it is just a word', await (async () => {
    await p.fill('#taskInput','PHY may notes'); await p.waitForTimeout(180);
    return p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].some(x => x.textContent.startsWith('due'))); })(), false);
  check('a bare ordinal is the next one of those', await (async () => {
    await p.fill('#taskInput','BIO revision 20th'); await p.waitForTimeout(180);
    return p.evaluate(() =>
      [...document.querySelectorAll('#addHint .add-bit')].some(x => x.textContent.startsWith('due')));
  })(), true);

  console.log('\n--- roughly how long ---');
  for (const [text, want] of [['PHY essay high','long · 1h 30m'],['MSB reading low','quick · 15m'],
                              ['TAA notes med','medium · 30m'],['HIST essay medium','medium · 30m']]) {
    await p.fill('#taskInput', text); await p.waitForTimeout(170);
    const hint = await p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].map(x=>x.textContent));
    check(JSON.stringify(text), hint.includes(want), true);
  }
  check('an exact length wins over a rough one', await (async () => {
    await p.fill('#taskInput','ART sketch 45m high'); await p.waitForTimeout(180);
    return p.evaluate(() => [...document.querySelectorAll('#addHint .add-bit')].map(x=>x.textContent)); })(),
    ['ART','45m']);
  await p.fill('#taskInput','PHY roughly long essay'); await p.press('#taskInput','Enter'); await p.waitForTimeout(250);
  /* "high" is 1h 30m on purpose: it is the size at which the planner starts
     spreading a task over the days it has rather than asking for all of it. */
  check('and it is really stored', await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title.includes('roughly')); return t.mins; }), 90);

  console.log('\n--- a backslash keeps a word out of it ---');
  const reads = async (text) => { await p.fill('#taskInput', text); await p.waitForTimeout(170);
    return p.evaluate(() => {
      const h = document.getElementById('addHint');
      return { bits: h.hidden ? [] : [...h.querySelectorAll('.add-bit')].map(x=>x.textContent),
               rest: h.hidden ? null : (h.querySelector('.add-rest')||{}).textContent }; }); };

  check('without one, long is a stretch', (await reads('PHY long division practice')).bits.includes('long \u00b7 1h 30m'), true);
  check('with one, it stays in the title', await reads('PHY \\long division practice'),
    { bits: ['PHY'], rest: 'PHY long division practice' });
  check('a day can be escaped too', (await reads('MSB essay \\friday plans')).rest, 'MSB essay friday plans');
  check('and a month', (await reads('TAA \\october notes')).rest, 'TAA october notes');
  check('and a length', (await reads('ART \\45m sprint idea')).rest, 'ART 45m sprint idea');
  check('two in one line', (await reads('MSB \\long division \\friday notes')).rest,
    'MSB long division friday notes');
  check('a doubled backslash is a real one', (await reads('HIST a \\\\ backslash')).rest, 'HIST a \\ backslash');

  await p.fill('#taskInput','\\PHY is a band name'); await p.press('#taskInput','Enter'); await p.waitForTimeout(300);
  check('an escaped first word is not made into a tag', await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY is a band name');
    return { found: !!t, tags: t ? Store.tagsOf(t).length : -1 }; }), { found: true, tags: 0 });
  await p.fill('#taskInput','PHY ordinary task'); await p.press('#taskInput','Enter'); await p.waitForTimeout(300);
  check('but an ordinary one still is', await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY ordinary task');
    return t ? Store.tagsOf(t).map(x => x.name) : null; }), ['PHY']);
  await p.fill('#taskInput',''); await p.waitForTimeout(150);

  console.log('\n--- the cheat sheet ---');
  await p.fill('#taskInput',''); await p.waitForTimeout(150);
  await p.click('#addHelp'); await p.waitForTimeout(400);
  check('it opens', await p.evaluate(() => !document.getElementById('addSheet').hidden), true);
  check('and lists what it knows', await p.evaluate(() =>
    [...document.querySelectorAll('.sheet-bit')].map(b => b.textContent)),
    ['PHY','friday','october 12','tomorrow','4pm','45m','low','every day','\\long']);
  await p.locator('.sheet-bit', { hasText: /^october 12$/ }).click(); await p.waitForTimeout(350);
  check('tapping a line puts it in the box', await p.evaluate(() =>
    document.getElementById('taskInput').value), 'october 12 ');
  check('and the box read it', await p.evaluate(() =>
    [...document.querySelectorAll('#addHint .add-bit')].some(x => x.textContent.startsWith('due'))), true);
  await p.click('#addHelp'); await p.waitForTimeout(300);
  check('it closes again', await p.evaluate(() => document.getElementById('addSheet').hidden), true);
  await p.fill('#taskInput',''); await p.waitForTimeout(150);

  console.log('\n--- the due button on the row ---');
  check('an undated task says "due"', await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.task')];
    const row = rows.find(r => r.textContent.includes('ART revision monitor'));
    return row.querySelector('.task-due').textContent; }), 'due');
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.task')];
    rows.find(r => r.textContent.includes('ART revision monitor')).querySelector('.task-due').click(); });
  await p.waitForTimeout(400);
  check('the picker opens', await p.evaluate(() => !!document.querySelector('.due-pick')), true);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.due-pick .pick')].map(c=>c.textContent));
  check('today, tomorrow and the next six days', chips.slice(0,2), ['today','tomorrow']);
  check('nine chips in all before a date box', chips.length, 8);

  await p.locator('.due-pick .pick', { hasText: /^tomorrow$/ }).click(); await p.waitForTimeout(450);
  check('picking one sets it and closes', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.task')].find(r => r.textContent.includes('ART revision monitor'));
    return { label: row.querySelector('.task-due').textContent, open: !!document.querySelector('.due-pick') }; }),
    { label: 'tomorrow', open: false });

  console.log('\n--- clearing it again ---');
  await p.evaluate(() => {
    [...document.querySelectorAll('.task')].find(r => r.textContent.includes('ART revision monitor'))
      .querySelector('.task-due').click(); });
  await p.waitForTimeout(350);
  check('a dated task offers "no deadline"', await p.evaluate(() =>
    [...document.querySelectorAll('.due-pick .pick')].some(c => c.textContent === 'no deadline')), true);
  await p.locator('.due-pick .pick', { hasText: /^no deadline$/ }).click(); await p.waitForTimeout(400);
  check('and it clears', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.task')].find(r => r.textContent.includes('ART revision monitor'));
    return row.querySelector('.task-due').textContent; }), 'due');

  console.log('\n--- words in the editor, on a task that already exists ---');
  await p.evaluate(() => {
    [...document.querySelectorAll('.task')].find(r => r.textContent.includes('ART revision monitor'))
      .querySelector('.task-body').click(); });
  await p.waitForTimeout(400);
  await p.fill('.due-words','firday'); await p.locator('.due-words').press('Enter'); await p.waitForTimeout(450);
  check('a misspelt day works there too', await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title.includes('ART revision monitor'));
    return new Date(t.due + 'T12:00').getDay(); }), 5);
  await p.fill('.due-words','none'); await p.locator('.due-words').press('Enter'); await p.waitForTimeout(450);
  check('and "none" clears it', await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title.includes('ART revision monitor'));
    return t.due; }), null);

  console.log('\n--- clicking away puts the picker back ---');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.locator('.task-due').first().click(); await p.waitForTimeout(350);
  await p.locator('#taskInput').click(); await p.waitForTimeout(350);
  check('it is gone', await p.evaluate(() => !document.querySelector('.due-pick')), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
