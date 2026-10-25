/* The AI on your own Groq key: pasted in settings, checked with Groq before
   it is kept, kept in this browser only, and then used straight from the
   page -- two models and a judge, a model that will not take the strict
   schema asked again without it, and Groq's daily limit said in words.
   Groq's API is stood in for here, so no real key is needed. */
const { chromium } = require('./browser');
const AT = new Date(2026, 9, 26, 16, 0);              // a Monday, four in the afternoon
const GOOD = 'gsk_test_key_good_1234';

(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
  const asked = [];
  let mode = 'fine';
  await ctx.route('https://api.groq.com/openai/v1/**', async route => {
    const req = route.request();
    const auth = req.headers()['authorization'] || '';
    const cors = { 'access-control-allow-origin': '*' };
    if (auth !== 'Bearer ' + GOOD) return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid API Key' } }) });
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data:
        ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'whisper-large-v3'].map(id => ({ id })) }) });
    }
    const body = JSON.parse(req.postData());
    const kind = body.response_format && body.response_format.json_schema ? body.response_format.json_schema.name
      : /plan a student/.test(body.messages[0].content) ? 'plan' : /turn a student/.test(body.messages[0].content) ? 'parse' : 'judge';
    asked.push({ model: body.model, kind, format: body.response_format.type, user: body.messages[1].content.slice(0, 80) });
    if (mode === 'daily') return route.fulfill({ status: 429, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Rate limit reached for model on requests per day (RPD): Limit 1000, Used 1000' } }) });
    if (body.model === 'llama-3.3-70b-versatile' && body.response_format.type === 'json_schema') {
      return route.fulfill({ status: 400, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'This model does not support response format `json_schema`' } }) });
    }
    let content;
    if (kind === 'judge') {
      // A and B come in a random order: it prefers llama's, wherever that is
      const both = JSON.parse(body.messages[1].content);
      content = { pick: /llama/.test(both.B.note) ? 'B' : 'A', why: 'follows what the student said' };
    } else if (kind === 'parse') {
      content = { tasks: [{ title: 'Lab', tag: 'CHEM', due: null, mins: 60, repeat: null, after: [] }] };
    } else {
      const data = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf('data:\n') + 6));
      const ids = data.tasks.map(t => t.id);
      // the two disagree about the order, so the judge is asked
      const steps = (body.model === 'openai/gpt-oss-120b' ? ids : ids.slice().reverse()).map(id => ({ id, mins: 30, why: 'from ' + body.model }));
      content = { steps, start: data.start, busy: [], later: [], week: [], weekNote: '', links: [], note: 'planned by ' + body.model };
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] }) });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|401|429|400/.test(t)) errs.push('CON: ' + t); });
  await p.clock.install({ time: AT });
  await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(2000);
  await p.evaluate(() => {
    const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    Store.addTask({ title: 'ANALYSIS Problem set 3', due: on(1), mins: 60 });
    Store.addTask({ title: 'BIO Read chapter 5', due: on(2), mins: 40 });
  });
  await p.clock.runFor(800);
  const toast = () => p.evaluate(() => { const t = document.querySelector('.toast-text'); return t ? t.textContent : null; });

  console.log('--- choosing Groq ---');
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.clock.runFor(500);
  await p.locator('.pick', { hasText: 'Groq (my key)' }).click(); await p.clock.runFor(300);
  check('it asks for the key, as a password field', await p.evaluate(() => document.querySelector('.ai-groq-key').type), 'password');
  check('and says where to get one', await p.evaluate(() =>
    [...document.querySelectorAll('.set-note a')].some(a => a.href === 'https://console.groq.com/keys')), true);

  console.log('\n--- a wrong key ---');
  await p.fill('.ai-groq-key', 'gsk_typo'); await p.click('.ai-groq-add .set-add'); await p.clock.runFor(800);
  check('Groq says no, and so does pip', await p.evaluate(() => document.querySelector('.cal-said').textContent),
    'Groq did not accept that key — copy it again from console.groq.com/keys');
  check('and nothing is kept', await p.evaluate(() => [localStorage.getItem('pip.ai.v1.groq'), Ai.usable()]), [null, false]);

  console.log('\n--- the right key ---');
  await p.fill('.ai-groq-key', GOOD); await p.click('.ai-groq-add .set-add'); await p.clock.runFor(800);
  check('it is checked and kept', await p.evaluate(() => [Ai.provider(), Ai.usable()]), ['groq', true]);
  check('shown only by its end', await p.evaluate(() => document.querySelector('.ai-groq .set-label span').textContent), 'key …1234 saved');
  check('kept in this browser and nowhere else -- not in the desk that syncs', await p.evaluate(k =>
    [localStorage.getItem('pip.ai.v1.groq') === k, JSON.stringify(Store.state()).includes(k), (localStorage.getItem('pip.ai.v1') || '').includes(k)], GOOD),
    [true, false, false]);
  await p.click('#settingsClose'); await p.clock.runFor(400);

  console.log('\n--- planning on it ---');
  await p.evaluate(() => Ai.now()); await p.clock.runFor(1500);
  const plans = asked.filter(a => a.kind === 'plan');
  check('two models, the ones this key can see', [...new Set(plans.map(a => a.model))].sort(), ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
  check('one that will not take the strict schema is asked again without it',
    plans.filter(a => a.model === 'llama-3.3-70b-versatile').map(a => a.format), ['json_schema', 'json_object']);
  check('your words go first', plans[0].user.startsWith('The student’s own words'), true);
  check('they disagreed, so the small model judged', asked.filter(a => a.kind === 'judge').map(a => a.model), ['llama-3.1-8b-instant']);
  check('and its pick is the plan', await p.evaluate(() => {
    const l = document.querySelector('.ai-line'); return [l.classList.contains('is-ai'), l.querySelector('.ai-words').textContent]; }),
    [true, 'planned by llama-3.3-70b-versatile']);

  console.log('\n--- Groq’s daily limit ---');
  mode = 'daily';
  await p.click('.ai-again'); await p.clock.runFor(1500);
  check('said in words', await p.evaluate(() => Ai.status().error), 'Groq’s free limit for today is used up — it resets tomorrow');
  check('and the plan it had stays', await p.evaluate(() => document.querySelector('.ai-line').classList.contains('is-ai')), true);
  mode = 'fine';

  console.log('\n--- notes into tasks, on it too ---');
  await p.fill('#taskInput', 'chem lab due friday'); await p.click('#aiAdd'); await p.clock.runFor(1500);
  check('the request went to Groq', asked.filter(a => a.kind === 'parse').length > 0, true);

  console.log('\n--- removing the key ---');
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.clock.runFor(500);
  await p.locator('.ai-groq button', { hasText: 'remove' }).click(); await p.clock.runFor(300);
  check('it is gone from the browser', await p.evaluate(() => [localStorage.getItem('pip.ai.v1.groq'), Ai.usable()]), [null, false]);
  await p.click('#settingsClose'); await p.clock.runFor(400);
  check('and tonight offers to add one', await p.evaluate(() => document.querySelector('.ai-invite .ai-yes').textContent), 'add key');
  await p.click('.ai-invite .ai-yes'); await p.clock.runFor(800);
  check('which opens settings at the key box', await p.evaluate(() => document.activeElement && document.activeElement.className), 'set-text cal-link ai-groq-key');

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
