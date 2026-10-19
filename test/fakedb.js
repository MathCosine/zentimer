/* A stand-in for Supabase: one shared in-memory database over HTTP, so two
   real browsers can sync against it. The server assigns `updated` from its own
   monotonic counter, exactly as the trigger in schema.sql does. */
const http = require('http');

function makeDb() {
  const tables = { lists: [], tags: [], tasks: [], blocks: [], logs: [], prefs: [], pip_state: [] };
  let clock = 1000;
  return {
    tables,
    stamp() { return ++clock; },
    reset() { Object.keys(tables).forEach(k => { tables[k] = []; }); clock = 1000; }
  };
}

function start(port) {
  const db = makeDb();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let out;
      try {
        const q = body ? JSON.parse(body) : {};
        const rows = db.tables[q.table] || (db.tables[q.table] = []);
        if (req.url === '/select') {
          let hit = rows.filter(r => !q.user || r.user_id === q.user);
          if (typeof q.gt === 'number') hit = hit.filter(r => (r.updated || 0) > q.gt);
          if (q.eq) Object.keys(q.eq).forEach(k => { hit = hit.filter(r => r[k] === q.eq[k]); });
          out = { data: hit.map(r => ({ ...r })), error: null };
        } else if (req.url === '/upsert') {
          const written = q.rows.map(incoming => {
            const key = incoming.id !== undefined ? 'id' : 'user_id';
            const at = rows.findIndex(r => r.user_id === incoming.user_id && r[key] === incoming[key]);
            const row = { ...(at >= 0 ? rows[at] : {}), ...incoming, updated: db.stamp() };
            if (at >= 0) rows[at] = row; else rows.push(row);
            return { ...row };
          });
          out = { data: written, error: null };
        } else if (req.url === '/__reset') { db.reset(); out = { ok: true }; }
        else if (req.url === '/__dump') { out = db.tables; }
        else if (req.url === '/__calendar') { db.calendar = q.ics || null; db.calendarAsked = []; out = { ok: true }; }
        else if (req.url === '/__calendarAsked') { out = { asked: db.calendarAsked || [] }; }
        else if (req.url === '/function/calendar') {
          // as the real relay: a calendar link in, the calendar out
          (db.calendarAsked = db.calendarAsked || []).push(q.body && q.body.url);
          if (!db.calendar) { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' });
          res.end(db.calendar);
          return;
        }
        else if (req.url === '/__ai') { db.ai = q; db.aiAsked = []; out = { ok: true }; }
        else if (req.url === '/__aiAsked') { out = { asked: db.aiAsked || [] }; }
        else if (req.url === '/function/ai') {
          // as the real relay: a question in, a checked answer out -- or a refusal
          const ask = (q.body || {});
          (db.aiAsked = db.aiAsked || []).push(ask);
          const want = (db.ai || {})[ask.kind];
          const status = !db.ai ? 404 : !want ? 502 : want.status || 200;
          res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify(status === 200 ? { result: typeof want.result === 'function' ? want.result(ask) : want.result,
            meta: want.meta || { used: 'groq', judged: false, heard: ['groq', 'gemini'] } } : { error: want && want.error || 'no' }));
          return;
        }
        else if (req.url.startsWith('/auth/')) {
          // just enough of Supabase Auth: accounts with passwords, and a log of what was asked
          const users = db.users = db.users || {};
          const log = db.authLog = db.authLog || [];
          log.push({ what: req.url.slice(6), ...q, password: undefined });
          if (req.url === '/auth/signup') {
            if (users[q.email]) out = { error: { message: 'User already registered' } };
            else {
              users[q.email] = { id: 'u-' + Buffer.from(q.email).toString('hex').slice(0, 20), email: q.email, password: q.password };
              out = { user: { id: users[q.email].id, email: q.email }, confirm: !!db.confirmEmail };
            }
          } else if (req.url === '/auth/signin') {
            const u = users[q.email];
            out = u && u.password === q.password ? { user: { id: u.id, email: u.email } }
              : { error: { message: 'Invalid login credentials' } };
          } else if (req.url === '/auth/update') {
            Object.values(users).forEach(u => { if (u.id === q.id) u.password = q.password; });
            out = { ok: true };
          } else if (req.url === '/auth/delete') {
            Object.keys(users).forEach(k => { if (users[k].id === q.id) delete users[k]; });
            Object.keys(db.tables).forEach(t => { db.tables[t] = db.tables[t].filter(r => r.user_id !== q.id); });
            out = { ok: true };
          } else if (req.url === '/auth/oauth') {
            const email = 'google.person@gmail.com';
            users[email] = users[email] || { id: 'u-google', email, password: null };
            out = { user: { id: users[email].id, email } };
          } else out = { ok: true };
        }
        else if (req.url === '/__auth') { db.confirmEmail = !!q.confirmEmail; out = { log: db.authLog || [], users: Object.keys(db.users || {}) }; }
        else if (req.url === '/__seedLegacy') {
          db.tables.pip_state.push({ id: 'plan', user_id: q.user, data: q.doc, updated: db.stamp() });
          out = { ok: true };
        } else out = { error: { message: 'no route ' + req.url } };
      } catch (e) { out = { error: { message: e.message } }; }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

module.exports = { start };
if (require.main === module) start(8901).then(() => console.log('fake db on 8901'));
