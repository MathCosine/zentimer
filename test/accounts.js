/* Accounts, on their own pages now: making one and being welcomed, signing
   in and out, a wrong password, a forgotten one and the new one chosen from
   the email, an address that has to be confirmed first, and deleting it all.
   Against a stand-in Supabase with real passwords and real sessions. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const DB = 'http://127.0.0.1:8901';
const SITE = 'http://127.0.0.1:8899';
const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());

(async () => {
  const db = await start(8901);
  const browser = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, null, { realAuth: true }) }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|404/.test(t)) errs.push('CON: ' + t); });
  const view = () => p.evaluate(() => ['viewForm', 'viewForgot', 'viewReset', 'viewSent', 'viewAccount']
    .filter(v => !document.getElementById(v).hidden)[0]);
  const said = (id) => p.evaluate(i => document.getElementById(i).textContent, id);
  const path = () => new URL(p.url()).pathname;

  console.log('--- the front page leads here ---');
  await p.goto(SITE + '/'); await p.waitForTimeout(500);
  check('"make your desk" goes to making an account', await p.evaluate(() =>
    document.querySelector('.front-hero .front-cta').getAttribute('href')), 'account/#signup');

  console.log('\n--- making an account ---');
  await p.goto(SITE + '/account/#signup'); await p.waitForTimeout(1200);
  check('the form, in making-an-account mode', [await view(), await p.evaluate(() => ({
    title: document.getElementById('formTitle').textContent,
    button: document.getElementById('formGo').textContent.trim(),
    hint: !document.getElementById('passHint').hidden,
    forgot: document.getElementById('forgotLink').hidden,
    google: document.getElementById('googleBtn').hidden }))],
    ['viewForm', { title: 'make your desk', button: 'make my account', hint: true, forgot: true, google: true }]);
  await p.fill('#email', 'not an email'); await p.fill('#password', 'longenough');
  await p.click('#formGo'); await p.waitForTimeout(300);
  check('a mistyped email is caught here', await said('formSaid'), 'that doesn’t look like an email address');
  await p.fill('#email', 'sam@example.com'); await p.fill('#password', 'abc');
  await p.click('#formGo'); await p.waitForTimeout(300);
  check('so is a short password', await said('formSaid'), 'a password needs at least six characters');
  check('and neither went to the server', (await post('/__auth')).users, []);
  await p.click('#eye');
  check('the eye shows what you typed', await p.evaluate(() => document.getElementById('password').type), 'text');
  await p.fill('#password', 'longenough');
  await p.click('#formGo'); await p.waitForURL('**/welcome/', { timeout: 8000 }).catch(() => {});
  check('someone new is welcomed', path(), '/welcome/');
  check('with an account', (await post('/__auth')).users, ['sam@example.com']);

  console.log('\n--- the welcome ---');
  await p.waitForTimeout(1200);
  const title = () => p.evaluate(() => document.querySelector('.welcome-step .auth-title').textContent);
  check('it starts by saying hello', await title(), 'hi! let’s set up your desk');
  await p.click('#next'); await p.waitForTimeout(400);
  check('then your classes', await title(), 'what are you taking?');
  await p.fill('.welcome-input', 'bio'); await p.press('.welcome-input', 'Enter'); await p.waitForTimeout(200);
  await p.fill('.welcome-input', 'ap chem'); await p.press('.welcome-input', 'Enter'); await p.waitForTimeout(200);
  await p.locator('.welcome-ideas .chip', { hasText: 'MATH' }).click(); await p.waitForTimeout(200);
  check('each a chip, written the way tags are', await p.evaluate(() =>
    [...document.querySelectorAll('.welcome-chip span:first-child')].map(n => n.textContent)), ['BIO', 'APCHEM', 'MATH']);
  await p.locator('.welcome-drop').nth(1).click(); await p.waitForTimeout(200);
  await p.click('#next'); await p.waitForTimeout(400);
  check('then practice', await title(), 'anything you practise most days?');
  await p.locator('.welcome-ideas .chip', { hasText: 'usaco' }).click(); await p.waitForTimeout(200);
  await p.fill('.welcome-mins', '45'); await p.locator('.welcome-mins').dispatchEvent('change');
  await p.click('#next'); await p.waitForTimeout(400);
  check('then bedtime', await title(), 'when do you want to be asleep?');
  await p.locator('.welcome-time', { hasText: '23:00' }).click(); await p.waitForTimeout(200);
  await p.click('#next'); await p.waitForTimeout(400);
  check('then the calendar, which can be skipped', [await title(), await p.textContent('#next')], ['your calendar', 'skip']);
  await p.click('#next'); await p.waitForTimeout(400);
  check('then what the AI should know', await title(), 'anything the AI should know?');
  await p.fill('.welcome-about', 'applying to a summer program. i tutor tue and thu.');
  await p.click('#next'); await p.waitForTimeout(600);
  check('and it is ready', [await title(), await p.textContent('#next')], ['your desk is ready', 'open my desk']);
  check('saying what it set up', await p.evaluate(() => [...document.querySelectorAll('.welcome-chip')].map(n => n.textContent)),
    ['2 classes', 'usaco 45m a day', 'bed at 23:00']);
  await p.click('#next'); await p.waitForURL('**/app/', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);
  check('and then the desk', path(), '/app/');
  check('with the classes and the practice in it', await p.evaluate(() => ({
    tags: Store.tags().map(t => t.name + (t.kind === 'practice' ? '*' : '')),
    daily: Store.tasks().filter(t => t.repeat === 'daily').map(t => t.title + ' ' + t.mins) })),
    { tags: ['BIO', 'MATH', 'USACO*'], daily: ['USACO practice 45'] });
  check('bedtime set', await p.evaluate(() => Plan.dayEnd()), 23 * 60);
  check('and the note for the AI, kept with the account', (await post('/__dump')).prefs.map(r => r.data && r.data.about),
    ['applying to a summer program. i tutor tue and thu.']);

  console.log('\n--- the account button on the desk ---');
  await p.click('#syncBtn'); await p.waitForTimeout(400);
  check('it says who, and links to the account page', await p.evaluate(() => ({
    who: document.getElementById('authWho').textContent,
    link: document.getElementById('acctLink').getAttribute('href') })),
    { who: 'sam@example.com', link: '../account/' });
  await p.keyboard.press('Escape');

  console.log('\n--- the account page, signed in ---');
  await p.goto(SITE + '/account/'); await p.waitForTimeout(1500);
  check('it shows the account', [await view(), await said('acctEmail'), await said('acctFace')], ['viewAccount', 'sam@example.com', 'S']);
  await p.locator('#pwRow summary').click(); await p.fill('#pwNew', 'evenlonger'); await p.click('#pwForm .go');
  await p.waitForTimeout(600);
  check('the password can be changed', (await post('/__auth')).log.filter(l => l.what === 'update').length, 1);
  await p.click('#outBtn'); await p.waitForTimeout(600);
  check('signing out goes back to the form', await view(), 'viewForm');

  console.log('\n--- signing in ---');
  await p.fill('#email', 'sam@example.com'); await p.fill('#password', 'longenough');
  await p.click('#formGo'); await p.waitForTimeout(900);
  check('the old password is refused, kindly', await said('formSaid'), 'that email and password don’t match');
  await p.fill('#password', 'evenlonger');
  await p.click('#formGo'); await p.waitForURL('**/app/', { timeout: 8000 }).catch(() => {});
  check('the right one goes straight to the desk', path(), '/app/');

  console.log('\n--- a forgotten password ---');
  await p.goto(SITE + '/account/'); await p.waitForTimeout(1200);
  await p.click('#outBtn'); await p.waitForTimeout(500);
  await p.fill('#email', 'sam@example.com');
  await p.click('#forgotLink'); await p.waitForTimeout(300);
  check('the email comes along', await p.inputValue('#forgotEmail'), 'sam@example.com');
  await p.click('#forgotForm .go'); await p.waitForTimeout(800);
  check('it says the link is on its way', [await view(), await said('sentTitle')], ['viewSent', 'on its way']);
  const reset = (await post('/__auth')).log.filter(l => l.what === 'reset').slice(-1)[0];
  check('and the link comes back to this page, to choose one', [reset.email, new URL(reset.redirect).pathname,
    new URL(reset.redirect).search], ['sam@example.com', '/account/', '?reset=1']);
  // following the link from the email: a session for this purpose, and the address says so
  await p.evaluate(() => localStorage.setItem('fake.auth', JSON.stringify({ id: 'u-73616d406578616d706c', email: 'sam@example.com' })));
  await p.goto(SITE + new URL(reset.redirect).pathname + new URL(reset.redirect).search + '#access_token=x&type=recovery');
  await p.waitForTimeout(1200);
  check('it asks for a new password', await view(), 'viewReset');
  await p.fill('#newPassword', 'brandnew1'); await p.click('#resetForm .go');
  await p.waitForURL('**/app/', { timeout: 8000 }).catch(() => {});
  check('and then you are in', path(), '/app/');

  console.log('\n--- an address that has to be confirmed ---');
  await post('/__auth', { confirmEmail: true });
  await p.evaluate(() => localStorage.removeItem('fake.auth'));
  await p.goto(SITE + '/account/#signup'); await p.waitForTimeout(1200);
  await p.fill('#email', 'kai@example.com'); await p.fill('#password', 'longenough');
  await p.click('#formGo'); await p.waitForTimeout(1000);
  check('it says to check your email', [await view(), await said('sentTitle')], ['viewSent', 'check your email']);
  await post('/__auth', { confirmEmail: false });

  console.log('\n--- deleting it ---');
  await p.goto(SITE + '/account/#signin'); await p.waitForTimeout(1200);
  await p.fill('#email', 'sam@example.com'); await p.fill('#password', 'brandnew1');
  await p.click('#formGo'); await p.waitForURL('**/app/', { timeout: 8000 }).catch(() => {});
  await p.goto(SITE + '/account/'); await p.waitForTimeout(1200);
  await p.locator('#deleteRow summary').click(); await p.waitForTimeout(200);
  check('it says what it means first', await p.evaluate(() => /cannot be undone/.test(document.getElementById('deleteRow').textContent)), true);
  await p.click('#deleteBtn'); await p.waitForTimeout(900);
  check('then it is gone, from the server too', [await view(), (await post('/__auth')).users.includes('sam@example.com')], ['viewForm', false]);
  check('and nothing of it is left there', (await post('/__dump')).tasks.filter(r => r.user_id === 'u-73616d406578616d706c').length, 0);

  console.log('\n--- signed out, the desk says where to go ---');
  await p.goto(SITE + '/app/'); await p.waitForTimeout(1500);
  await p.click('#syncBtn'); await p.waitForTimeout(400);
  check('to the sign-in page', await p.evaluate(() => ({
    signIn: document.getElementById('signInLink').getAttribute('href'),
    make: document.getElementById('makeLink').getAttribute('href') })),
    { signIn: '../account/#signin', make: '../account/#signup' });

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await browser.close(); db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
