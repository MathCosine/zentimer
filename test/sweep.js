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
  /* The settings page was never opened here, and it is the busiest page in the
     app: tags, lists, the bin, the day's shape, how full a day is allowed to
     get, and the data buttons. */
  await step('open settings', async () => { await p.click('#settingsBtn'); await p.waitForTimeout(500); });
  await step('a full day', async () => {
    for (const n of await p.locator('#settingsBody .set-number').all()) {
      await n.fill('4'); await n.press('Enter'); await p.waitForTimeout(120); } });
  await step('day bounds', async () => {
    const times = await p.locator('#settingsBody .set-time').all();
    if (times[0]) { await times[0].fill('06:00'); await times[0].press('Enter'); }
    if (times[1]) { await times[1].fill('23:00'); await times[1].press('Enter'); } });
  await step('timer presets', async () => {
    const add = p.locator('#settingsBody .set-add').first();
    if (await add.count()) { await add.click(); await p.waitForTimeout(200); }
    const drop = p.locator('#settingsBody .set-drop').first();
    if (await drop.count()) await drop.click(); });
  await step('toggles and picks', async () => {
    for (const t of (await p.locator('#settingsBody .set-toggle').all()).slice(0, 4)) {
      await t.click(); await p.waitForTimeout(120); await t.click(); }
    const picks = await p.locator('#settingsBody .pick').all();
    if (picks.length) { await picks[picks.length - 1].click(); await p.waitForTimeout(150); } });
  await step('tag rename and colour', async () => {
    const name = p.locator('#settingsBody .tag-name').first();
    await name.fill('PHYSICS'); await name.press('Enter'); await p.waitForTimeout(250);
    await p.locator('#settingsBody .tag-swatch').first().click(); await p.waitForTimeout(250);
    const tone = p.locator('#settingsBody .tone-pick, #settingsBody .tag-tones button').first();
    if (await tone.count()) await tone.click(); });
  await step('a practice tag and a day\u2019s worth', async () => {
    const kind = p.locator('#settingsBody .tag-kind').first();
    await kind.click(); await p.waitForTimeout(300);
    const many = p.locator('#settingsBody .tag-daily').first();
    if (await many.count()) { await many.fill('2'); await many.press('Enter'); await p.waitForTimeout(200); }
    await p.locator('#settingsBody .tag-kind').first().click(); });
  await step('merge, then cancel', async () => {
    await p.locator('#settingsBody .tag-act', { hasText: 'merge' }).first().click(); await p.waitForTimeout(250);
    const cancel = p.locator('#settingsBody .tag-act', { hasText: 'cancel' }).first();
    if (await cancel.count()) await cancel.click(); });
  await step('a new list', async () => {
    const add = p.locator('#settingsBody .set-add.wide').first();
    if (await add.count()) { await add.click(); await p.waitForTimeout(250);
      const box = p.locator('#settingsBody input').last();
      await box.fill('Summer'); await box.press('Enter'); } });
  await step('the bin', async () => {
    const back = p.locator('#settingsBody .tag-act', { hasText: 'put back' }).first();
    if (await back.count()) await back.click(); });
  await step('close settings', async () => { await p.click('#settingsClose'); await p.waitForTimeout(400); });

  await step('reload', async () => { await p.reload(); await p.waitForTimeout(700); });

  console.log('\ntotal errors:', errs.length);
  errs.slice(0, 12).forEach(e => console.log(' -', e));
  console.log('final state ok:', await p.evaluate(() => ({
    tasks: document.querySelectorAll('.task').length,
    fits: document.body.scrollHeight <= innerHeight + 1 })));
  await b.close();
})();
