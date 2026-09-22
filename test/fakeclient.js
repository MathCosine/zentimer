/* Served in place of the supabase-js ESM bundle. Implements only the calls
   sync.js actually makes, against the fake database over HTTP. */
module.exports = (dbUrl, userId) => `
const DB = ${JSON.stringify(dbUrl)};
const USER = ${JSON.stringify(userId)};

async function call(path, body) {
  const res = await fetch(DB + path, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

function query(table) {
  const q = { table, user: USER, gt: undefined, eq: null, _single: false };
  const builder = {
    select() { return builder; },
    gt(col, n) { q.gt = n; return builder; },
    eq(col, v) { (q.eq || (q.eq = {}))[col] = v; return builder; },
    order() { return builder; },
    maybeSingle() { q._single = true; return builder; },
    upsert(rows) {
      const list = Array.isArray(rows) ? rows : [rows];
      q._write = list.map(r => ({ ...r, user_id: r.user_id || USER }));
      return builder;
    },
    then(resolve, reject) {
      const run = q._write
        ? call('/upsert', { table, rows: q._write })
        : call('/select', q);
      return run.then(res => {
        if (res.error) return resolve({ data: null, error: res.error });
        let data = res.data || [];
        if (q._single) data = data.length ? data[0] : null;
        else if (!Array.isArray(data)) data = [data];
        if (!q._write && !q._single) data.sort((a, b) => (a.updated||0) - (b.updated||0));
        return resolve({ data, error: null });
      }, reject);
    }
  };
  return builder;
}

export function createClient() {
  return {
    from: query,
    auth: {
      getUser: async () => ({ data: { user: { id: USER, email: 'you@example.com' } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: USER } } } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async (c) => ({ data: { user: { id: USER, email: c.email }, session: {} }, error: null }),
      signUp: async (c) => ({ data: { user: { id: USER, email: c.email }, session: {} }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null })
    },
    channel() {
      return { on() { return this; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return this; } };
    },
    removeChannel() {},
    rpc: async () => ({ data: null, error: null })
  };
}
`;
