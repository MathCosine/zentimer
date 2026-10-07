/* Your calendar, read in: a Google-format calendar with tutoring every Tuesday
   and Thursday, one Thursday skipped, one Tuesday moved, a club, a cancelled
   event and an all-day one -- served by a stand-in for the calendar relay, in
   Los Angeles time, on a Tuesday at three in the afternoon. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '33333333-3333-3333-3333-333333333333';
const DB = 'http://127.0.0.1:8901';
const LINK = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123def/basic.ics';
const AT = new Date('2026-10-06T15:00:00-07:00');           // Tuesday, 3pm in Los Angeles

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VTIMEZONE', 'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT', 'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST', 'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE',
  // tutoring, every Tuesday and Thursday at four
  'BEGIN:VEVENT', 'UID:tutor@test', 'SUMMARY:Tutoring',
  'DTSTART;TZID=America/Los_Angeles:20260901T160000', 'DTEND;TZID=America/Los_Angeles:20260901T170000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'EXDATE;TZID=America/Los_Angeles:20261008T160000', 'END:VEVENT',
  // ...except next Tuesday's, moved to five
  'BEGIN:VEVENT', 'UID:tutor@test', 'SUMMARY:Tutoring (moved)',
  'RECURRENCE-ID;TZID=America/Los_Angeles:20261013T160000',
  'DTSTART;TZID=America/Los_Angeles:20261013T170000', 'DTEND;TZID=America/Los_Angeles:20261013T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:club@test', 'SUMMARY:Robotics club',
  'DTSTART;TZID=America/Los_Angeles:20261006T190000', 'DTEND;TZID=America/Los_Angeles:20261006T200000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:gone@test', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED',
  'DTSTART;TZID=America/Los_Angeles:20261006T120000', 'DTEND;TZID=America/Los_Angeles:20261006T130000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:spirit@test', 'SUMMARY:Spirit week',
  'DTSTART;VALUE=DATE:20261006', 'DTEND;VALUE=DATE:20261007', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());

(async () => {
  const db = await start(8901);
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  async function device() {
    const ctx = await b.newContext({ viewport: { width: 646, height: 1000 }, timezoneId: 'America/Los_Angeles' });
    await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, USER) }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('PAGE: ' + e.message));
    p.on('console', m => { const t = m.text();
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|404/.test(t)) errs.push('CON: ' + t); });
    await p.clock.install({ time: AT });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(2500);
    return { ctx, p };
  }
  const calendarBlocks = (p, key) => p.evaluate(k => Store.blocks(k || Store.dayKey()).filter(b => b.calendar)
    .map(b => b.title + ' ' + b.start + '-' + b.end), key);

  const { ctx, p } = await device();
  const connect = async (link) => {
    await p.click('#settingsBtn'); await p.clock.runFor(500);
    await p.fill('.cal-link', link);
    await p.click('.cal-add .set-add'); await p.clock.runFor(2500);
  };

  console.log('--- before the relay is deployed ---');
  await connect(LINK);
  check('it says what is missing', await p.evaluate(() => /relay is not set up/.test(document.querySelector('.cal-status').textContent)), true);
  check('and the day is untouched', (await calendarBlocks(p)).length, 0);

  console.log('\n--- with it ---');
  await post('/__calendar', { ics: ICS });
  await p.locator('.set-row', { hasText: 'read it again' }).locator('button').click(); await p.clock.runFor(2500);
  check('it reads the calendar', await p.evaluate(() => /events this week/.test(document.querySelector('.cal-status').textContent)), true);
  check('the relay was asked for that link, exactly', (await post('/__calendarAsked')).asked.slice(-1), [LINK]);
  await p.click('#settingsClose'); await p.clock.runFor(600);

  check('today has tutoring at four and the club at seven, in Los Angeles time', await calendarBlocks(p),
    ['Tutoring 960-1020', 'Robotics club 1140-1200']);
  check('the cancelled one is not there', await p.evaluate(() =>
    Store.blocks(Store.dayKey()).some(b => /Cancelled/.test(b.title))), false);
  check('the all-day one is a line, not a block', await p.evaluate(() => document.querySelector('.allday-line').textContent), 'all day: Spirit week');

  console.log('\n--- repeating, skipped and moved ---');
  check('nothing on Wednesday', await calendarBlocks(p, '2026-10-07'), []);
  check('Thursday’s was skipped in the calendar', await calendarBlocks(p, '2026-10-08'), []);
  check('next Tuesday’s was moved to five', await calendarBlocks(p, '2026-10-13'), ['Tutoring (moved) 1020-1080']);
  check('and Thursday after that is back at four', await calendarBlocks(p, '2026-10-15'), ['Tutoring 960-1020']);

  console.log('\n--- the day plans round it ---');
  check('the now strip knows what is next', await p.evaluate(() =>
    [document.getElementById('nowTitle').textContent, document.getElementById('nowWhen').textContent]),
    ['free until 16:00', 'next: Tutoring at 16:00']);
  await p.evaluate(() => {
    const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'PHY Lab writeup', due: Store.dayKey(d), mins: 90 });
  });
  await p.clock.runFor(800);
  check('the queue says how long until it', await p.evaluate(() => document.querySelector('.queue-head span').textContent), '1h free');
  await p.locator('.aim-why', { hasText: 'plan' }).click(); await p.clock.runFor(500);
  check('tonight’s plan goes round it, and says so', await p.evaluate(() =>
    [...document.querySelectorAll('.aim-plan .plan-line')].map(n =>
      n.querySelector('.plan-at').textContent + ' ' + n.querySelector('.plan-name').textContent + ' ' + n.querySelector('.plan-mins').textContent)),
    ['15:00 PHY Lab writeup 1h', '16:00 Tutoring 1h', '17:00 ↳ PHY Lab writeup 30m', '19:00 Robotics club 1h']);

  // an hour before tutoring is better spent on something an hour long
  await p.evaluate(() => {
    const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'ANALYSIS Problem Set 2', due: Store.dayKey(d), mins: 60 });
  });
  await p.clock.runFor(800);
  check('a gap before an event goes to something that fits it whole', await p.evaluate(() =>
    [...document.querySelectorAll('.aim-plan .plan-line')].slice(0, 3).map(n =>
      n.querySelector('.plan-at').textContent + ' ' + n.querySelector('.plan-name').textContent)),
    ['15:00 ANALYSIS Problem Set 2', '16:00 Tutoring', '17:00 PHY Lab writeup']);
  check('and up next agrees', await p.evaluate(() => document.querySelector('.queue-row .queue-title').textContent),
    'ANALYSIS Problem Set 2');

  console.log('\n--- it lives in the calendar, not here ---');
  await p.click('#timesBtn'); await p.clock.runFor(700);
  const ev = p.locator('.block.is-calendar').first();
  check('it is drawn as a calendar event', await ev.count() > 0, true);
  check('with nothing to grab it by', await ev.locator('.block-grip').count(), 0);
  const box = await ev.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 6 }); await p.mouse.up();
  await p.clock.runFor(500);
  check('dragging it moves nothing', (await calendarBlocks(p))[0], 'Tutoring 960-1020');
  check('and none of it is stored as yours', await p.evaluate(() => Store.state().blocks.some(b => b.calendar)), false);
  check('so none of it syncs', (await post('/__dump')).blocks.some(r => /Tutoring|Robotics/.test(r.title || '')), false);
  // ten past four, during tutoring: a focus session is yours, not the event's
  await p.clock.fastForward('01:10:00'); await p.clock.runFor(1000);
  await p.click('#startPause'); await p.clock.runFor(3 * 60 * 1000);
  await p.click('#startPause'); await p.clock.runFor(500);
  const logs = await p.evaluate(() => Store.state().logs.map(l => l.blockId || ''));
  check('a session run during it is not filed against the event', logs.some(l => /^cal:/.test(l)), false);

  console.log('\n--- the link belongs to the account ---');
  check('it is kept in the account', ((await post('/__dump')).prefs.find(r => r.user_id === USER) || { data: {} }).data.calendars, [LINK]);
  const two = await device();
  await two.p.clock.runFor(3000);
  check('a second browser shows the calendar without being told', await calendarBlocks(two.p),
    ['Tutoring 960-1020', 'Robotics club 1140-1200']);
  await two.ctx.close();

  console.log('\n--- offline, it shows what it read last ---');
  await post('/__calendar', { ics: null });
  await p.reload(); await p.clock.runFor(2500);
  check('the day still has it', await calendarBlocks(p), ['Tutoring 960-1020', 'Robotics club 1140-1200']);

  console.log('\n--- the wrong link gets a useful answer ---');
  await p.click('#settingsBtn'); await p.clock.runFor(500);
  await p.fill('.cal-link', 'https://calendar.google.com/calendar/u/0/r');
  await p.click('.cal-add .set-add'); await p.clock.runFor(800);
  check('it says which link it needs', await p.evaluate(() => /Secret address in iCal format/.test(document.querySelector('.cal-said').textContent)), true);
  await p.fill('.cal-link', 'https://example.com/steal.ics');
  await p.click('.cal-add .set-add'); await p.clock.runFor(800);
  check('and will not fetch just anything', await p.evaluate(() => /not a calendar link pip knows/.test(document.querySelector('.cal-said').textContent)), true);

  console.log('\n--- removing it ---');
  await p.locator('.set-row', { hasText: 'Google calendar' }).locator('button', { hasText: 'remove' }).click();
  await p.clock.runFor(1500);
  check('the events go', await calendarBlocks(p), []);
  check('from the account too', ((await post('/__dump')).prefs.find(r => r.user_id === USER) || { data: {} }).data.calendars, []);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await ctx.close(); await b.close(); db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
