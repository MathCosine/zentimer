// pip's AI relay. The page never holds an AI key: it sends its question here,
// signed in, and this asks two free models at once -- Groq and Google's
// Gemini -- checks both answers against what pip actually has, and when they
// disagree asks a third time which is better. What comes back has been
// checked; the page checks it again before it shows anything.
//
// Deploy once per Supabase project (docs/AI.md):
//   supabase secrets set GROQ_API_KEY=... GEMINI_API_KEY=...
//   supabase functions deploy ai
// "Verify JWT" stays on: only signed-in people can use it, and each of them
// gets a daily allowance (public.ai_take in schema.sql) so a public app cannot
// spend the free quota on one person's behalf.

const GROQ_KEY = Deno.env.get('GROQ_API_KEY') || '';
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || '';
// Model names change every few months, so they are settings, with a second
// choice for when the first is busy or has been retired.
const GROQ_MODELS = (Deno.env.get('GROQ_MODELS') || 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',');
const GEMINI_MODELS = (Deno.env.get('GEMINI_MODELS') || 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',');
const DAILY = Number(Deno.env.get('AI_DAILY_LIMIT') || '40');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type Json = Record<string, unknown>;

function reply(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

// ---------- what pip asks ----------

const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'tag', 'due', 'mins', 'repeat', 'after'],
        properties: {
          title: { type: 'string' },
          tag: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
          mins: { type: ['integer', 'null'] },
          repeat: { type: ['string', 'null'], enum: ['daily', 'weekdays', 'weekly', null] },
          after: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'mins'],
  properties: { id: { type: 'string' }, mins: { type: 'integer' } },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'later', 'week', 'weekNote', 'links', 'note'],
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'mins', 'why'],
        properties: { id: { type: 'string' }, mins: { type: 'integer' }, why: { type: 'string' } },
      },
    },
    later: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
    week: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'items', 'note'],
        properties: { day: { type: 'string' }, items: { type: 'array', items: ITEM }, note: { type: 'string' } },
      },
    },
    weekNote: { type: 'string' },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['first', 'then', 'why'],
        properties: { first: { type: 'string' }, then: { type: 'string' }, why: { type: 'string' } },
      },
    },
    note: { type: 'string' },
  },
};

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pick', 'why'],
  properties: { pick: { type: 'string', enum: ['A', 'B'] }, why: { type: 'string' } },
};

const PARSE_SYSTEM = `You turn a student's quick note, or a list pasted from a class website, into tasks for a study planner.
Rules:
- One task per real piece of work. Drop headings, greetings, point values and boilerplate.
- "title": short, plain, no date words, no class code at the start.
- "tag": the class or activity as a short code. Reuse one of the student's existing tags when it fits (exact spelling); otherwise make a short uppercase code (2-8 letters, e.g. BIO, APUSH, SAT). null if there is truly none.
- "due": the deadline as YYYY-MM-DD, worked out from today's date. "by thursday" means the coming Thursday. A quiz or test is due on its day. null if none.
- "mins": your honest estimate of the minutes it takes a high schooler (reading a chapter ~40, a problem set ~60-90, studying for a quiz ~45, an essay ~180+). Use the student's own estimate when they give one.
- "repeat": "daily", "weekdays" or "weekly" only for things they say repeat; otherwise null.
- "after": what has to be finished first. Each entry is either the index (as a string, "0", "1", ...) of another task in your list, or the id of one of the student's existing open tasks. Readings before the quiz on them, a draft before the final, notes before the test. Empty when nothing must come first.
Answer with JSON only.`;

