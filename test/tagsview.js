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
    tasks: [...t.querySelectorAll('.tile-task:not([hidden]) .tile-task-name')].map(x => x.textContent),
    dues: [...t.querySelectorAll('.tile-task:not([hidden]) .tile-task-due')].map(x => x.textContent),
    late: t.classList.contains('is-late') })));
  check('a tile per tag, plus the untagged ones', tiles.map(t => t.name), ['PHY','MSB','no tag']);
  check('it counts what is open', tiles.map(t => t.count), ['3','1','1']);
  check('and lists them, not just the number', tiles[0].tasks.sort(), ['one','three','two']);
  check('the tag is not repeated inside its own tile', tiles[0].tasks.some(t => t.startsWith('PHY')), false);
  check('an overdue one is shown and the tile is marked', { due: tiles[1].dues[0], late: tiles[1].late },
    { due: 'overdue', late: true });

  console.log('\n--- a repeat is due by the end of today ---');
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY two');
    Store.updateTask(t.id, { repeat: 'daily' });
  });
  await p.waitForTimeout(600);
  check('and the tile says so, with no date written on it', await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'PHY');
    const line = [...tile.querySelectorAll('.tile-task')].find(l => l.textContent.includes('two'));
    return line.querySelector('.tile-task-due').textContent; }), 'today');

  console.log('\n--- too many to show ---');
  await seed(p, ['PHY four','PHY five','PHY six','PHY seven','PHY eight','PHY nine','PHY ten',
                 'PHY eleven','PHY twelve','PHY thirteen','PHY fourteen']);
  await p.waitForTimeout(700);
  const packed = await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'PHY');
    const body = tile.querySelector('.tile-tasks');
    return { shown: tile.querySelectorAll('.tile-task:not([hidden])').length,
             more: tile.querySelector('.tile-more').hidden ? null : tile.querySelector('.tile-more').textContent,
             spills: body.scrollHeight > body.clientHeight + 1,
             gridScrolls: (() => { const g = document.getElementById('tagGrid');
               return g.scrollHeight > g.clientHeight + 1; })() }; });
  check('it shows what fits and says how many it could not', packed.more !== null, true);
  check('nothing spills out of the tile', packed.spills, false);
  check('and the grid still does not scroll', packed.gridScrolls, false);

  console.log('\n--- ticking one off without leaving ---');
  const before = await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'PHY');
    const line = tile.querySelector('.tile-task:not([hidden])');
    const name = line.querySelector('.tile-task-name').textContent;
    // the tick says which task by aria-label, so there is no title to reconstruct
    const label = line.querySelector('.tile-tick').getAttribute('aria-label');
    const title = label.replace(/^Mark /, '').replace(/ done$/, '');
    const id = Store.tasks().find(t => t.title === title).id;
    line.querySelector('.tile-tick').click();
    return { count: +tile.querySelector('.tile-count').textContent, name: name, id: id }; });
  await p.waitForTimeout(600);
  check('the count drops by one', await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'PHY');
    return +tile.querySelector('.tile-count').textContent; }), before.count - 1);
  check('and it has left the tile', await p.evaluate((name) => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'PHY');
    return [...tile.querySelectorAll('.tile-task-name')].some(n => n.textContent === name); }, before.name), false);
  // a repeat records today rather than a done flag, so ask the question properly
  check('the task really is done for today', await p.evaluate((id) => {
    const t = Store.state().tasks.find(x => x.id === id);
    return Store.isDone(t, Store.dayKey()); }, before.id), true);
  check('and you stayed in the tiles', await p.evaluate(() =>
    !document.getElementById('tagGrid').hidden), true);

  console.log('\n--- a tick in a tile can be taken back ---');
  await p.evaluate(() => Store.tasks().forEach(t => {
    if (Store.isDone(t, Store.dayKey())) Store.toggleDone(t.id, Store.dayKey()); }));
  await p.waitForTimeout(500);
  await p.locator('.tile-tick').first().click(); await p.waitForTimeout(500);
  check('it says what it just did', await p.evaluate(() => {
    const bar = document.querySelector('.undo-bar');
    return bar ? /ticked off/.test(bar.textContent) : false; }), true);
  check('and one of them is finished', await p.evaluate(() =>
    Store.tasks().filter(t => Store.isDone(t, Store.dayKey())).length), 1);
  await p.locator('.undo-go').click(); await p.waitForTimeout(600);
  check('undo puts it back', await p.evaluate(() =>
    Store.tasks().filter(t => Store.isDone(t, Store.dayKey())).length), 0);

  console.log('\n--- a tile is a way in ---');
  await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'MSB');
    tile.querySelector('.tile-head').click(); });
  await p.waitForTimeout(600);
  check('the header filters to that tag', await p.evaluate(() => ({
    grid: document.getElementById('tagGrid').hidden,
    titles: [...document.querySelectorAll('.task-title')].map(t => t.textContent) })),
    { grid: true, titles: ['MSB only one'] });

  await p.click('#tagsBtn'); await p.waitForTimeout(500);
  await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.tag-tile')].find(t => t.querySelector('.tile-name').textContent === 'MSB');
    tile.querySelector('.tile-task:not([hidden]) .tile-open').click(); });
  await p.waitForTimeout(600);
  check('and a task goes straight to that task, open', await p.evaluate(() => ({
    grid: document.getElementById('tagGrid').hidden,
    editing: !!document.querySelector('.task.is-editing') })), { grid: true, editing: true });

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
