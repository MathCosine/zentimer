const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  const seed = async (p, tasks) => { for (const t of tasks) {
    await p.fill('#taskInput', t); await p.press('#taskInput','Enter'); await p.waitForTimeout(65); } };

  console.log('--- it fits, however many tags there are ---');
  for (const [n, width] of [[4,430],[8,430],[12,430],[12,380],[8,300]]) {
    const p = await (await b.newContext({viewport:{width,height:900}})).newPage();
    p.on('pageerror', e => errs.push(`${n}@${width}: ` + e.message));
    await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(900);
    const names = ['PHY','MSB','TAA','LATIN','ANALYSIS','WELL','EXTRA','CHEM','BIO','HIST','GEO','ART'];
    await seed(p, names.slice(0, n).map((t,i) => t + ' task ' + i));
    await p.click('#tagsBtn'); await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const g = document.getElementById('tagGrid');
      const last = g.lastElementChild.getBoundingClientRect();
      const box = g.getBoundingClientRect();
      return { tiles: g.children.length,
               scrolls: g.scrollHeight > g.clientHeight + 1,
               lastInside: last.bottom <= box.bottom + 1 && last.right <= box.right + 1,
               listHidden: document.getElementById('taskList').hidden,
               pageFits: document.body.scrollHeight <= innerHeight + 1 };
    });
    check(`${n} tags at ${width}px: all on screen, nothing scrolls`, r,
      { tiles: n, scrolls: false, lastInside: true, listHidden: true, pageFits: true });
    await p.close();
  }

  console.log('\n--- what a tile tells you ---');
  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(900);
  await seed(p, ['PHY one','PHY two','PHY three','MSB only one','a task with no tag at all']);
  await p.evaluate(() => {
    const late = new Date(); late.setDate(late.getDate() - 3);
    const t = Store.tasks().find(x => x.title === 'MSB only one');
    Store.updateTask(t.id, { due: Store.dayKey(late) });
  });
  await p.waitForTimeout(500);
  await p.click('#tagsBtn'); await p.waitForTimeout(600);

  const tiles = await p.evaluate(() => [...document.querySelectorAll('.tag-tile')].map(t => ({
    name: t.querySelector('.tile-name').textContent,
    count: t.querySelector('.tile-count').textContent,
    when: t.querySelector('.tile-when').textContent,
    late: t.classList.contains('is-late') })));
  check('a tile per tag, plus the untagged ones', tiles.map(t => t.name), ['PHY','MSB','no tag']);
  check('it counts what is open', tiles.map(t => t.count), ['3','1','1']);
  check('an overdue tag says so and is marked', { when: tiles[1].when, late: tiles[1].late }, { when: '1 late', late: true });
  check('and one with no deadlines says that', tiles[0].when, 'no deadline');

  console.log('\n--- a tile is a way in ---');
  await p.locator('.tag-tile', { hasText: 'PHY' }).first().click(); await p.waitForTimeout(600);
  check('it goes back to the list, filtered to that tag', await p.evaluate(() => ({
    grid: document.getElementById('tagGrid').hidden,
    titles: [...document.querySelectorAll('.task-title')].map(t => t.textContent).sort() })),
    { grid: true, titles: ['PHY one','PHY three','PHY two'] });

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
