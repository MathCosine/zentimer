/* Sync settings, kept in the repo so a cleared browser never needs them pasted again.
 *
 * Leave these blank and pip keeps everything in this browser only — that is a
 * perfectly good way to run it.
 *
 * To switch sync on: make a Supabase project, run supabase/schema.sql in its SQL
 * editor, then paste the two values below and push. Both are safe in a public
 * repo: the anon key is meant for client code, and the row-level security policy
 * in the schema is what actually keeps the data yours. Never put the
 * service_role key here.
 *
 * You still sign in once per browser (the cloud button, top right). Clearing site
 * data signs you out but never loses these settings.
 */
window.PIP_CONFIG = {
  supabase: {
    url: '',   // e.g. 'https://abcdefghijkl.supabase.co'
    key: ''    // the long anon public key, starts with eyJ
  }
};