const PLAN_SYSTEM = `You plan a student's evening and their week: what to work on, in what order, and for how long.
You get: the time now, minutes free before bed tonight (calendar events already taken out), the next seven days ("days", today first) each with its free minutes, calendar events and minutes of daily practice, the open tasks with ids, deadlines, minutes left, which are daily practice, any "needs first" links, the student's own notes about their life right now, and pip's own rule-based plan for tonight and the week as a starting point.
Rules, in order of importance:
1. Anything due tomorrow (or overdue) is done tonight, unless it truly cannot fit.
2. Never put a task before something it needs first -- not earlier tonight, not on an earlier day. Readings before the quiz on them, research before the essay.
3. Practice matters to this student: keep at least a short practice block (often 30 minutes) each day unless it is late and deadlines are crowding in -- then deadlines win.
4. Spread big work (essays, projects) over several days so it is finished a day or two before it is due and no single night is crushed.
5. Look at the whole week: if one day is too full, move work to lighter days before it, and say so.
6. Use the student's notes: an application deadline, a test coming up, how they like to work.
7. Each day's minutes of work must fit that day's free minutes after practice. Tonight's total must not exceed tonight's free minutes. No task gets more minutes in total than it has left.
8. Mix in a quick task after a long one when it helps, but never at the cost of rule 1.
"steps": tonight's plan in order, using task ids exactly as given. "why": a few friendly words, lower case, like "due tomorrow", "read before friday's quiz", "keeps practice going".
"later": tasks you deliberately left out of tonight, with a short reason.
"week": one entry per day in "days", in order, each with "day" (YYYY-MM-DD), "items" (task ids and minutes for that day; the first day's items are tonight's steps) and "note" (a few words about that day, or "").
"weekNote": one short, kind sentence about the week (which day is heavy and what you moved, or that it all fits), no more than 18 words.
"links": "needs first" relationships you noticed that are not already listed (first = id that must be done before then = id). Only clear ones.
"note": one short, kind sentence about tonight (no more than 14 words).
Answer with JSON only.`;

const JUDGE_SYSTEM = `Two assistants answered the same request from a student's study planner. Decide which answer is better for the student.
Prefer, in order: no rule broken (deadlines tomorrow first, dependencies respected, fits the time, nothing scheduled after it is due); a week that spreads big work sensibly; sensible estimates; keeps practice when there is room; uses the student's notes. Answer with JSON: {"pick": "A" or "B", "why": "a short reason"}.`;

// ---------- the two of them ----------

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try { return await run(control.signal); } finally { clearTimeout(timer); }
}

async function askGroq(system: string, user: string, schema: Json, name: string): Promise<Json> {
  if (!GROQ_KEY) throw new Error('groq: no key');
  let last = '';
  for (const model of GROQ_MODELS) {
    const res = await withTimeout(25000, (signal) => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        temperature: 0.3,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    }));
    if (res.ok) {
      const body = await res.json();
      return JSON.parse(body.choices?.[0]?.message?.content || '{}');
    }
    last = `groq ${model}: ${res.status} ${(await res.text()).slice(0, 160)}`;
    if (res.status !== 429 && res.status !== 404 && res.status < 500) break;   // a second model will not fix a bad request
  }
  throw new Error(last);
}

/* Gemini takes a narrower kind of schema than Groq, so it gets the shape in
   words as well and is checked afterwards like everyone else. */
