/* What the AI is asked, the shape its answers must take, and how an answer is
   judged before pip will use it. The same rules run here, for AI reached from
   the page (Puter), and in supabase/functions/ai, for AI reached through your
   own server -- keep the two in step. */
window.AiBrain = (function () {
  'use strict';

  /* ---------- writing tasks down ---------- */

  var PARSE_SYSTEM = [
    'You turn a student’s quick note, or a list pasted from a class website, into tasks for a study planner.',
    'Rules:',
    '- One task per real piece of work. Drop headings, greetings, point values and boilerplate.',
    '- "title": short, plain, no date words, no class code at the start.',
    '- "tag": the class or activity as a short code. Reuse one of the student’s existing tags when it fits (exact spelling); otherwise make a short uppercase code (2-8 letters, e.g. BIO, APUSH, SAT). null if there is truly none.',
    '- "due": the deadline as YYYY-MM-DD, worked out from today’s date. "by thursday" means the coming Thursday. A quiz or test is due on its day. null if none.',
    '- "mins": your honest estimate of the minutes it takes a high schooler (reading a chapter ~40, a problem set ~60-90, studying for a quiz ~45, an essay ~180+). Use the student’s own estimate when they give one.',
    '- "repeat": "daily", "weekdays" or "weekly" only for things they say repeat; otherwise null.',
    '- "after": what has to be finished first. Each entry is either the index (as a string, "0", "1", ...) of another task in your list, or the id of one of the student’s existing open tasks. Readings before the quiz on them, a draft before the final, notes before the test. Empty when nothing must come first.',
    'Answer with JSON only.'
  ].join('\n');

  var PARSE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'tag', 'due', 'mins', 'repeat', 'after'],
          properties: {
            title: { type: 'string' },
            tag: { type: ['string', 'null'] },
            due: { type: ['string', 'null'] },
            mins: { type: ['integer', 'null'] },
            repeat: { type: ['string', 'null'], enum: ['daily', 'weekdays', 'weekly', null] },
            after: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  };

  /* ---------- planning tonight, and the week ---------- */

  var PLAN_SYSTEM = [
    'You plan a student’s evening and their week: what to work on, in what order, and for how long.',
    'You get: the time now, minutes free before bed tonight (calendar events already taken out), the next seven days ("days", today first) each with its free minutes, calendar events and minutes of daily practice, the open tasks with ids, deadlines, minutes left, which are daily practice, any "needs first" links, the student’s own notes about their life right now, notes that hold only for now ("forNow": each for today only, or until a date), and pip’s own rule-based plan for tonight and the week as a starting point.',
    'Rules, in order of importance:',
    '1. Anything due tomorrow (or overdue) is done tonight, unless it truly cannot fit.',
    '2. Never put a task before something it needs first -- not earlier tonight, not on an earlier day. Readings before the quiz on them, research before the essay.',
    '3. Practice matters to this student: keep at least a short practice block (often 30 minutes) each day unless it is late and deadlines are crowding in -- then deadlines win.',
    '4. Spread big work (essays, projects) over several days so it is finished a day or two before it is due and no single night is crushed.',
    '5. Look at the whole week: if one day is too full, move work to lighter days before it, and say so.',
    '6. Use the student’s notes: an application deadline, a test coming up, how they like to work. A "forNow" note holds only on the days it says, and on those days it outranks habits and pip’s plan: "soccer till 7 tonight" takes that time out of tonight, "sick this week, go easy" means lighter days, "finish the essay first today" puts it first. Never at the cost of rules 1 and 2. Mention a note you followed in "note" or "weekNote".',
    '7. Each day’s minutes of work must fit that day’s free minutes after practice. Tonight’s total must not exceed tonight’s free minutes. No task gets more minutes in total than it has left.',
    '8. Mix in a quick task after a long one when it helps, but never at the cost of rule 1.',
    '"steps": tonight’s plan in order, using task ids exactly as given. "why": a few friendly words, lower case, like "due tomorrow", "read before friday’s quiz", "keeps practice going".',
    '"later": tasks you deliberately left out of tonight, with a short reason.',
    '"week": one entry per day in "days", in order, each with "day" (YYYY-MM-DD), "items" (task ids and minutes for that day; the first day’s items are tonight’s steps) and "note" (a few words about that day, or "").',
    '"weekNote": one short, kind sentence about the week (which day is heavy and what you moved, or that it all fits), no more than 18 words.',
    '"links": "needs first" relationships you noticed that are not already listed (first = id that must be done before then = id). Only clear ones.',
    '"note": one short, kind sentence about tonight (no more than 14 words).',
    'Answer with JSON only.'
  ].join('\n');

  var ITEM = {
    type: 'object', additionalProperties: false, required: ['id', 'mins'],
    properties: { id: { type: 'string' }, mins: { type: 'integer' } }
  };

  var PLAN_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['steps', 'later', 'week', 'weekNote', 'links', 'note'],
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'mins', 'why'],
          properties: { id: { type: 'string' }, mins: { type: 'integer' }, why: { type: 'string' } }
        }
      },
      later: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'why'],
          properties: { id: { type: 'string' }, why: { type: 'string' } }
        }
      },
      week: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['day', 'items', 'note'],
          properties: { day: { type: 'string' }, items: { type: 'array', items: ITEM }, note: { type: 'string' } }
        }
      },
      weekNote: { type: 'string' },
      links: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['first', 'then', 'why'],
          properties: { first: { type: 'string' }, then: { type: 'string' }, why: { type: 'string' } }
        }
      },
      note: { type: 'string' }
    }
  };

  var JUDGE_SYSTEM = 'Two assistants answered the same request from a student’s study planner. Decide which answer is better for the student.\n' +
    'Prefer, in order: no rule broken (deadlines tomorrow first, dependencies respected, fits the time, nothing scheduled after it is due); a week that spreads big work sensibly; sensible estimates; keeps practice when there is room; uses the student’s notes. Answer with JSON: {"pick": "A" or "B", "why": "a short reason"}.';

  var JUDGE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['pick', 'why'],
    properties: { pick: { type: 'string', enum: ['A', 'B'] }, why: { type: 'string' } }
  };

  /* ---------- is an answer any good ---------- */

  /* A score, or null for an answer that cannot be used at all: the same
     rules the planner holds an answer to, so a plan that would be thrown
     away there is never the one chosen. */
  function scorePlan(answer, input) {
    var steps = answer && Array.isArray(answer.steps) ? answer.steps : null;
    if (!steps) return null;
    var tasks = (input && input.tasks) || [];
    var byId = {};
    tasks.forEach(function (t) { byId[t.id] = t; });
    var seen = {}, total = 0, score = 100;
    for (var i = 0; i < steps.length; i++) {
      var task = byId[String(steps[i].id)];
      if (!task || seen[task.id]) return null;                  // made up, or twice
      var mins = Number(steps[i].mins);
      if (!(mins > 0)) return null;
      if (mins > task.left + 15) score -= 10;                    // more than is left
      (task.needs || []).forEach(function (need) {
        if (byId[need] && !seen[need]) score -= 40;              // before what it needs
      });
      seen[task.id] = true;
      total += mins;
    }
    var free = Number(input && input.free) || 0;
    if (total > free + 10) score -= Math.min(60, (total - free) / 2);
    tasks.forEach(function (t) {
      // due tomorrow or before, left out while there was room for it
      if (t.due && input.tomorrow && t.due <= input.tomorrow && !seen[t.id] && total < free) score -= 25;
    });
    if (tasks.some(function (t) { return t.practice; }) &&
        !steps.some(function (s) { return byId[String(s.id)] && byId[String(s.id)].practice; }) &&
        total + 30 <= free) score -= 10;
    if (!steps.length && tasks.length && free >= 20) score -= 50;
    return score + scoreWeek(answer, input, byId);
  }

  /* The week: nothing after it is due, nothing before what it needs, no task
     given more than it has left, no day far over its free time, and nothing
     due this week left out of it altogether. */
  function scoreWeek(answer, input, byId) {
    var week = Array.isArray(answer.week) ? answer.week : null;
    var days = (input && input.days) || [];
    if (!week || !days.length) return 0;
    var score = 0, given = {}, firstDay = {}, lastDay = {};
    var freeOn = {};
    days.forEach(function (d) { freeOn[d.day] = Math.max(0, (Number(d.free) || 0) - (Number(d.practice) || 0)); });
    week.forEach(function (day) {
      if (!day || !(day.day in freeOn)) { score -= 5; return; }
      var sum = 0;
      (Array.isArray(day.items) ? day.items : []).forEach(function (item) {
        var task = byId[String(item.id)];
        if (!task) { score -= 10; return; }
        var mins = Number(item.mins) || 0;
        if (task.due && day.day > task.due) score -= 15;          // after it is due
        given[task.id] = (given[task.id] || 0) + mins;
        if (!firstDay[task.id] || day.day < firstDay[task.id]) firstDay[task.id] = day.day;
        if (!lastDay[task.id] || day.day > lastDay[task.id]) lastDay[task.id] = day.day;
        sum += mins;
      });
      if (sum > freeOn[day.day] + 30) score -= 10;
    });
    Object.keys(given).forEach(function (id) { if (given[id] > byId[id].left + 15) score -= 10; });
    Object.keys(firstDay).forEach(function (id) {
      (byId[id].needs || []).forEach(function (need) {
        if (lastDay[need] && lastDay[need] > firstDay[id]) score -= 20;
      });
    });
    var end = days[days.length - 1].day;
    Object.keys(byId).forEach(function (id) {
      var t = byId[id];
      if (t.due && t.due <= end && !t.practice && !given[id]) score -= 15;
    });
    return score;
  }

  function scoreParse(answer) {
    var tasks = answer && Array.isArray(answer.tasks) ? answer.tasks : null;
    if (!tasks || !tasks.length) return null;
    var score = 100;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!t || typeof t.title !== 'string' || !t.title.trim()) return null;
      if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(t.due))) score -= 15;
      if (t.mins !== null && t.mins !== undefined && !(Number(t.mins) > 0 && Number(t.mins) < 1500)) score -= 10;
    }
    return score;
  }

  function sameOrder(a, b) {
    var ids = function (x) {
      return ((x && (x.steps || x.tasks)) || []).map(function (s) { return s.id || s.title; }).join('|');
    };
    return ids(a) === ids(b);
  }

  /* JSON out of whatever came back: a fenced block, text around it, or the
     thing itself. */
  function readJson(text) {
    if (text && typeof text === 'object') return text;
    var s = String(text || '').trim();
    var fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) s = fenced[1].trim();
    try { return JSON.parse(s); } catch (e) { /* look for the outermost braces */ }
    var from = s.indexOf('{'), to = s.lastIndexOf('}');
    if (from !== -1 && to > from) return JSON.parse(s.slice(from, to + 1));
    throw new Error('the AI did not answer in the expected shape');
  }

  return {
    parse: { system: PARSE_SYSTEM, schema: PARSE_SCHEMA, score: function (a) { return scoreParse(a); } },
    plan: { system: PLAN_SYSTEM, schema: PLAN_SCHEMA, score: scorePlan },
    judge: { system: JUDGE_SYSTEM, schema: JUDGE_SCHEMA },
    sameOrder: sameOrder,
    readJson: readJson
  };
})();
