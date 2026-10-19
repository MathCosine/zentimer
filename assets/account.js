/* The account page: signing in, making an account, a forgotten password and
   the new one chosen from the email, Google if this copy of pip has it
   switched on, and -- once you are in -- your account itself. It uses the
   same store and sync as the desk, so signing in here is exactly signing in
   there: same session, same data, nothing to do twice. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['viewForm', 'viewForgot', 'viewReset', 'viewSent', 'viewAccount'];
  // the reset email lands here with this in the address; read it before the
  // sign-in library tidies the address away
  var params = new URLSearchParams(location.search);
  var recovering = /type=recovery/.test(location.hash + location.search) || params.get('reset') === '1';
  function stillRecovering() {
    try { if (sessionStorage.getItem('pip.recovering')) recovering = true; } catch (e) {}
    return recovering;
  }
  var mode = /signup|sign-up|make/.test(location.hash) || params.get('mode') === 'signup' ? 'up' : 'in';
  var busy = false;
  var current = null;

  function show(id) {
    if (current === id) return;
    current = id;
    VIEWS.forEach(function (v) { $(v).hidden = v !== id; });
    $('advanced').hidden = id === 'viewAccount' || id === 'viewReset';
    if (window.Motion) Motion.play($(id), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });
  }

  function say(id, text) {
    var where = $(id);
    where.textContent = text || '';
    if (text && window.Motion) Motion.nudge(where.closest('form') || where);
  }

  /* The server's words, in pip's. */
  function trouble(err) {
    var why = (err && err.message) || String(err || '');
    if (/not confirmed/i.test(why)) return 'check your email to confirm the address first';
    if (/already registered|already exists/i.test(why)) return 'that email already has an account — sign in instead';
    if (/invalid login|invalid credentials/i.test(why)) return 'that email and password don’t match';
    if (/password/i.test(why) && /short|least|6|weak/i.test(why)) return 'a password needs at least six characters';
    if (/rate|too many|security purposes/i.test(why)) return 'too many tries — wait a minute and try again';
    if (/fetch|network|connection/i.test(why)) return 'no connection right now — try again in a moment';
    if (/not connected/i.test(why)) return 'accounts are not set up on this copy of pip';
    return why.slice(0, 100);
  }

  function working(button, on) {
    busy = on;
    button.disabled = on;
    button.classList.toggle('is-loading', on);
  }

  /* Ready to talk to the server: connected, or as connected as it is going
     to get. */
  function connected() {
    return new Promise(function (resolve) {
      var started = Date.now();
      (function wait() {
        var status = Store.remote.status();
        if (Store.remote.client() && status !== 'connecting') return resolve(true);
        if (!Store.remote.configured() || Date.now() - started > 12000) return resolve(!!Store.remote.client());
        setTimeout(wait, 120);
      })();
    });
  }

  /* Where to go once you are in: where you were sent from, the welcome for
     someone new, or straight to the desk. */
  function onward() {
    var next = params.get('next');
    if (next && /^\.\.\/|^\/[^/]/.test(next)) { location.href = next; return; }
    var welcomed = false;
    try { welcomed = !!localStorage.getItem('pip.welcomed'); } catch (e) {}
    location.href = welcomed || Store.tasks().length ? '../app/' : '../welcome/';
  }

  /* ---------- signing in, or making an account ---------- */

  function setMode(next, quiet) {
    mode = next;
    var up = mode === 'up';
    $('tabIn').setAttribute('aria-selected', String(!up));
    $('tabUp').setAttribute('aria-selected', String(up));
    $('authCard').classList.toggle('is-up', up);
    $('formTitle').textContent = up ? 'make your desk' : 'welcome back';
    $('formLede').textContent = up ? 'free, and it follows you to every device' : 'your desk, on every device you use';
    $('formGo').firstChild.textContent = up ? 'make my account' : 'sign in';
    $('password').autocomplete = up ? 'new-password' : 'current-password';
    $('passHint').hidden = !up;
    $('forgotLink').hidden = up;
    say('formSaid', '');
    if (!quiet) history.replaceState(null, '', location.pathname + location.search + (up ? '#signup' : '#signin'));
  }

  $('tabIn').addEventListener('click', function () { setMode('in'); });
  $('tabUp').addEventListener('click', function () { setMode('up'); });

  $('eye').addEventListener('click', function () {
    var shown = $('password').type === 'text';
    $('password').type = shown ? 'password' : 'text';
    $('eye').setAttribute('aria-pressed', String(!shown));
    $('eye').setAttribute('aria-label', shown ? 'Show the password' : 'Hide the password');
  });

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  $('authForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    var email = $('email').value.trim(), password = $('password').value;
    if (!EMAIL.test(email)) { say('formSaid', 'that doesn’t look like an email address'); $('email').focus(); return; }
    if (!password) { say('formSaid', 'and your password'); $('password').focus(); return; }
    if (mode === 'up' && password.length < 6) { say('formSaid', 'a password needs at least six characters'); $('password').focus(); return; }
    say('formSaid', '');
    var button = $('formGo');
    working(button, true);
    connected().then(function () {
      return mode === 'up' ? Store.remote.signUp(email, password) : Store.remote.signIn(email, password);
    }).then(function (inside) {
      working(button, false);
      if (mode === 'up' && !Store.remote.signedIn()) {
        $('sentTitle').textContent = 'check your email';
        $('sentLede').textContent = 'we sent a link to ' + email + ' — open it to finish making your account.';
        show('viewSent');
        return;
      }
      if (inside === false && !Store.remote.signedIn()) { say('formSaid', trouble(Store.remote.status())); return; }
      try { if (mode === 'up') localStorage.removeItem('pip.welcomed'); } catch (e) {}
      if (window.Pet) Pet.event('complete');
      onward();
    }, function (err) {
      working(button, false);
      say('formSaid', trouble(err));
    });
  });

  $('googleBtn').addEventListener('click', function () {
    if (busy) return;
    working($('googleBtn'), true);
    connected().then(function () {
      var client = Store.remote.client();
      if (!client) throw new Error('not connected');
      // new or returning, the welcome page knows which and sends you on
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname.replace(/account\/?(index\.html)?$/, 'welcome/') }
      });
    }).then(function (res) {
      if (res && res.error) throw res.error;
    }).catch(function (err) {
      working($('googleBtn'), false);
      say('formSaid', trouble(err));
    });
  });

  /* ---------- a forgotten password ---------- */

  $('forgotLink').addEventListener('click', function () {
    $('forgotEmail').value = $('email').value.trim();
    say('forgotSaid', '');
    show('viewForgot');
    $('forgotEmail').focus();
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (button) {
    button.addEventListener('click', function () { setMode('in'); show('viewForm'); });
  });

  $('forgotForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    var email = $('forgotEmail').value.trim();
    if (!EMAIL.test(email)) { say('forgotSaid', 'that doesn’t look like an email address'); return; }
    var button = event.target.querySelector('.go');
    working(button, true);
    connected().then(function () { return Store.remote.resetPassword(email); }).then(function () {
      working(button, false);
      $('sentTitle').textContent = 'on its way';
      $('sentLede').textContent = 'if ' + email + ' has an account, a link to choose a new password is in its inbox.';
      show('viewSent');
    }, function (err) {
      working(button, false);
      say('forgotSaid', trouble(err));
    });
  });

  $('resetForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    var password = $('newPassword').value;
    if (password.length < 6) { say('resetSaid', 'a password needs at least six characters'); return; }
    var button = event.target.querySelector('.go');
    working(button, true);
    connected().then(function () { return Store.remote.setPassword(password); }).then(function () {
      working(button, false);
      recovering = false;
      try { sessionStorage.removeItem('pip.recovering'); } catch (e) {}
      if (window.Motion) Motion.toast('password changed — you’re in');
      setTimeout(function () { location.href = '../app/'; }, 900);
    }, function (err) {
      working(button, false);
      say('resetSaid', /session|jwt|auth/i.test(String(err && err.message)) ? 'that link has expired — ask for a new one' : trouble(err));
    });
  });

  /* ---------- signed in ---------- */

  function drawAccount() {
    var email = Store.remote.email() || 'this account';
    $('acctEmail').textContent = email;
    $('acctFace').textContent = email.charAt(0).toUpperCase();
    var status = Store.remote.status();
    var waiting = Store.remote.pending();
    var text = status === 'synced' ? (waiting ? 'synced · ' + waiting + ' waiting' : 'everything synced')
      : status === 'syncing' || status === 'connecting' ? 'syncing…' : status;
    $('acctStatusText').textContent = text;
    $('acctStatus').firstChild.className = 'tool-dot ' + (status === 'synced' ? 'is-synced'
      : status === 'syncing' || status === 'connecting' ? 'is-waiting' : 'is-trouble');
  }

  $('pwForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var password = $('pwNew').value;
    if (password.length < 6) { say('pwSaid', 'a password needs at least six characters'); return; }
    var button = event.target.querySelector('.go');
    working(button, true);
    Store.remote.setPassword(password).then(function () {
      working(button, false);
      $('pwNew').value = '';
      $('pwRow').open = false;
      if (window.Motion) Motion.toast('password changed');
    }, function (err) { working(button, false); say('pwSaid', trouble(err)); });
  });

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pip-' + Store.dayKey() + '.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
  });

  $('outBtn').addEventListener('click', function () {
    Store.remote.signOut().then(function () {
      $('password').value = '';
      setMode('in', true);
      show('viewForm');
      if (window.Motion) Motion.toast('signed out — this browser keeps its own copy');
    });
  });

  $('deleteBtn').addEventListener('click', function () {
    var button = $('deleteBtn');
    working(button, true);
    Store.remote.deleteAccount().then(function () {
      working(button, false);
      $('deleteRow').open = false;
      setMode('up', true);
      show('viewForm');
      if (window.Motion) Motion.toast('your account is gone');
    }, function (err) { working(button, false); say('deleteSaid', trouble(err)); });
  });

  /* ---------- another project ---------- */

  $('projSave').addEventListener('click', function () {
    var url = $('projUrl').value.trim(), key = $('projKey').value.trim();
    if (!url || !key) { if (window.Motion) Motion.toast('paste the project url and its key'); return; }
    Store.remote.save(url, key).then(function () {
      if (window.Motion) Motion.toast('using that project now');
      $('advanced').open = false;
    });
  });

  /* ---------- which view ---------- */

  function decide() {
    if (stillRecovering()) { show('viewReset'); return; }
    if (Store.remote.signedIn()) { drawAccount(); show('viewAccount'); return; }
    if (current === 'viewAccount' || current === null) show('viewForm');
  }

  Store.init();
  setMode(mode, true);
  var config = window.PIP_CONFIG || {};
  $('googleBtn').hidden = $('googleOr').hidden = !config.google;
  if (!Store.remote.configured()) {
    $('formSaid').textContent = 'accounts are not set up on this copy of pip — it works fine without one';
  }
  decide();
  Store.subscribe(decide);
  // a link to #signin or #signup from somewhere on this same page
  window.addEventListener('hashchange', function () {
    if (Store.remote.signedIn() || stillRecovering()) return;
    if (/signin|signup|sign-up|make/.test(location.hash)) {
      setMode(/signup|sign-up|make/.test(location.hash) ? 'up' : 'in', true);
      show('viewForm');
    }
  });
  connected().then(decide);

  try {
    var settings = (JSON.parse(localStorage.getItem('pip.state.v1') || '{}').settings) || {};
    if (settings.theme && settings.theme !== 'auto') document.documentElement.setAttribute('data-theme', settings.theme);
    if (window.Pet && settings.pet !== false) Pet.init();
  } catch (e) { if (window.Pet) Pet.init(); }
})();
