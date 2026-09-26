# Tests

Browser tests driven by Playwright. The sync ones stand up a fake Supabase --
a shared in-memory database over HTTP that assigns `updated` from its own
counter, exactly as the trigger in `supabase/schema.sql` does -- so two real
browsers can be pointed at it and the cases worth testing become reproducible
without a Supabase project.

    npm install playwright          # or have it installed globally
    npx http-server -p 8899 -s &    # serve the site

    node test/twodevice.js    two devices: concurrent edits, deletes, offline queue
    node test/migrate.js      the old single document becoming rows
    node test/accounts.js     sign in, sign up, sign out, delete account
    node test/landing.js      the front page, and the app at its new address
    node test/offline.js      the service worker, with the network switched off
    node test/undo.js         undo, and the bin
    node test/findweek.js     searching, and the week
    node test/sorting.js      the five orders, both directions, inside a split
    node test/narrow.js       nothing spills, 260px up, alone and in the frame
    node test/deadlines.js    typed days including typos, and the due picker
    node test/queue.js        what to do now, and the hours being optional
    node test/tagsview.js     every tag on screen at once, at five sizes
    node test/progress.js     how far in a task is, and what that changes
    node test/practice.js     practice tags, and the queue not repeating itself
    node test/sweep.js        every control, once, looking for console errors

Each exits non-zero on a failed check or any console error.
