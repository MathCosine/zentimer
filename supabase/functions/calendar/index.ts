// pip's calendar relay.
//
// A calendar's private iCal link (Google, Apple, Outlook) can be fetched by a
// server but not read by a web page: the calendar hosts send no CORS headers.
// This function is the one step in between. It fetches the link it is given
// and hands back the calendar, and nothing else:
//
//   - only for someone signed in to pip (Supabase checks the JWT before this
//     code runs -- leave "Verify JWT" on when deploying),
//   - only from the hosts calendars actually live on, so it cannot be used to
//     fetch anything else on the internet,
//   - and it keeps nothing: no link, no calendar, no log of either.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// Via editor, name it "calendar", paste this file, Deploy.

const HOSTS = [
  /^calendar\.google\.com$/,
  /(^|\.)icloud\.com$/,
  /^outlook\.(live|office365)\.com$/,
  /(^|\.)office365\.com$/,
  /^calendar\.proton\.me$/,
  /(^|\.)fastmail\.com$/,
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "post a link");

  let link = "";
  try {
    link = String((await req.json()).url || "").trim();
  } catch {
    return fail(400, "post a link");
  }
  link = link.replace(/^webcal:/i, "https:");

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return fail(400, "that is not a link");
  }
  if (url.protocol !== "https:" || !HOSTS.some((h) => h.test(url.hostname))) {
    return fail(400, "that is not a calendar link pip knows");
  }

  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "pip-calendar" } });
  } catch {
    return fail(502, "the calendar did not answer");
  }
  if (!res.ok) return fail(502, "the calendar said " + res.status);

  const text = await res.text();
  if (text.length > 5_000_000) return fail(413, "that calendar is too big");
  if (!/BEGIN:VCALENDAR/.test(text)) return fail(422, "that link is not a calendar");

  return new Response(text, {
    headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" },
  });
});
