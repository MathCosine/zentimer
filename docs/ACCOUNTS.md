# Accounts

pip works without an account; everything stays in the browser. An account
makes it follow you to every device, and is what the AI and the calendar
work through.

The pages:

| Page | What it is |
|---|---|
| `account/` | Sign in, make an account, a forgotten password (and the new one chosen from the email), and once you're in: your account, change password, download everything, sign out, delete. |
| `welcome/` | After making an account: your classes, what you practise, bedtime, calendar and a note for the AI. Every step can be skipped, and all of it can be changed later in settings. |

## Once per Supabase project: where links may come back to

Password-reset emails and Google sign-in send people back to pip, and
Supabase only allows the addresses it has been told about.

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** where pip lives, e.g. `https://mathcosine.github.io/zentimer/`
- **Redirect URLs:** add
  - `https://mathcosine.github.io/zentimer/account/`
  - `https://mathcosine.github.io/zentimer/welcome/`
  - `https://mathcosine.github.io/zentimer/app/`

(Swap in your own address if pip lives somewhere else.)

## Optional: "continue with Google"

Free, about ten minutes. The button stays hidden until you switch it on.

1. [Google Cloud console](https://console.cloud.google.com/) → make a project
   (any name).
2. **APIs & Services → OAuth consent screen** → External → app name "pip",
   your email for support and developer contact → save. Add the scopes
   `email`, `profile` and `openid`. Publish the app when you want anyone to
   be able to use it; until then only test users you add can.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Web application. Under **Authorised redirect URIs** add your Supabase
   callback: `https://<your-project>.supabase.co/auth/v1/callback`. Create,
   then copy the client ID and the client secret.
4. Supabase dashboard → **Authentication → Sign In / Providers → Google** →
   switch it on, paste the client ID and secret → **Save**.
5. In [`assets/config.js`](../assets/config.js), add `google: true` next to
   `supabase`, then push:

   ```js
   window.PIP_CONFIG = {
     supabase: { url: '…', key: '…' },
     google: true
   };
   ```

Someone signing in with Google for the first time goes through the welcome.
After that they go straight to their desk.

## Email confirmation

It's off at the moment, so a new account can be used straight away.
Supabase's built-in email sender only allows a handful of emails an hour,
which isn't enough for a public app. If you switch confirmation on
(Authentication → Sign In / Providers → Email → **Confirm email**), set up
your own SMTP first (Authentication → Emails → SMTP settings; a free tier at
a provider like Resend is enough). The account page already handles it: it
says "check your email" and the link brings people back to `account/`.

Password resets use the same email sender, so the same limit applies to them.
