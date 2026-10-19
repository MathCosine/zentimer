/* Served in place of https://js.puter.com/v2/. Implements the calls pip makes
   -- auth.isSignedIn/signIn/signOut/getUser and ai.chat -- against the fake
   server, which decides what each model answers, records what it was asked,
   and can pretend a model is retired, will not take a schema, or that the
   month's allowance is gone. */
module.exports = (dbUrl) => `
(function () {
  var DB = ${JSON.stringify(dbUrl)};
  var KEY = 'fake.puter';
  function who() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function post(path, body) {
    return fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); });
  }
  window.puter = {
    quiet: false,
    auth: {
      isSignedIn: function () { return !!who(); },
      signIn: function () {
        return post('/puter/signin').then(function (res) {
          if (res.error) throw { error: res.error };
          localStorage.setItem(KEY, JSON.stringify(res.user));
          return { success: true, user: res.user };
        });
      },
      signOut: function () { localStorage.removeItem(KEY); },
      getUser: function () { return Promise.resolve(who()); }
    },
    ai: {
      chat: function (messages, options) {
        if (!who()) return Promise.reject({ error: { message: 'Unauthorized', code: 401 } });
        return post('/puter/chat', {
          model: options && options.model, strict: !!(options && options.outputFormat),
          name: options && options.outputFormat && options.outputFormat.name,
          system: messages[0].content, user: messages[1].content
        }).then(function (res) {
          if (res.error) throw { message: res.error };
          return { message: { role: 'assistant', content: typeof res.content === 'string' ? res.content : JSON.stringify(res.content) }, finish_reason: 'stop' };
        });
      }
    }
  };
})();
`;
