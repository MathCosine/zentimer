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
