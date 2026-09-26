const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport:{width:450,height:954} })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(t)) errs.push('CONSOLE: ' + t); });
  const step = async (name, fn) => { const n = errs.length; try { await fn(); } catch (e) { errs.push('STEP ' + name + ': ' + e.message); }
    await p.waitForTimeout(180); if (errs.length > n) console.log('  ! during', name); };

  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(600);

  await step('add tasks', async () => {
    for (const t of ['PHY Mastering','MSB Reading','EXTRA OTIS','LATIN Vocab','WELL Run']) {
      await p.fill('#taskInput', t); await p.press('#taskInput','Enter'); await p.waitForTimeout(70); }
  });
  await step('paste panel', async () => { await p.click('#bulkBtn'); await p.waitForTimeout(200);
    await p.fill('#addPanel textarea', 'ART Sketch\nCLUB Meeting'); await p.click('#addPanel button'); });
  await step('new list', async () => { await p.click('#listBtn'); await p.waitForTimeout(200);
    await p.fill('#addPanel input', 'Personal'); await p.press('#addPanel input','Enter'); });
  await step('switch view', async () => { await p.locator('.views button').nth(1).click(); await p.locator('.views button').first().click(); });
  await step('tag filter', async () => { await p.locator('.chip').first().click(); await p.locator('.chip-clear').click(); });
  await step('open editor', async () => { await p.locator('.task-body').first().click(); });
  await step('repeat chips', async () => { for (const r of ['every day','weekdays','weekly','once'])
    { await p.locator('.pick', { hasText: r }).first().click(); await p.waitForTimeout(160); } });
  await step('set usual time', async () => { await p.locator('.pick', { hasText:'every day' }).first().click(); await p.waitForTimeout(200);
    await p.fill('.edit-grid input[type="time"]','09:00'); await p.fill('.edit-grid input[type="number"]','45'); });
  await step('due date', async () => { await p.fill('.due-words','friday'); await p.locator('.due-words').press('Enter'); });
  await step('how far in', async () => { await p.locator('.edit-grid .pick', { hasText: '50%' }).first().click(); });
  await step('change list', async () => { await p.selectOption('.edit-grid select', { index: 1 }); });
  await step('close editor', async () => { await p.keyboard.press('Escape'); });
  await step('tick done', async () => { await p.locator('.task-tick').first().click(); await p.click('#doneBtn'); await p.click('#doneBtn'); });
  await step('plan a task', async () => { await p.locator('.task-plan').first().click(); });
  await step('type block title', async () => { await p.fill('#blockBar input[type="text"]','Deep work'); await p.waitForTimeout(300); });
  await step('block nudges', async () => { for (const t of ['−15','+15','＋','✓']) {
    const n = p.locator('#blockBar button', { hasText: t }); if (await n.count()) { await n.first().click(); await p.waitForTimeout(140); } } });
  await step('escape bar', async () => { await p.keyboard.press('Escape'); });
  await step('show the hours', async () => { await p.click('#timesBtn'); await p.waitForTimeout(500); });
  await step('open day', async () => { await p.click('#pinBtn'); });
  await step('drag a block', async () => { const bl = p.locator('.block').first();
    if (await bl.count()) { const bx = await bl.boundingBox();
      await p.mouse.move(bx.x + bx.width/2, bx.y + bx.height/2); await p.mouse.down();
      await p.mouse.move(bx.x + bx.width/2, bx.y + bx.height/2 + 60, { steps: 8 }); await p.mouse.up(); } });
  await step('draw a block', async () => { const w = await p.locator('#timelineWrap').boundingBox();
    await p.mouse.move(w.x + w.width*0.6, w.y + 40); await p.mouse.down();
    await p.mouse.move(w.x + w.width*0.6, w.y + 130, { steps: 8 }); await p.mouse.up(); });
  await step('close day', async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); });
  await step('hide the hours', async () => { await p.click('#timesBtn'); await p.waitForTimeout(400); });
  await step('tags view', async () => { await p.click('#tagsBtn'); await p.waitForTimeout(400); await p.click('#tagsBtn'); });
  await step('sort picker', async () => { await p.click('#sortBtn'); await p.waitForTimeout(300);
    await p.locator('#sortPicks .pick').nth(2).click(); await p.click('#sortBtn'); });
  await step('a deadline from the row', async () => {
    await p.locator('.task-due').first().click(); await p.waitForTimeout(300);
    await p.locator('.due-pick .pick').first().click(); });
  await step('day stepping', async () => { await p.click('#dayNext'); await p.click('#dayNext'); await p.click('#dayPrev'); await p.click('#dayLabel'); });
  await step('split on', async () => { await p.click('#splitBtn'); await p.locator('.chip').first().click(); });
  await step('edit inside pane', async () => { await p.locator('#taskList .task-body').first().click(); await p.keyboard.press('Escape'); });
  await step('split off', async () => { await p.click('#splitBtn'); });
  await step('timer', async () => { await p.click('#startPause'); await p.waitForTimeout(400); await p.click('#startPause');
    await p.click('#reset'); await p.locator('#presets button').nth(2).click(); await p.click('#plus'); await p.click('#minus'); });
  await step('tools', async () => { for (const id of ['soundBtn','notifyBtn','petBtn','themeBtn']) {
    const n = p.locator('#' + id); if (await n.count()) { await n.click(); await p.waitForTimeout(150); await n.click(); } } });
  await step('music panel', async () => { const n = p.locator('#musicBtn');
    if (await n.count()) { await n.click(); await p.waitForTimeout(250); await p.keyboard.press('Escape'); } });
  await step('sync panel', async () => { const n = p.locator('#syncBtn');
    if (await n.count()) { await n.click(); await p.waitForTimeout(400); await p.keyboard.press('Escape'); } });
  await step('alarm', async () => { await p.click('#alarmAdd'); await p.waitForTimeout(250); await p.keyboard.press('Escape'); });
  await step('resize', async () => { for (const vp of [{width:380,height:700},{width:1280,height:800},{width:450,height:954}]) {
    await p.setViewportSize(vp); await p.waitForTimeout(300); } });
  await step('reload', async () => { await p.reload(); await p.waitForTimeout(700); });

  console.log('\ntotal errors:', errs.length);
  errs.slice(0, 12).forEach(e => console.log(' -', e));
  console.log('final state ok:', await p.evaluate(() => ({
    tasks: document.querySelectorAll('.task').length,
    fits: document.body.scrollHeight <= innerHeight + 1 })));
  await b.close();
})();
