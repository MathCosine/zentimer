/* The AI through Puter, from the page, with no key and no server: connecting
   a free Puter account from the click that asks for it, two models answering
   and a third judging, a model that has been retired or will not take a
   schema, the month's allowance running out -- and the week: each day's share
   of the homework, its room, the AI's week checked, a day that is too full. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makePuter = require('./fakeputer.js');
const DB = 'http://127.0.0.1:8901';
const PUTER = 'https://js.puter.com/v2/';
const AT = new Date(2026, 9, 19, 16, 0);              // a Monday, four in the afternoon
const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());
const day = n => { const d = new Date(AT); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  const db = await start(8901);
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
  let puterFetched = 0;
  await ctx.route(PUTER, r => { puterFetched++; r.fulfill({ status: 200, contentType: 'application/javascript', body: makePuter(DB) }); });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push('CON: ' + t); });
  await p.clock.install({ time: AT });
  await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(2500);
  const toast = () => p.evaluate(() => { const t = document.querySelector('.toast-text'); return t ? t.textContent : null; });
  const asked = async () => (await post('/__puterAsked')).asked;

  console.log('--- nothing from Puter until you reach for it ---');
  await p.evaluate(d => {
    Store.addTask({ title: 'BIO Read chapter 5', due: d[2], mins: 40 });
    Store.addTask({ title: 'BIO Chapter 5 quiz', due: d[3], mins: 30 });
    Store.addTask({ title: 'ANALYSIS Problem set 3', due: d[1], mins: 90 });
    Store.addTask({ title: 'ENG Summer essay', due: d[6], mins: 300 });
    Store.addTask({ title: 'EXTRA USACO silver', repeat: 'daily', mins: 60 });
  }, [0, 1, 2, 3, 4, 5, 6].map(day));
  await p.clock.runFor(1500);
  check('the desk opens without fetching Puter', puterFetched, 0);
  check('and says what the AI would do, with a way to connect', await p.evaluate(() =>
    document.querySelector('.ai-invite .ai-words').textContent), 'let the AI plan tonight and your week');

  console.log('\n--- ✦, before Puter is connected ---');
  await post('/__puter', {
    parse: {
      A: { tasks: [{ title: 'Lab report', tag: 'CHEM', due: day(2), mins: 60, repeat: null, after: [] },
                   { title: 'Read lab handout', tag: 'CHEM', due: day(1), mins: 20, repeat: null, after: [] }] },
      B: '```json\n' + JSON.stringify({ tasks: [{ title: 'Read lab handout', tag: 'CHEM', due: day(1), mins: 20, repeat: null, after: [] },
                   { title: 'Lab report', tag: 'CHEM', due: day(2), mins: 60, repeat: null, after: ['0'] }] }) + '\n```'
    },
    judge: { preferLinks: true },
    retired: ['gemini-3.8-flash'], noSchema: ['gemini-3.5-flash-lite']
  });
  await p.fill('#taskInput', 'chem: read the lab handout by tmrw, lab report due wed');
  await p.click('#aiAdd'); await p.clock.runFor(800);
  check('it says how the AI runs, and offers to connect', [await toast(), await p.evaluate(() =>
    document.querySelector('.toast-go').textContent)], ['the AI runs on a free Puter account — connect it once', 'connect']);
  check('Puter is fetched now that you asked', puterFetched, 1);
  await p.click('.toast-go'); await p.clock.runFor(2500);
  check('connecting carries straight on with what you asked', await p.evaluate(() =>
    [...document.querySelectorAll('.ai-card-title')].map(n => n.value)), ['Read lab handout', 'Lab report']);
  const parseAsks = (await asked()).filter(a => a.kind === 'parse');
  check('two models were asked', [...new Set(parseAsks.map(a => /^gemini/.test(a.model) ? 'gemini' : 'gpt'))].sort(), ['gemini', 'gpt']);
  check('a retired model gives way to the next', parseAsks.filter(a => /^gemini/.test(a.model)).map(a => a.model + (a.strict ? '+schema' : '')),
    ['gemini-3.8-flash+schema', 'gemini-3.8-flash', 'gemini-3.5-flash-lite+schema', 'gemini-3.5-flash-lite']);
  check('they disagreed, so a third judged', (await asked()).filter(a => a.kind === 'judge').length, 1);
  check('and the one it picked is the one shown, links and all', await p.evaluate(() =>
    [...document.querySelectorAll('.ai-card')].map(c => [...c.querySelectorAll('.is-after')].map(n => n.textContent).join())),
    ['', 'after Read lab handout']);
  check('it says two answers were compared', await p.evaluate(() => document.querySelector('.ai-cards-note').textContent), 'two answers compared');
  await p.click('.ai-cards-go .go'); await p.clock.runFor(600);
  check('the tasks are added', await p.evaluate(() => Store.tasks().filter(t => /CHEM/.test(t.title)).map(t => t.title)),
    ['CHEM Read lab handout', 'CHEM Lab report']);

  console.log('\n--- tonight and the week, planned by it ---');
  const ids = await p.evaluate(() => Object.fromEntries(Store.tasks().map(t => [t.title.split(' ').slice(1, 3).join(' '), t.id])));
  const plan = (who) => ({
    steps: [{ id: ids['Problem set'], mins: 90, why: 'due tomorrow' }, { id: ids['Read lab'], mins: 20, why: 'quick, due tomorrow' },
            { id: ids['USACO silver'], mins: 30, why: 'keeps practice going' }],
    later: [{ id: ids['Chapter 5'], why: 'after the reading' }],
    week: [
      { day: day(0), items: [], note: '' },
      { day: day(1), items: [{ id: ids['Read chapter'], mins: 40 }, { id: ids['Lab report'], mins: 60 }], note: 'reading before thursday' },
      { day: day(2), items: [{ id: ids['Chapter 5'], mins: 30 }, { id: ids['Summer essay'], mins: 90 }], note: '' },
      { day: day(3), items: [{ id: ids['Summer essay'], mins: 90 }, { id: 'made-up', mins: 30 }, { id: ids['Problem set'], mins: 30 }], note: 'essay, part two' },
      { day: day(4), items: [{ id: ids['Summer essay'], mins: 600 }], note: '' }
    ],
    weekNote: who + ': the essay is spread over three nights so sunday stays light.',
    links: [], note: 'pset first, then a little USACO.'
  });
  await post('/__puter', { plan: { A: plan('gemini'), B: plan('gpt') }, judge: { answer: { pick: 'A', why: 'same' } } });
  await p.evaluate(() => Ai.setAbout('i tutor tue and thu, 4 to 5.'));
  await p.clock.runFor(95 * 1000);
  const planAsks = (await asked()).filter(a => a.kind === 'plan');
  check('once things went quiet, it planned', planAsks.length > 0, true);
  const input = planAsks[0].input;
  check('it was told the whole week: seven days, each with its room', [input.days.length, input.days.map(d => d.day)[6], input.days.every(d => typeof d.free === 'number')],
    [7, day(6), true]);
  check('and everything due inside it', input.tasks.map(t => t.title).filter(t => /essay/.test(t)), ['ENG Summer essay']);
  check('identical answers need no judge', (await asked()).filter(a => a.kind === 'judge').length, 0);

  await p.click('#weekBtn'); await p.clock.runFor(400);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('.wk-day')].map(r => ({
    name: r.querySelector('.wk-name').textContent, num: r.querySelector('.wk-num').textContent, over: r.classList.contains('is-over') })));
  const week = await rows();
  check('the week button opens it: seven days, today first', [week.length, week[0].name], [7, 'today']);
  check('above the week\u2019s calendar, which is still there', await p.evaluate(() => !document.getElementById('weekWrap').hidden), true);
  check('its note about the week', await p.evaluate(() => document.querySelector('.wk-note').textContent.trim()),
    '✦ gemini: the essay is spread over three nights so sunday stays light.');
  const items = (n) => p.evaluate(n => Plan.week().days[n].items.map(i => i.task.title + ' ' + i.mins), n);
  check('today is tonight’s plan', await items(0), ['ANALYSIS Problem set 3 90', 'CHEM Read lab handout 20']);
  check('tomorrow, what it gave tomorrow', await items(1), ['BIO Read chapter 5 40', 'CHEM Lab report 60']);
  check('made-up tasks and work after its deadline are dropped', await items(3), ['ENG Summer essay 90']);
  check('and no task is given more than it has left', await items(4), ['ENG Summer essay 120']);
  await p.locator('.wk-day').nth(1).click(); await p.clock.runFor(300);
  check('a day opens to say what is in it', await p.evaluate(() => ({
    note: document.querySelector('.wk-day-note').textContent,
    lines: [...document.querySelectorAll('.wk-items .plan-name')].map(n => n.textContent) })),
    { note: 'reading before thursday', lines: ['BIO Read chapter 5', 'CHEM Lab report'] });

  console.log('\n--- the week, by the rules ---');
  await p.evaluate(() => Ai.setOn(false)); await p.clock.runFor(300);
  const rules = await p.evaluate(() => Plan.week().days.map(d => d.items.map(i => i.task.title.split(' ')[1] + ' ' + i.mins).join(', ')));
  check('the big essay is spread from today, a slice a day', rules.slice(0, 5).map(r => (r.match(/Summer (\d+)/) || [0, 0])[1]), ['60', '60', '60', '60', '60']);
  check('a small task waits for its day: not tonight', rules[0].includes('Chapter'), false);
  check('but two days before it is due', rules[1].includes('Chapter 30'), true);
  check('and the reading it needs comes first', rules[0].includes('Read 40'), true);
  await p.evaluate(() => Store.addTask({ title: 'APUSH DBQ essay', due: Store.dayKey(new Date(Date.now() + 2 * 864e5)), mins: 400 }));
  await p.clock.runFor(400);
  check('a day asking more than it has is marked', await p.evaluate(() => Plan.week().days.some(d => d.over)), true);
  const fridayFree = () => p.evaluate(k => Plan.week().days.find(d => d.key === k).free, day(4));
  const before = await fridayFree();
  await p.evaluate(() => { Plan.setFreeFrom(17 * 60, null); });
  check('a later start after school is less room that day', before - await fridayFree(), 90);
  await p.evaluate(() => Ai.setOn(true)); await p.clock.runFor(300);

  console.log('\n--- running out ---');
  await post('/__puter', { broke: 'Insufficient funds: upgrade to keep using AI' });
  await p.click('.ai-again'); await p.clock.runFor(1500);
  check('it says the month’s allowance is used up', await p.evaluate(() => {
    const s = Ai.status(); return s.error; }), 'your free Puter AI allowance is used up for this month');
  check('and the last good plan stays', await p.evaluate(() => document.querySelector('.ai-line').classList.contains('is-ai')), true);
  await post('/__puter', {});

  console.log('\n--- settings ---');
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.clock.runFor(500);
  check('it says who is connected, and which AI', await p.evaluate(() => ({
    who: document.querySelector('.ai-puter .set-label span').textContent,
    runs: document.querySelector('.set-group .pick[aria-pressed="true"]') && [...document.querySelectorAll('.pick[aria-pressed="true"]')].map(n => n.textContent).includes('Puter (free)') })),
    { who: 'connected as sam_k', runs: true });
  check('the times the week plans from are there', await p.evaluate(() =>
    [...document.querySelectorAll('.set-label span')].map(n => n.textContent).filter(t => /free from/.test(t))),
    ['school days, free from', 'weekends, free from']);
  await p.locator('.ai-puter button', { hasText: 'disconnect' }).click(); await p.clock.runFor(400);
  check('disconnecting signs out of Puter', await p.evaluate(() => [Ai.connected(), Ai.usable()]), [false, false]);
  await p.click('#settingsClose'); await p.clock.runFor(400);
  check('and tonight is offered the AI again', await p.evaluate(() => !!document.querySelector('.ai-invite')), true);
  await p.click('.ai-invite .ai-no'); await p.clock.runFor(300);
  check('which can be put away', await p.evaluate(() => !!document.querySelector('.ai-invite')), false);

  console.log('\n--- a device that connected before ---');
  await p.evaluate(() => localStorage.setItem('fake.puter', JSON.stringify({ username: 'sam_k' })));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('pip.ai.v1')); s.linked = true; localStorage.setItem('pip.ai.v1', JSON.stringify(s)); });
  const fetchedBefore = puterFetched;
  await p.reload(); await p.clock.runFor(3500);
  check('Puter comes back with the page', [puterFetched > fetchedBefore || await p.evaluate(() => !!window.puter), await p.evaluate(() => Ai.usable())], [true, true]);

  await b.close(); db.close();
  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.forEach(e => console.log('  ' + e));
  process.exit(fail || errs.length ? 1 : 0);
})();
