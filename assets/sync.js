/* Per-row sync.
   One row per thing rather than one document per person, so two devices
   editing different tasks both win. The rules, in the order that keeps data:
     - the server stamps every write, because device clocks disagree and a
       client-written stamp makes "last write wins" mean "fastest clock wins";
     - a row this device has changed but not yet sent is never overwritten by
       an incoming copy, because ours is newer by definition;
     - otherwise the later stamp wins;
     - deletes are tombstones, because a row that is merely absent cannot be
       told apart from one we have not pulled yet.
   Everything is queued in an outbox that survives a reload, so edits made with
   no connection go up when there is one. */
window.Sync = (function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  var OUTBOX = 'pip.sync.outbox';
  var CURSOR = 'pip.sync.cursor';

  /* ---------- what each table looks like on the wire ---------- */

  function plain(row, extra) {
    var out = { id: row.id };
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    out.deleted_at = row.deletedAt || null;
    return out;
  }

  var TABLES = [
    {
      name: 'lists', key: 'lists',
      to: function (r) { return plain(r, { name: r.name || '', ord: r.order || 0 }); },
      from: function (r) { return { id: r.id, name: r.name || '', order: r.ord || 0 }; }
    },
    {
      name: 'tags', key: 'tags',
      to: function (r) {
        return plain(r, {
          name: r.name || '', colour: r.color || 'blue',
          kind: r.kind || 'work', daily: typeof r.daily === 'number' ? r.daily : null,
          rank: typeof r.rank === 'number' ? r.rank : null
        });
      },
      from: function (r) {
        return {
          id: r.id, name: r.name || '', color: r.colour || 'blue',
          kind: r.kind || 'work', daily: typeof r.daily === 'number' ? r.daily : null,
          rank: typeof r.rank === 'number' ? r.rank : null
        };
      }
    },
    {
      name: 'tasks', key: 'tasks',
      to: function (r) {
        return plain(r, {
          list_id: r.listId || null, title: r.title || '', tags: r.tags || [],
          due: r.due || null, repeat: r.repeat || 'none',
          weekday: typeof r.weekday === 'number' ? r.weekday : null,
          at: typeof r.at === 'number' ? r.at : null,
          mins: r.mins || 30, done: !!r.done, done_at: r.doneAt || null,
          progress: r.progress || 0,
          completions: r.completions || {}, skips: r.skips || {},
          ord: r.order || 0, created: r.created || null
        });
      },
      from: function (r) {
        return {
          id: r.id, listId: r.list_id || null, title: r.title || '', tags: r.tags || [],
          due: r.due || null, repeat: r.repeat || 'none',
          weekday: typeof r.weekday === 'number' ? r.weekday : null,
          at: typeof r.at === 'number' ? r.at : null,
          mins: r.mins || 30, done: !!r.done, doneAt: r.done_at || null,
          progress: r.progress || 0,
          completions: r.completions || {}, skips: r.skips || {},
          order: r.ord || 0, created: r.created || null
        };
      }
    },
    {
      name: 'blocks', key: 'blocks',
      to: function (r) {
        return plain(r, {
          date: r.date || '', start_min: r.start || 0, end_min: r.end || 30,
          task_id: r.taskId || null, title: r.title || '',
          done: !!r.done, ran_over: r.ranOver || 0
        });
      },
      from: function (r) {
        return {
          id: r.id, date: r.date || '', start: r.start_min || 0, end: r.end_min || 30,
          taskId: r.task_id || null, title: r.title || '',
          done: !!r.done, ranOver: r.ran_over || 0
        };
      }
    },
    {
      name: 'logs', key: 'logs',
      to: function (r) {
        return plain(r, {
          task_id: r.taskId || null, block_id: r.blockId || null,
          date: r.date || '', ms: r.ms || 0, at: r.at || 0
        });
      },
      from: function (r) {
        return {
          id: r.id, taskId: r.task_id || null, blockId: r.block_id || null,
          date: r.date || '', ms: r.ms || 0, at: r.at || 0
        };
      }
    }
  ];

  function tableNamed(name) {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].name === name) return TABLES[i];
    return null;
  }

  /* ---------- state ---------- */

  var app = null;              // the adapter the store hands us
  var client = null;
  var userId = null;
  var userEmail = null;
  var status = 'off';
  var ready = false;           // have we reconciled with the server yet?
  var config = null;
  var outbox = load(OUTBOX, {});
  var cursor = load(CURSOR, {});
  var flushTimer = 0;
  var channel = null;
  var note = function () {};

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch (e) { return fallback; }
  }
  function keep(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function say(text) { status = text; note(text); }

  /* ---------- credentials ---------- */

  function usable(where) {
    return where && typeof where.url === 'string' && typeof where.key === 'string' &&
           where.url.trim().length > 8 && where.key.trim().length > 8;
  }

  function creds() {
    if (config) return config;
    try {
      var saved = JSON.parse(localStorage.getItem('pip.supabase') || 'null');
      if (usable(saved)) return (config = { url: saved.url.trim(), key: saved.key.trim() });
    } catch (e) { /* ignore */ }
    var baked = window.PIP_CONFIG && window.PIP_CONFIG.supabase;
    if (usable(baked)) return (config = { url: baked.url.trim(), key: baked.key.trim() });
    return null;
  }

  /* ---------- connecting ---------- */

  function connect() {
    var where = creds();
    if (!where) { say('off'); return Promise.resolve(false); }
    say('connecting');
    return import(/* webpackIgnore: true */ CDN)
      .then(function (mod) {
        client = mod.createClient(where.url, where.key, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        client.auth.onAuthStateChange(function (event) {
          if (event === 'SIGNED_OUT') { ready = false; userId = null; userEmail = null; say('signed out'); }
        });
        return client.auth.getUser();
      })
      .then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) { say('signed out'); return false; }
        userId = user.id;
        userEmail = user.email || null;
        return start();
      })
      .catch(function (err) {
        var why = (err && err.message ? err.message : String(err));
        if (/dynamically imported module|Failed to fetch|NetworkError/i.test(why)) say('no connection — working locally');
        else if (/Invalid API key|JWT/i.test(why)) say('that key was not accepted');
        else if (/not confirmed/i.test(why)) say('check your email to confirm the address');
        else say(why.slice(0, 70));
        return false;
      });
  }

  /* first migrate, then pull everything, then send anything waiting */
  function start() {
    say('syncing');
    return migrate()
      .then(pullAll)
      .then(function () {
        ready = true;
        listen();
        return flush();
      })
      .then(function () { say('synced'); return true; })
      .catch(function (err) {
        ready = false;
        say('could not sync — working locally');
        if (window.console) console.warn('[pip] sync stopped:', err);
        return false;
      });
  }

  /* ---------- out of the old single document ---------- */

  /* The old shape kept everything as one row in pip_state. Explode it into
     rows once, mark the account migrated, and leave the old row exactly where
     it is: it is the way back if any of this goes wrong. */
  function migrate() {
    return client.from('prefs').select('migrated, data').maybeSingle()
      .then(function (res) {
        if (res && res.data && res.data.migrated) return false;
        return client.from('pip_state').select('data').eq('id', 'plan').maybeSingle()
          .then(function (old) {
            var doc = old && old.data && old.data.data;
            if (doc && doc.version) app.adoptLegacy(doc);   // merged into whatever is here
            return client.from('prefs')
              .upsert({ user_id: userId, migrated: true, data: (res && res.data && res.data.data) || {} },
                      { onConflict: 'user_id' });
          })
          .then(function () { return true; })
          .catch(function (err) {
            // no pip_state table at all is the normal case for a new account
            if (/does not exist|schema cache|relation/i.test(err && err.message || '')) {
              return client.from('prefs')
                .upsert({ user_id: userId, migrated: true }, { onConflict: 'user_id' })
                .then(function () { return true; });
            }
            throw err;
          });
      });
  }

  /* ---------- pulling ---------- */

  function pullAll() {
    return TABLES.reduce(function (chain, table) {
      return chain.then(function () { return pullTable(table); });
    }, Promise.resolve());
  }

  function pullTable(table) {
    var since = cursor[table.name] || 0;
    return client.from(table.name).select('*').gt('updated', since).order('updated', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        apply(table, res.data || []);
      });
  }

  /* one incoming row, decided against what is here */
  function apply(table, rows) {
    if (!rows.length) return;
    var here = app.rows(table.key);
    var byId = {};
    here.forEach(function (row, i) { byId[row.id] = i; });
    var touched = false;
    var newest = cursor[table.name] || 0;

    rows.forEach(function (row) {
      if (row.updated > newest) newest = row.updated;

      // ours is unsent, so ours is newer than anything that could come back
      if (outbox[table.name] && outbox[table.name][row.id]) return;

      var mapped = table.from(row);
      mapped.updated = row.updated;
      mapped.deletedAt = row.deleted_at || null;

      var at = byId[row.id];
      if (at === undefined) {
        here.push(mapped);
        touched = true;
      } else if ((row.updated || 0) > (here[at].updated || 0)) {
        // keep any purely local field the server does not carry
        var wasRoutine = here[at].routine;
        here[at] = mapped;
        if (wasRoutine !== undefined) here[at].routine = wasRoutine;
        touched = true;
      }
      app.markSynced(table.key, row.id);
    });

    cursor[table.name] = newest;
    keep(CURSOR, cursor);
    if (touched) app.merged();
  }

  /* ---------- pushing ---------- */

  function markDirty(key, id) {
    var table = TABLES.filter(function (t) { return t.key === key; })[0];
    if (!table) return;
    (outbox[table.name] || (outbox[table.name] = {}))[id] = 1;
    keep(OUTBOX, outbox);
    if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = 0; flush(); }, 700);
  }

  function pending() {
    return TABLES.reduce(function (n, t) {
      return n + Object.keys(outbox[t.name] || {}).length;
    }, 0);
  }

  var sent = false;

  function flush() {
    if (!client || !ready || !userId) return Promise.resolve(false);
    sent = false;
    return TABLES.reduce(function (chain, table) {
      return chain.then(function () { return flushTable(table); });
    }, Promise.resolve())
      // anything that landed while we were writing comes down now, rather
      // than waiting for the next load
      .then(function () { return sent ? pullAll() : null; })
      .then(function () { if (status !== 'synced') say('synced'); return true; });
  }

  function flushTable(table) {
    var ids = Object.keys(outbox[table.name] || {});
    if (!ids.length) return Promise.resolve();

    var here = app.rows(table.key);
    var byId = {};
    here.forEach(function (row) { byId[row.id] = row; });

    var payload = ids.map(function (id) {
      var row = byId[id];
      if (!row) return null;
      var out = table.to(row);
      out.user_id = userId;
      delete out.updated;                 // the server decides the stamp
      return out;
    }).filter(Boolean);

    if (!payload.length) {
      delete outbox[table.name];
      keep(OUTBOX, outbox);
      return Promise.resolve();
    }

    return client.from(table.name).upsert(payload, { onConflict: 'user_id,id' }).select('id, updated')
      .then(function (res) {
        if (res.error) throw res.error;
        (res.data || []).forEach(function (row) {
          var mine = byId[row.id];
          if (mine) mine.updated = row.updated;
          if (outbox[table.name]) delete outbox[table.name][row.id];
          app.markSynced(table.key, row.id);
        });
        /* The cursor deliberately does not move here. Our write is stamped
           later than rows another device wrote while we were composing it, so
           taking our own stamp as "seen everything up to here" would skip
           theirs for good. Only a pull, which actually looked, may move it. */
        keep(OUTBOX, outbox);
        sent = true;
        app.stamped();
      })
      .catch(function (err) {
        // leave the ids in the outbox: they go up on the next try
        var why = String(err && err.message || err);
        if (/column .* does not exist|schema cache/i.test(why)) {
          say('run supabase/schema.sql again — this version added a column');
        } else {
          say('waiting to sync — ' + why.slice(0, 40));
        }
      });
  }

  /* ---------- realtime ---------- */

  function listen() {
    if (channel || !client) return;
    channel = client.channel('pip-rows');
    TABLES.forEach(function (table) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: table.name, filter: 'user_id=eq.' + userId },
        function (payload) {
          if (payload && payload.new && payload.new.id) apply(table, [payload.new]);
        });
    });
    channel.subscribe(function (state) {
      // realtime is a nicety; without it a change lands on the next load
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { channel = null; }
    });
  }

  /* ---------- api ---------- */

  return {
    init: function (adapter, onStatus) { app = adapter; note = onStatus || note; },
    connect: connect,
    markDirty: markDirty,
    flush: flush,
    pending: pending,
    tables: function () { return TABLES.map(function (t) { return t.key; }); },
    ready: function () { return ready; },
    status: function () { return status; },
    configured: function () { return !!creds(); },
    client: function () { return client; },
    userId: function () { return userId; },

    save: function (url, key) {
      config = { url: url, key: key };
      keep('pip.supabase', config);
      return connect();
    },

    signIn: function (email, password) {
      if (!client) return Promise.reject(new Error('not connected'));
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw res.error;
          userId = res.data.user.id;
          userEmail = res.data.user.email || null;
          forgetCursors();            // this account's rows have never been seen here
          return start();
        });
    },

    signUp: function (email, password) {
      if (!client) return Promise.reject(new Error('not connected'));
      return client.auth.signUp({
        email: email, password: password,
        options: { emailRedirectTo: location.origin + location.pathname }
      }).then(function (res) {
        if (res.error) throw res.error;
        if (res.data.session) {
          userId = res.data.user.id;
          userEmail = res.data.user.email || null;
          forgetCursors();
          return start();
        }
        say('check your email to confirm the address');
        return false;
      });
    },

    email: function () { return userEmail; },
    // being signed in is having an id; an email is only how we name you
    signedIn: function () { return !!userId; },

    resetPassword: function (email) {
      if (!client) return Promise.reject(new Error('not connected'));
      return client.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname
      }).then(function (res) {
        if (res.error) throw res.error;
        say('check your email for the reset link');
        return true;
      });
    },

    setPassword: function (password) {
      if (!client) return Promise.reject(new Error('not connected'));
      return client.auth.updateUser({ password: password }).then(function (res) {
        if (res.error) throw res.error;
        say('password changed');
        return true;
      });
    },

    /* Deleting the account removes the auth user, and every table cascades
       from it. The client cannot reach auth.users directly, so this is a
       security-definer function the schema installs. */
    deleteAccount: function () {
      if (!client) return Promise.reject(new Error('not connected'));
      return client.rpc('pip_delete_me').then(function (res) {
        if (res.error) throw res.error;
        return client.auth.signOut();
      }).then(function () {
        ready = false; userId = null; userEmail = null;
        forgetCursors();
        say('account deleted');
        return true;
      });
    },

    signOut: function () {
      if (!client) return Promise.resolve();
      return client.auth.signOut().then(function () {
        ready = false; userId = null; userEmail = null;
        forgetCursors();
        if (channel) { try { client.removeChannel(channel); } catch (e) {} channel = null; }
        say('signed out');
      });
    }
  };

  function forgetCursors() {
    cursor = {};
    outbox = {};
    keep(CURSOR, cursor);
    keep(OUTBOX, outbox);
  }
})();
