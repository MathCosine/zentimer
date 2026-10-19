/* Served in place of the supabase-js ESM bundle. Implements only the calls
   sync.js actually makes, against the fake database over HTTP. */
module.exports = (dbUrl, userId, options) => `
const DB = ${JSON.stringify(dbUrl)};
const FIXED = ${JSON.stringify(userId)};
/* With realAuth, sign-in is real enough to test the account pages: accounts
   with passwords on the fake server, a session kept in this browser that
   signing out removes. Without it, everyone is FIXED and always signed in. */
const REAL = ${JSON.stringify(!!(options && options.realAuth))};
const SESSION = 'fake.auth';
const who = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) { return null; } };
const me = () => REAL ? ((who() || {}).id || null) : FIXED;
const hold = (user) => { if (user) localStorage.setItem(SESSION, JSON.stringify(user)); else localStorage.removeItem(SESSION); };

async function call(path, body) {
  const res = await fetch(DB + path, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

function query(table) {
  const q = { table, user: me(), gt: undefined, eq: null, _single: false };
  const builder = {
    select() { return builder; },
    gt(col, n) { q.gt = n; return builder; },
    eq(col, v) { (q.eq || (q.eq = {}))[col] = v; return builder; },
    order() { return builder; },
    maybeSingle() { q._single = true; return builder; },
    upsert(rows) {
      const list = Array.isArray(rows) ? rows : [rows];
      q._write = list.map(r => ({ ...r, user_id: r.user_id || me() }));
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
    auth: REAL ? {
      getUser: async () => ({ data: { user: who() }, error: null }),
      getSession: async () => ({ data: { session: who() ? { user: who() } : null } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async (c) => {
        const res = await call('/auth/signin', c);
        if (res.error) return { data: {}, error: res.error };
        hold(res.user);
        return { data: { user: res.user, session: {} }, error: null };
      },
      signUp: async (c) => {
        const res = await call('/auth/signup', { email: c.email, password: c.password, redirect: c.options && c.options.emailRedirectTo });
        if (res.error) return { data: {}, error: res.error };
        if (res.confirm) return { data: { user: res.user, session: null }, error: null };
        hold(res.user);
        return { data: { user: res.user, session: {} }, error: null };
      },
      signOut: async () => { hold(null); return { error: null }; },
      resetPasswordForEmail: async (email, o) => { await call('/auth/reset', { email, redirect: o && o.redirectTo }); return { data: {}, error: null }; },
      updateUser: async (c) => {
        if (!who()) return { data: {}, error: { message: 'Auth session missing!' } };
        await call('/auth/update', { id: who().id, password: c.password });
        return { data: { user: who() }, error: null };
      },
      signInWithOAuth: async (o) => {
        const res = await call('/auth/oauth', { provider: o.provider, redirect: o.options && o.options.redirectTo });
        hold(res.user);
        location.href = o.options.redirectTo + '?code=fake';
        return { data: {}, error: null };
      }
    } : {
      getUser: async () => ({ data: { user: { id: FIXED, email: 'you@example.com' } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: FIXED } } } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async (c) => ({ data: { user: { id: FIXED, email: c.email }, session: {} }, error: null }),
      signUp: async (c) => ({ data: { user: { id: FIXED, email: c.email }, session: {} }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null })
    },
    channel() {
      return { on() { return this; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return this; } };
    },
    removeChannel() {},
    rpc: async (name) => {
      if (REAL && name === 'pip_delete_me') { await call('/auth/delete', { id: me() }); hold(null); }
      return { data: null, error: null };
    },
    // as supabase-js: a text body comes back as text, a failure as an error with its status
    functions: {
      async invoke(name, opts) {
        const res = await fetch(DB + '/function/' + name, { method: 'POST', body: JSON.stringify({ body: opts && opts.body }) });
        const text = await res.text();
        if (!res.ok) return { data: null, error: { message: 'Edge Function returned a non-2xx status code',
          context: { status: res.status, json: async () => JSON.parse(text) } } };
        return { data: text, error: null };
      }
    }
  };
}
`;
