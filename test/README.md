# Sync tests

These drive two real browsers against a stand-in for Supabase: a shared
in-memory database over HTTP that assigns `updated` from its own counter,
exactly as the trigger in `supabase/schema.sql` does. That makes the cases
worth testing — two devices editing at once, a delete that must not come back,
an edit made offline — reproducible without a Supabase project.

    npx http-server -p 8899 -s &     # serve the app
    node test/twodevice.js           # two devices, concurrent edits, offline
    node test/migrate.js             # the old single document becoming rows

Both exit non-zero on a failure or any console error.
