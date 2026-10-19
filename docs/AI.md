# The AI in pip

pip can use AI for two things:

- **Tonight's plan.** It decides what to do, in what order and for how long,
  around your calendar and bedtime. It also notices what has to come first,
  like a reading before the quiz on it.
- **Adding tasks.** Type a messy note, or paste a list from a class page, and
  press ✦. It picks out each task with its class, deadline, rough length and
  what comes first, and shows them as cards for you to fix or drop before
  anything is added.

It uses two free AI services at once, **Groq** and **Google's Gemini**. Their
answers are checked against what pip actually has. When both answers are
usable and they disagree, a third request asks which one is better. pip
checks the result again before showing it. Whenever the AI can't answer (not
set up, offline, out of quota, a bad answer), pip's own rule-based planner
takes over.

## Setting it up (once per Supabase project, about 10 minutes, free)

The AI keys never go in the website. They live as secrets in a Supabase Edge
Function, [`supabase/functions/ai/index.ts`](../supabase/functions/ai/index.ts),
the same way the calendar relay works.

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

It doesn't ask the AI on every change.

- It waits until nothing has changed for **90 seconds**, so pasting in a
  week's homework is one request, not twenty.
- On its own it asks **at most every 30 minutes**. The exception is the first
  plan of the day.
- It only asks when something that **matters to tonight** changed: a new
  task, a deadline or size changing, a "do this first" link, a calendar
  event, your bedtime, or your note about yourself. Ticking something off
  never triggers a request, because the rest of the plan still holds.
- It also asks if the evening has slid so far that what's left of the plan
  no longer fits before bed.
- **↻** next to the plan's note asks right away.

## What it is sent

Only when someone is signed in and has it switched on (settings → AI):

- the names, deadlines and sizes of their open tasks
- tonight's calendar events
- their bedtime
- whatever they wrote under "about you, right now"

It is never sent their email or password. Google may use what is sent to
Gemini's free tier to improve its products; [privacy.html](../privacy.html)
says so to everyone using pip.

Both services' terms generally require whoever creates the API keys to be 18
or older.
