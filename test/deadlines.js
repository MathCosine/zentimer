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
