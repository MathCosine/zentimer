/* The AI through your own server: a stand-in for the relay on your Supabase project: a messy
   note turned into tasks you approve, "do this first" links, tonight planned
   by it -- and every way that can go wrong being caught: steps for tasks that
   do not exist, a quiz put before its reading, a deadline left out, too many
   minutes, no relay, no allowance left. And when it asks: after things go
   quiet, at most every half hour on its own, never for a tick. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '44444444-4444-4444-4444-444444444444';
const DB = 'http://127.0.0.1:8901';
const AT = new Date(2026, 9, 19, 16, 0);              // a Monday, four in the afternoon
const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());

(async () => {
  const db = await start(8901);
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  async function device() {
    const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
    await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, USER) }));
    // this suite is the AI on your own server; Puter, the default, has test/puter.js
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('pip.ai.v1')) localStorage.setItem('pip.ai.v1', JSON.stringify({ provider: 'relay' }));
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('PAGE: ' + e.message));
    p.on('console', m => { const t = m.text();
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|404|429|502/.test(t)) errs.push('CON: ' + t); });
    await p.clock.install({ time: AT });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(3000);
    return { ctx, p };
  }
  const { ctx, p } = await device();
  const asked = async () => (await post('/__aiAsked')).asked;
  const toast = () => p.evaluate(() => { const t = document.querySelector('.toast-text'); return t ? t.textContent : null; });
  const titles = () => p.evaluate(() => Store.tasks().map(t => t.title));
  const on = n => { const d = new Date(AT); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  console.log('--- before the relay is set up ---');
  await p.fill('#taskInput', 'bio read ch 5 by thu then quiz fri');
  await p.click('#aiAdd'); await p.clock.runFor(800);
  check('it says the AI is not set up yet', await toast(), 'the AI is not set up on this server yet');
  check('nothing was added', await titles(), []);
  check('and the words are still there to add by hand', await p.inputValue('#taskInput'), 'bio read ch 5 by thu then quiz fri');

  console.log('\n--- a messy note, read into cards ---');
  await post('/__ai', {
    parse: { result: { tasks: [
      { title: 'Read chapter 5', tag: 'bio', due: on(3), mins: 42, repeat: null, after: [] },
      { title: 'BIO Chapter 5 quiz', tag: 'BIO', due: on(4), mins: 30, repeat: null, after: ['0'] },
      { title: 'Problem set 3', tag: 'ANALYSIS', due: on(1), mins: 90, repeat: null, after: [] },
      { title: '', tag: null, due: null, mins: null, repeat: null, after: [] },                    // nothing: dropped
      { title: 'Practice essay', tag: 'eng!', due: 'next week', mins: 9999, repeat: 'hourly', after: ['7', 'nope'] }
    ] }, meta: { used: 'gemini', judged: true, heard: ['groq', 'gemini'] } }
  });
  await p.click('#aiAdd'); await p.clock.runFor(1200);
  const cards = () => p.evaluate(() => [...document.querySelectorAll('.ai-card:not(.is-loading)')].map(c => ({
    tag: c.querySelector('.tag') ? c.querySelector('.tag').textContent : null,
    title: c.querySelector('.ai-card-title').value,
    due: c.querySelector('.ai-card-due').value,
    mins: c.querySelector('.ai-card-mins').value,
    after: [...c.querySelectorAll('.is-after')].map(n => n.textContent) })));
  const shown = await cards();
  check('one card per real task', shown.length, 4);
  check('the class is written the way pip writes tags', shown.map(c => c.tag), ['BIO', 'BIO', 'ANALYSIS', 'ENG']);
  check('and not said twice in the title', shown[1].title, 'Chapter 5 quiz');
  check('minutes are rounded to fives', shown[0].mins, '40');
  check('a date it could not read is no date', shown[3].due, '');
  check('an impossible length is left to you', shown[3].mins, '30');
  check('the quiz waits for the reading', shown[1].after, ['after Read chapter 5']);
  check('links to nothing are dropped', shown[3].after, []);
  check('it says both answers were weighed', await p.evaluate(() => document.querySelector('.ai-cards-note').textContent), 'two answers compared');
  check('what it was told: the words, the day, the tags', (await asked()).slice(-1).map(a => ({
    kind: a.kind, text: a.input.text, today: a.input.today, weekday: a.input.weekday })),
    [{ kind: 'parse', text: 'bio read ch 5 by thu then quiz fri', today: on(0), weekday: 'monday' }]);

  // you fix one and leave one out
  await p.locator('.ai-card-mins').nth(2).fill('75'); await p.locator('.ai-card-mins').nth(2).dispatchEvent('change');
  await p.locator('.ai-card-drop').nth(3).click(); await p.clock.runFor(300);
  check('a card left out goes', (await cards()).length, 3);
  await p.click('.ai-cards-go .go'); await p.clock.runFor(600);
  const made = await p.evaluate(() => Store.tasks().map(t => ({ title: t.title, tags: Store.tagsOf(t).map(g => g.name),
    due: t.due, mins: t.mins, needs: (t.needs || []).map(id => Store.taskById(id).title) })));
  check('they are added as tasks, with your fix', made, [
    { title: 'BIO Read chapter 5', tags: ['BIO'], due: on(3), mins: 40, needs: [] },
    { title: 'BIO Chapter 5 quiz', tags: ['BIO'], due: on(4), mins: 30, needs: ['BIO Read chapter 5'] },
    { title: 'ANALYSIS Problem set 3', tags: ['ANALYSIS'], due: on(1), mins: 75, needs: [] }]);
  check('the box is cleared and the cards go', await p.evaluate(() => [document.getElementById('taskInput').value,
    document.getElementById('aiCards').hidden]), ['', true]);
  check('the quiz says what it is waiting for', await p.evaluate(() => [...document.querySelectorAll('.task')]
    .filter(r => /quiz/.test(r.textContent)).map(r => r.querySelector('.is-after') && r.querySelector('.is-after').textContent)),
    ['after BIO Read chapter 5']);

  console.log('\n--- a link moves a deadline ---');
  await p.evaluate(d => { const q = Store.tasks().find(t => /quiz/.test(t.title)); Store.updateTask(q.id, { due: d }); }, on(2));
  check('the reading is due when its quiz is', await p.evaluate(() =>
    Store.dueFor(Store.tasks().find(t => /Read/.test(t.title)))), on(2));
  check('and the queue does not offer the quiz before it', await p.evaluate(() =>
    [...document.querySelectorAll('.queue-row .queue-title')].map(n => n.textContent).filter(t => /BIO/.test(t))),
    ['BIO Read chapter 5']);
  check('a link that would go round in a circle is refused', await p.evaluate(() => {
    const r = Store.tasks().find(t => /Read/.test(t.title)), q = Store.tasks().find(t => /quiz/.test(t.title));
    return Store.link(q.id, r.id); }), false);

  console.log('\n--- tonight, planned by it, and checked ---');
  const ids = await p.evaluate(() => Object.fromEntries(Store.tasks().map(t => [t.title.split(' ')[1], t.id])));
  await p.evaluate(() => Store.addTask({ title: 'EXTRA USACO silver', repeat: 'daily', mins: 60 }));
  const usaco = await p.evaluate(() => Store.tasks().find(t => /USACO/.test(t.title)).id);
  await post('/__ai', { plan: { result: {
    steps: [
      { id: ids.Chapter, mins: 30, why: 'quiz wednesday' },               // before its reading: moved after it
      { id: 'made-up', mins: 40, why: 'does not exist' },                 // dropped
      { id: ids.Read, mins: 400, why: 'read before the quiz' },           // more than is left: cut to what is
      { id: usaco, mins: 30, why: 'keeps practice going' },
      { id: ids.Read, mins: 20, why: 'twice' }                            // twice: dropped
    ],                                                                   // Problem set 3, due tomorrow, left out
    later: [], links: [{ first: ids.Problem, then: usaco, why: 'odd' }],
    note: 'reading first so wednesday is easy.' }, meta: { used: 'groq', judged: true } } });
  await p.evaluate(() => Ai.setAbout('applying to a summer program, essay due nov 1. i tutor tue and thu.'));
  await p.clock.runFor(95 * 1000);
  const planAsk = (await asked()).filter(a => a.kind === 'plan');
  check('it asked once things went quiet', planAsk.length, 1);
  const input = planAsk[0].input;
  check('with what you said about yourself', input.about, 'applying to a summer program, essay due nov 1. i tutor tue and thu.');
  check('the links, and the inherited deadline', input.tasks.filter(t => /quiz|Read/.test(t.title)).map(t => [t.title, t.due, t.needs.length]),
    [['BIO Read chapter 5', on(2), 0], ['BIO Chapter 5 quiz', on(2), 1]]);
  check('the time it has, and the rules’ own plan to start from', [input.bed, input.free > 0, input.baseline.length > 0], ['00:00', true, true]);

  await p.evaluate(() => { document.querySelectorAll('.aim-why')[0].click(); });
  await p.clock.runFor(400);
  const lines = () => p.evaluate(() => [...document.querySelectorAll('.aim-plan .plan-line')].map(r => ({
    name: r.querySelector('.plan-name').textContent, why: r.querySelector('.plan-why').textContent,
    mins: r.querySelector('.plan-mins').textContent })));
  const planned = await lines();
  check('the deadline it left out goes first anyway', planned[0].name, 'ANALYSIS Problem set 3');
  check('the reading comes before its quiz, whatever it said', planned.map(l => l.name).filter(n => /BIO/.test(n)),
    ['BIO Read chapter 5', 'BIO Chapter 5 quiz']);
  check('made-up and repeated steps are gone', planned.length, 4);
  check('no more minutes than are left', planned.find(l => /Read/.test(l.name)).mins, '40m');
  check('its reasons are shown', planned.find(l => /USACO/.test(l.name)).why, 'keeps practice going');
  check('and its note, marked as the AI’s', await p.evaluate(() => {
    const l = document.querySelector('.ai-line'); return [l.classList.contains('is-ai'), l.querySelector('.ai-words').textContent]; }),
    [true, 'reading first so wednesday is easy.']);
  check('up next follows it', await p.evaluate(() => document.querySelector('.queue-row .queue-title').textContent), 'ANALYSIS Problem set 3');
  const queue = await p.evaluate(() => [...document.querySelectorAll('.queue-row')].map(r => ({
    name: r.querySelector('.queue-title').textContent, why: r.querySelector('.queue-why').textContent,
    mins: r.querySelector('.queue-mins').textContent })));
  check('all three rows, in the order it planned -- the quiz waits for its reading', queue.map(r => r.name),
    ['ANALYSIS Problem set 3', 'BIO Read chapter 5', 'EXTRA USACO silver']);
  check('with its reasons and its slices', queue.slice(1).map(r => [r.why, r.mins]),
    [['read before the quiz', '40m'], ['keeps practice going', '30m of 1h']]);
  check('and marked as the AI’s order', await p.evaluate(() => !!document.querySelector('.queue-head .queue-ai')), true);

  console.log('\n--- a link it noticed is yours to agree with ---');
  check('it is offered', await p.evaluate(() => document.querySelector('.ai-link-text').textContent),
    'ANALYSIS Problem set 3 before EXTRA USACO silver?');
  await p.click('.ai-no'); await p.clock.runFor(300);
  check('saying no puts it away for good', await p.evaluate(() => document.querySelectorAll('.ai-link').length), 0);

  console.log('\n--- on its own once, in the morning; otherwise when you ask ---');
  const planCount = async () => (await asked()).filter(a => a.kind === 'plan').length;
  const again = () => p.evaluate(() => { const b = document.querySelector('.ai-again'); return [b.textContent, b.classList.contains('is-stale')]; });
  await p.evaluate(() => { const t = Store.tasks().find(t => /Problem/.test(t.title)); Store.toggleDone(t.id); });
  await p.clock.runFor(120 * 1000);
  check('ticking something off is not a reason to ask', await planCount(), 1);
  for (let i = 0; i < 5; i++) {                        // the start of the week: everything at once
    await p.evaluate(n => Store.addTask({ title: 'LATIN Sentences ' + n, due: Store.dayKey(new Date(Date.now() + 3 * 864e5)), mins: 20 }), i);
    await p.clock.runFor(20 * 1000);
  }
  await p.clock.runFor(3 * 60 * 1000);
  // long stretches jump the clock rather than living through every tick of it
  for (let i = 0; i < 4; i++) { await p.clock.fastForward(30 * 60 * 1000); await p.clock.runFor(1000); }
  check('new tasks, and two hours on: it does not ask by itself', await planCount(), 1);
  check('↻ says the plan is out of date instead', await again(), ['update \u21bb', true]);
  await p.click('.ai-again'); await p.clock.runFor(800);
  check('pressing it asks right away', await planCount(), 2);
  check('and it was told about the new ones', (await asked()).filter(a => a.kind === 'plan').slice(-1)[0].input.tasks
    .filter(t => /LATIN/.test(t.title)).length, 5);
  check('then ↻ is just ↻ again', await again(), ['\u21bb', false]);

  const until = h => p.evaluate(h => { const d = new Date(); d.setDate(d.getDate() + (d.getHours() >= h ? 1 : 0)); d.setHours(h, 0, 0, 0); return d - Date.now(); }, h);
  await p.clock.fastForward(await until(4)); await p.clock.runFor(3 * 60 * 1000);
  check('the next day, not before five in the morning', await planCount(), 2);
  await p.clock.fastForward(await until(5)); await p.clock.runFor(95 * 1000);
  check('from five, once', await planCount(), 3);
  for (let i = 0; i < 6; i++) { await p.clock.fastForward(30 * 60 * 1000); await p.clock.runFor(1000); }
  await p.evaluate(() => Store.addTask({ title: 'BIO Lab notes', due: Store.dayKey(new Date(Date.now() + 2 * 864e5)), mins: 30 }));
  await p.clock.runFor(3 * 60 * 1000);
  check('and only once, whatever happens later that day', await planCount(), 3);

  console.log('\n--- when it cannot ---');
  await post('/__ai', { parse: { status: 429, error: 'that is all the AI for today -- it comes back tomorrow' },
    plan: { status: 502, error: 'neither AI gave a usable answer' } });
  await p.fill('#taskInput', 'anything'); await p.click('#aiAdd'); await p.clock.runFor(800);
  check('out of allowance: it says so in its words', await toast(), 'that is all the AI for today -- it comes back tomorrow');
  await p.click('.ai-again'); await p.clock.runFor(800);
  check('a failed plan keeps the last good one', await p.evaluate(() => document.querySelector('.ai-line').classList.contains('is-ai')), true);

  console.log('\n--- switched off ---');
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.clock.runFor(400);
  await p.locator('.set-group', { hasText: 'use AI' }).locator('.set-toggle').first().click(); await p.clock.runFor(300);
  check('the about box goes with it', await p.evaluate(() => !!document.querySelector('.ai-about')), false);
  await p.click('#settingsClose'); await p.clock.runFor(400);
  check('tonight is the rules’ plan again', await p.evaluate(() => !!document.querySelector('.ai-line')), false);
  await p.fill('#taskInput', 'more'); await p.click('#aiAdd'); await p.clock.runFor(500);
  check('and ✦ says why it will not', await toast(), 'the AI is switched off in settings');
  const before = (await asked()).length;
  await p.evaluate(() => Store.addTask({ title: 'PHY Lab', due: Store.dayKey(new Date(Date.now() + 864e5)), mins: 40 }));
  for (let i = 0; i < 4; i++) { await p.clock.fastForward(10 * 60 * 1000); await p.clock.runFor(1000); }
  check('and it asks nothing at all', (await asked()).length, before);

  console.log('\n--- what you said follows you ---');
  const prefs = (await post('/__dump')).prefs.find(r => r.user_id === USER);
  check('it is kept with your account', prefs && prefs.data && prefs.data.about, 'applying to a summer program, essay due nov 1. i tutor tue and thu.');
  const two = await device();
  await two.p.clock.runFor(4000);
  check('a second browser has it', await two.p.evaluate(() => Ai.about()), 'applying to a summer program, essay due nov 1. i tutor tue and thu.');

  await b.close(); db.close();
  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.forEach(e => console.log('  ' + e));
  process.exit(fail || errs.length ? 1 : 0);
})();