async function askGemini(system: string, user: string, schema: Json): Promise<Json> {
  if (!GEMINI_KEY) throw new Error('gemini: no key');
  let last = '';
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`;
    const res = await withTimeout(25000, (signal) => fetch(url, {
      method: 'POST',
      signal,
      headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system + '\nThe JSON must match this schema:\n' + JSON.stringify(schema) }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    }));
    if (res.ok) {
      const body = await res.json();
      const text = (body.candidates?.[0]?.content?.parts || []).map((p: Json) => p.text || '').join('');
      return JSON.parse(text || '{}');
    }
    last = `gemini ${model}: ${res.status} ${(await res.text()).slice(0, 160)}`;
    if (res.status !== 429 && res.status !== 404 && res.status < 500) break;
  }
  throw new Error(last);
}

// ---------- is an answer any good ----------

type Task = { id: string; title: string; due?: string | null; left: number; practice?: boolean; needs?: string[] };
type Day = { day: string; free: number; practice?: number };
type PlanInput = { free: number; tasks: Task[]; today: string; tomorrow: string; days?: Day[] };

/* A score, or null for an answer that cannot be used at all. The same rules
   the page holds an answer to, so a plan that would be thrown away there is
   never chosen here. */
function scorePlan(answer: Json, input: PlanInput): number | null {
  const steps = Array.isArray(answer.steps) ? answer.steps as Json[] : null;
  if (!steps) return null;
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  let total = 0, score = 100;
  for (const step of steps) {
    const task = byId.get(String(step.id));
    if (!task || seen.has(task.id)) return null;                 // made up, or twice
    const mins = Number(step.mins);
    if (!(mins > 0)) return null;
    if (mins > task.left + 15) score -= 10;                      // more than is left
    for (const need of task.needs || []) {
      if (byId.has(need) && !seen.has(need)) score -= 40;        // before what it needs
    }
    seen.add(task.id);
    total += mins;
  }
  if (total > input.free + 10) score -= Math.min(60, (total - input.free) / 2);
  // anything due tomorrow or before, left out while there was room for it
  const urgent = input.tasks.filter((t) => t.due && t.due <= input.tomorrow);
  for (const t of urgent) if (!seen.has(t.id) && total < input.free) score -= 25;
  // practice kept, when there was room
  if (input.tasks.some((t) => t.practice) && !steps.some((s) => byId.get(String(s.id))?.practice) &&
      total + 30 <= input.free) score -= 10;
  if (!steps.length && input.tasks.length && input.free >= 20) score -= 50;
  return score + scoreWeek(answer, input, byId);
}

/* The week: nothing after it is due, nothing before what it needs, no task
   given more than it has left, no day far over its free time, and nothing
   due this week left out of it. */
function scoreWeek(answer: Json, input: PlanInput, byId: Map<string, Task>): number {
  const week = Array.isArray(answer.week) ? answer.week as Json[] : null;
  const days = input.days || [];
  if (!week || !days.length) return 0;
  let score = 0;
  const given: Record<string, number> = {}, firstDay: Record<string, string> = {}, lastDay: Record<string, string> = {};
  const room: Record<string, number> = {};
  days.forEach((d) => { room[d.day] = Math.max(0, (Number(d.free) || 0) - (Number(d.practice) || 0)); });
  for (const day of week) {
    const key = String(day.day || '');
    if (!(key in room)) { score -= 5; continue; }
    let sum = 0;
    for (const item of (Array.isArray(day.items) ? day.items as Json[] : [])) {
      const task = byId.get(String(item.id));
      if (!task) { score -= 10; continue; }
      const mins = Number(item.mins) || 0;
      if (task.due && key > task.due) score -= 15;
      given[task.id] = (given[task.id] || 0) + mins;
      if (!firstDay[task.id] || key < firstDay[task.id]) firstDay[task.id] = key;
      if (!lastDay[task.id] || key > lastDay[task.id]) lastDay[task.id] = key;
      sum += mins;
    }
    if (sum > room[key] + 30) score -= 10;
  }
  for (const id of Object.keys(given)) if (given[id] > (byId.get(id)?.left || 0) + 15) score -= 10;
  for (const id of Object.keys(firstDay)) {
    for (const need of byId.get(id)?.needs || []) if (lastDay[need] && lastDay[need] > firstDay[id]) score -= 20;
  }
  const end = days[days.length - 1].day;
  for (const t of input.tasks) if (t.due && t.due <= end && !t.practice && !given[t.id]) score -= 15;
  return score;
}

function scoreParse(answer: Json): number | null {
  const tasks = Array.isArray(answer.tasks) ? answer.tasks as Json[] : null;
  if (!tasks || !tasks.length) return null;
  let score = 100;
  for (const t of tasks) {
    if (typeof t.title !== 'string' || !t.title.trim()) return null;
    if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(t.due))) score -= 15;
    if (t.mins !== null && t.mins !== undefined && !(Number(t.mins) > 0 && Number(t.mins) < 1500)) score -= 10;
  }
  return score;
}

function sameOrder(a: Json, b: Json): boolean {
  const ids = (x: Json) => ((x.steps || x.tasks || []) as Json[]).map((s) => s.id || s.title).join('|');
  return ids(a) === ids(b);
}

// ---------- the request ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  // pip never sends more than a few kilobytes; anything bigger is not pip
  const raw = await req.text();
  if (raw.length > 60000) return reply(413, { error: 'that is more than pip ever sends' });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'not JSON' }); }
  const kind = String(body.kind || '');
  if (kind !== 'parse' && kind !== 'plan') return reply(400, { error: 'kind must be parse or plan' });
  if (!GROQ_KEY && !GEMINI_KEY) return reply(503, { error: 'no AI keys are set on this server' });

  // one more from today's allowance, counted against whoever is signed in
  const auth = req.headers.get('authorization') || '';
  if (SUPABASE_URL && (req.headers.get('apikey') || SUPABASE_ANON_KEY)) {
    const took = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_take`, {
      method: 'POST',
      headers: { authorization: auth, apikey: req.headers.get('apikey') || SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ cap: DAILY }),
    });
    if (took.ok) {
      const left = await took.json();
      if (typeof left === 'number' && left < 0) return reply(429, { error: 'that is all the AI for today -- it comes back tomorrow' });
    }
    // a missing allowance table is a setup problem, not a reason to refuse
  }

  const input = (body.input || {}) as Json;
  const system = kind === 'parse' ? PARSE_SYSTEM : PLAN_SYSTEM;
  const schema = kind === 'parse' ? PARSE_SCHEMA : PLAN_SCHEMA;
  const user = JSON.stringify(input);
  const score = (a: Json) => kind === 'parse' ? scoreParse(a) : scorePlan(a, input as unknown as PlanInput);

  const asked = await Promise.allSettled([
    askGroq(system, user, schema, kind),
    askGemini(system, user, schema),
  ]);
  const names = ['groq', 'gemini'];
  const heard: { who: string; answer: Json; score: number }[] = [];
  const trouble: Record<string, string> = {};
  asked.forEach((got, i) => {
    if (got.status === 'rejected') { trouble[names[i]] = String(got.reason?.message || got.reason).slice(0, 200); return; }
    const s = score(got.value);
    if (s === null) { trouble[names[i]] = 'answer did not check out'; return; }
    heard.push({ who: names[i], answer: got.value, score: s });
  });

  if (!heard.length) return reply(502, { error: 'neither AI gave a usable answer', trouble });
  heard.sort((a, b) => b.score - a.score);
  let chosen = heard[0], judged = false, verdict = '';

  /* Both usable, and they really differ, and neither is clearly worse: the
     judge reads both, labelled A and B in a random order so neither gets the
     benefit of going first. */
  if (heard.length === 2 && !sameOrder(heard[0].answer, heard[1].answer) && heard[0].score - heard[1].score < 25) {
    const flip = Math.random() < 0.5;
    const [a, b] = flip ? [heard[1], heard[0]] : [heard[0], heard[1]];
    const ask = JSON.stringify({ request: input, A: a.answer, B: b.answer });
    try {
      const ruling = GROQ_KEY ? await askGroq(JUDGE_SYSTEM, ask, JUDGE_SCHEMA, 'judge') : await askGemini(JUDGE_SYSTEM, ask, JUDGE_SCHEMA);
      chosen = ruling.pick === 'B' ? b : a;
      judged = true;
      verdict = String(ruling.why || '').slice(0, 160);
    } catch (e) {
      trouble.judge = String((e as Error).message || e).slice(0, 200);
    }
  }

  return reply(200, {
    result: chosen.answer,
    meta: { used: chosen.who, judged, verdict, heard: heard.map((h) => h.who), trouble },
  });
});
