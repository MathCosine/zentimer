# The AI in pip

pip uses AI for three things:

- **Tonight's plan.** It decides what to do, in what order and for how long,
  around your calendar and bedtime. It also notices what has to come first,
  like a reading before the quiz on it.
- **The week.** It gives each of the next seven days its share of the
  homework within the time that day has, spreads big work over several
  days, and says when a day is too full and what it moved. Press **week**
  in the day row under up next.
- **Adding tasks.** Type a messy note, or paste a list from a class page, and
  press ✦. It picks out each task with its class, deadline, rough length and
  what comes first, and shows them as cards for you to fix or drop before
  anything is added.

Whichever AI answers, two different models are asked at once. Their answers
are checked against what pip actually has: real tasks, nothing before what
it needs, nothing after it's due, minutes that fit. When both answers are
usable and they disagree, a third request picks the better one. Whenever
the AI can't answer (not connected, offline, out of allowance, a bad
answer), pip's own rule-based planner takes over.

## The default: Puter (nothing to set up)

[Puter](https://puter.com) lets a web page use AI models without an API
key. Each person signs in to their own free Puter account, which comes with
a free monthly AI allowance, and pays nothing. Neither do you.

- In pip: settings → **AI** → **connect Puter**, the "connect" button next to
  the ✦ line in tonight's box, or the welcome page. A small Puter window opens
  to make or sign in to a free account.
- It doesn't need a pip account; it works for someone using pip only in
  their browser, too.
- Models are set in [`assets/ai.js`](../assets/ai.js) (`PUTER_A`, `PUTER_B`,
  `PUTER_JUDGE`). Each is a list: if a model is retired, the next one is
  tried.
- Puter's script is only fetched once someone reaches for the AI (✦,
  connect, or the AI settings). After that it loads with the desk.
- If someone's free allowance runs out for the month, pip says so and plans
  with its own rules until it comes back.

## Or: your own server (Groq + Gemini)

Settings → AI → **runs on: my server**. The keys live as secrets in a
Supabase Edge Function on your project. Set it up once:

The AI keys never go in the website. They live as secrets in the Edge
Function [`supabase/functions/ai/index.ts`](../supabase/functions/ai/index.ts),
the same way the calendar relay works. It uses the same instructions and
checks as [`assets/ai-brain.js`](../assets/ai-brain.js); keep the two in step.

1. **A Groq key.** Sign in at [console.groq.com](https://console.groq.com) →
   **API Keys** → **Create API Key**. No card needed.
2. **A Gemini key.** Sign in at [aistudio.google.com](https://aistudio.google.com)
   → **Get API key** → **Create API key**. No card needed.
   (You can set up just one of the two; pip then uses that one alone.)
3. **Secrets.** Supabase dashboard → **Edge Functions** → **Secrets** → add:
   - `GROQ_API_KEY` = your Groq key
   - `GEMINI_API_KEY` = your Gemini key
4. **The function.** Supabase dashboard → **Edge Functions** → **Deploy a new
   function** → **Via editor** → name it **`ai`** (exactly that) → replace
   the example with the contents of `index.ts` → **Deploy**. Leave **Verify
   JWT** on, so only people signed in to pip can use it.
5. **The database.** SQL Editor → paste all of
   [`supabase/schema.sql`](../supabase/schema.sql) → **Run**. This adds the
   "do this first" links between tasks and each person's daily AI allowance.
   It is safe to run again.

### Optional settings (more secrets)

| Secret | Default | What it does |
|---|---|---|
| `AI_DAILY_LIMIT` | `40` | AI requests per person per day. Planning is one request; the comparison inside it doesn't count extra. |
| `GROQ_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b` | Groq models to try, in order. |
| `GEMINI_MODELS` | `gemini-3.6-flash,gemini-3.5-flash-lite` | Gemini models to try, in order. |

Model names change every few months. If one is retired, the next one in its
list is tried, and you can change the lists without touching the code.

## When it plans

Each plan spends some of the free AI allowance, so it plans **on its own once
a day**, and otherwise only when asked.

- **The morning plan:** the first time pip is open from **5am**, once nothing
  has changed for **90 seconds** (so another device's tasks, or a morning's
  worth of adding, go into one request). If that one fails, it doesn't try
  again by itself that day.
- The plan then holds all day. Anything added after it is fitted in by pip's
  own rules, and a due-tomorrow task the plan doesn't mention still goes
  first.
- When something that matters has changed since (a new task, a deadline or
  size, a link, a calendar event, bedtime, your note), the **↻** next to the
  plan's note turns into **update ↻**. It never re-plans by itself.
- **↻** asks right away.
- **tell it** next to the plan's note is for something true only for now --
  "soccer till 7", "sick this week, go easy". Pick **just today** or **this
  week** (the next seven days), and it plans again a few seconds later with
  that taken in. Each one shows as a chip under the note until it runs out;
  × forgets it sooner.

## What it is sent

Only once someone has connected it and has it switched on (settings → AI):

- the names, deadlines and sizes of their open tasks
- this week's calendar events, and how much free time each day has
- their bedtime
- whatever they wrote under "about you, right now", and anything they told it
  for today or this week

It is never sent their email or password. With Puter, this goes to Puter,
which passes it to the models (Google's Gemini and OpenAI's GPT). With your
own server, it goes to Groq and Google's Gemini. Google may use what is sent
to Gemini's free tier to improve its products. [privacy.html](../privacy.html)
says all of this to everyone using pip.

The services' terms generally require account holders (or whoever creates
API keys) to be 18 or older, or to have a parent's permission.
