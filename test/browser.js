/* Playwright, wherever it happens to live. Installed in the project by a
   contributor, or globally on a machine that already had it. */
module.exports = (function () {
  var tried = ['playwright', '/opt/node22/lib/node_modules/playwright',
               '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright'];
  for (var i = 0; i < tried.length; i++) {
    try { return require(tried[i]); } catch (e) { /* next */ }
  }
  console.error('playwright not found — npm install playwright');
  process.exit(2);
})();
