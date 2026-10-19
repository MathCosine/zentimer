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

  console.log('\n--- what you said, done ---');
  await p.evaluate(() => Ai.setAbout('homework before extracurriculars. i tutor mondays 5 to 6.'));
  const said = { steps: [{ id: ids['Problem set'], mins: 90, why: 'due tomorrow; you said homework before extracurriculars' },
                         { id: ids['USACO silver'], mins: 30, why: 'keeps practice going' }],
    start: '16:30', busy: [{ from: '17:00', to: '18:00', what: 'tutoring' }],
    later: [], week: [], weekNote: '', links: [], note: 'homework first, like you said.' };
  await post('/__puter', { plan: { A: said, B: said } });
  await p.click('.ai-again'); await p.clock.runFor(1500);
  const sent = (await asked()).filter(a => a.kind === 'plan')[0];
  check('your words go first, in plain words', sent.user.split('\n').slice(0, 2),
    ['The student’s own words (follow them):', '- About me: homework before extracurriculars. i tutor mondays 5 to 6.']);
  check('a daily drill is sent as practice, not "due today"', sent.input.tasks.filter(t => t.practice).map(t => t.due), [null]);
  check('and it is told when tonight starts (17:00, set earlier)', sent.input.start, '17:00');
  await p.evaluate(() => { if (!document.querySelector('.aim-plan')) document.querySelector('.aim-why').click(); });
  await p.clock.runFor(300);
  const lines = await p.evaluate(() => [...document.querySelectorAll('.aim-plan .plan-line')].map(r =>
    [r.querySelector('.plan-at').textContent, r.querySelector('.plan-name').textContent, r.querySelector('.plan-why').textContent]));
  check('the plan starts when it said', lines[0][0], '16:30');
  check('and goes round the tutoring you mentioned', lines.some(l => l[1] === 'tutoring' && l[2] === 'you said' && l[0] === '17:00'), true);
  check('its reason, short and in whole words', lines.find(l => /Problem set/.test(l[1]))[2], 'you said homework before\u2026');
  if (await p.evaluate(() => !document.getElementById('weekAhead').hidden)) { await p.click('#weekBtn'); await p.clock.runFor(300); }
  check('up next counts from then', await p.evaluate(() => document.querySelector('.queue-head span').textContent).then(t => /from 16:30$/.test(t)), true);
  await p.evaluate(() => Ai.setAbout(''));
  await post('/__puter', {});

  console.log('\n--- telling it something for today, or this week ---');
  const plansSoFar = async () => (await asked()).filter(a => a.kind === 'plan');
  const chips = () => p.evaluate(() => [...document.querySelectorAll('.ai-note')].map(c =>
    [c.querySelector('.ai-note-when').textContent, c.querySelector('.ai-note-text').textContent]));
  let n0 = (await plansSoFar()).length;
  await p.click('.ai-tell-btn'); await p.clock.runFor(300);
  check('"tell it" opens a box right there, ready to type', await p.evaluate(() => document.activeElement.className), 'ai-tell-input');
  await p.keyboard.type('soccer till 7');
  await p.clock.runFor(61 * 1000);
  check('what you are typing survives the minute ticking over', await p.evaluate(() =>
    [document.querySelector('.ai-tell-input').value, document.activeElement.className]), ['soccer till 7', 'ai-tell-input']);
  check('nothing was asked while you typed', (await plansSoFar()).length, n0);
  await p.keyboard.press('Enter'); await p.clock.runFor(300);
  check('it shows what it was told, and for how long', await chips(), [['today', 'soccer till 7']]);
  check('and the box goes away', await p.evaluate(() => !!document.querySelector('.ai-tell')), false);
  await p.clock.runFor(5000);
  let told = (await plansSoFar()).slice(n0);
  check('it plans again within seconds, not on its half-hour clock', told.length > 0, true);
  check('with the note, marked as just for today', told.length && told[told.length - 1].input.forNow,
    [{ note: 'soccer till 7', for: 'today only' }]);

  n0 = (await plansSoFar()).length;
  await p.click('.ai-tell-btn'); await p.clock.runFor(300);
  await p.locator('.ai-tell .pick', { hasText: 'this week' }).click(); await p.clock.runFor(200);
  await p.fill('.ai-tell-input', 'sick this week, go easy');
  await p.click('.ai-tell .ai-yes'); await p.clock.runFor(5000);
  told = (await plansSoFar()).slice(n0);
  check('one for the week holds for the seven days the week shows', told.length && told[told.length - 1].input.forNow,
    [{ note: 'soccer till 7', for: 'today only' }, { note: 'sick this week, go easy', for: 'until ' + day(6) }]);
  check('both shown', await chips(), [['today', 'soccer till 7'], ['this week', 'sick this week, go easy']]);
  check('and kept on this device', await p.evaluate(() => JSON.parse(localStorage.getItem('pip.ai.v1.notes')).map(n => n.until)),
    [day(0), day(6)]);

  n0 = (await plansSoFar()).length;
  await p.locator('.ai-note', { hasText: 'soccer' }).locator('.ai-note-drop').click(); await p.clock.runFor(5000);
  told = (await plansSoFar()).slice(n0);
  check('× forgets one, and the plan is asked again without it', told.length && told[told.length - 1].input.forNow,
    [{ note: 'sick this week, go easy', for: 'until ' + day(6) }]);
  await p.evaluate(() => Ai.addNote('game tonight', 'today')); await p.clock.runFor(5000);
  await p.clock.fastForward(24 * 3600 * 1000); await p.clock.runFor(3000);
  check('the next day, today’s note has gone and the week’s is still there', await p.evaluate(() => Ai.notes().map(n => n.text)),
    ['sick this week, go easy']);
  await p.clock.fastForward(6 * 24 * 3600 * 1000); await p.clock.runFor(3000);
  check('and a week on, that has gone too', await p.evaluate(() => Ai.notes().length), 0);

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
