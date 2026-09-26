const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '11111111-1111-1111-1111-111111111111';

(async () => {
  const db = await start(8901);
  const browser = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  const ctx = await browser.newContext({ viewport:{width:430,height:900} });
  await ctx.route(CDN, r => r.fulfill({ status:200, contentType:'application/javascript', body: makeClient('http://127.0.0.1:8901', USER) }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1400);

  await p.click('#syncBtn'); await p.waitForTimeout(400);
  check('panel shows the account, not a url form', await p.evaluate(() => ({
    account: !document.getElementById('authAccount').hidden,
    form: !document.getElementById('authForm').hidden,
    advancedHidden: document.getElementById('syncAdvanced').hidden })), { account:true, form:false, advancedHidden:true });
  check('it says who', await p.evaluate(() => document.getElementById('authWho').textContent.includes('signed in as')), true);

  console.log('\n--- sign out gives you the signed-out face ---');
  await p.click('#authOut'); await p.waitForTimeout(600);
  check('form is back', await p.evaluate(() => ({
    form: !document.getElementById('authForm').hidden,
    button: document.getElementById('syncConnect').textContent,
    swap: document.getElementById('authSwap').textContent })), { form:true, button:'sign in', swap:'make an account' });

  console.log('\n--- making an account is a choice, not a guess ---');
  await p.click('#authSwap'); await p.waitForTimeout(250);
  check('the form says so', await p.evaluate(() => ({
    title: document.getElementById('authTitle').textContent,
    button: document.getElementById('syncConnect').textContent,
    forgotHidden: document.getElementById('authForgot').hidden })), { title:'make an account', button:'make it', forgotHidden:true });
  check('a short password is refused before it is sent', await (async () => {
    await p.fill('#syncEmail','me@example.com'); await p.fill('#syncPass','abc');
    await p.click('#syncConnect'); await p.waitForTimeout(300);
    return p.evaluate(() => document.getElementById('syncStatus').textContent); })(),
    'a password needs at least six characters');

  await p.fill('#syncPass','longenough'); await p.click('#syncConnect'); await p.waitForTimeout(1200);
  check('signed in after making it', await p.evaluate(() => !document.getElementById('authAccount').hidden), true);
  check('the password field is cleared', await p.evaluate(() => document.getElementById('syncPass').value), '');

  console.log('\n--- deleting asks first ---');
  await p.click('#authDelete'); await p.waitForTimeout(250);
  check('a warning appears, nothing happens yet', await p.evaluate(() => !document.getElementById('authWarn').hidden), true);
  await p.click('#authDeleteNo'); await p.waitForTimeout(250);
  check('keeping it puts the warning away', await p.evaluate(() => document.getElementById('authWarn').hidden), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await browser.close(); db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
