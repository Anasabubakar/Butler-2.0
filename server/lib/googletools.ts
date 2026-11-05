// Your own Google account as tools a recipe can use: the calendar, Google Tasks and Gmail,
// read the same way the morning brief reads them. Without these a recipe that says "check my
// calendar" had no way to look, and guessed. They only read, so they run without asking.
import type { Connection, Offer, Tool } from "./mcp.ts";
import * as google from "./google.ts";
import { endOfDay, failed, fromGoogle, onDay, startOfDay, tasksNote, today } from "./brief.ts";
import { localIso } from "./command.ts";

const tool = (name: string, description: string, properties: Record<string, unknown>): Tool => ({
  name, description, schema: { type: "object", properties }, readOnly: true,
});

const TOOLS: Tool[] = [
  tool(
    "calendar",
    "The owner's own Google Calendar (every calendar they show): events on a day, with times, places and call links. Use this for anything about their calendar, schedule or meetings.",
    {
      day: { type: "string", description: "YYYY-MM-DD; leave out for today" },
      days: { type: "number", description: "how many days from that day, 1 to 14; default 1" },
    },
  ),
  tool(
    "tasks",
    "The owner's own Google Tasks: overdue, due this week and the rest. Use this for anything about their tasks or to-dos.",
    {},
  ),
  tool(
    "email",
    "The owner's own Gmail: the newest emails matching a Gmail search, or the unread ones that need them.",
    { query: { type: "string", description: "a Gmail search like from:bank newer_than:7d; leave out for unread email that needs them" } },
  ),
];

/** The built-in connection the tools hang off. Its id can't clash with a stored connection's. */
export const GOOGLE: Connection = { id: "builtin:google", name: "Google", host: "google.com", tools: TOOLS, rules: {}, checked_at: null, error: null };

export const isGoogleTool = (o: Offer) => o.connection.id === GOOGLE.id;

/** The tools, for when Google is connected. */
export const googleOffers = (): Offer[] =>
  TOOLS.map((t) => ({ key: `${GOOGLE.name}/${t.name}`, connection: GOOGLE, tool: t, rule: "auto" }));

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** An all-day event is on its first day and, if it runs longer, every day up to its end. */
const allDayOn = (e: google.Event, day: string) => {
  const start = e.start.toISOString().slice(0, 10);
  return e.until ? start <= day && onDay(e, day) : start === day;
};

const when = (e: google.Event, timeZone: string) =>
  e.allDay ? "all day" : new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(e.start);

/** The events from `day` for `days` days, a line each, or why Google couldn't say. */
export async function calendarNote(args: Record<string, unknown>, now: Date, timeZone: string): Promise<string> {
  const first = typeof args.day === "string" && DAY_RE.test(args.day) ? args.day : today(now, timeZone);
  const days = Math.min(14, Math.max(1, Math.round(Number(args.days) || 1)));
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(new Date(`${first}T12:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const from = startOfDay(first, timeZone);
  const to = endOfDay(new Date(`${dayList.at(-1)}T12:00:00Z`), timeZone);
  const found = await fromGoogle("calendar", () => google.events(from, to));
  if (failed(found)) return `couldn't read the calendar: ${found.error}`;
  const lines: string[] = [];
  for (const day of dayList) {
    const on = (found ?? []).filter((e) => e.allDay ? allDayOn(e, day) : localIso(e.start, timeZone).slice(0, 10) === day);
    lines.push(`${day}${day === today(now, timeZone) ? " (today)" : ""}:`);
    if (!on.length) lines.push("  nothing on the calendar");
    for (const e of on) {
      lines.push(`  • ${when(e, timeZone)} ${e.title}${e.place ? ` · ${e.place}` : ""}${e.link ? ` · ${e.link}` : ""}`);
    }
  }
  return lines.join("\n");
}

const notConnected = "Google isn't connected; connect it under Integrations on the Butler website.";

/** Runs one of the tools and returns what it found, in words. */
export async function useGoogle(offer: Offer, args: Record<string, unknown>, now: Date, timeZone: string): Promise<string> {
  if (!google.googleConfigured() || !await google.account()) return notConnected;
  if (offer.tool.name === "calendar") return await calendarNote(args, now, timeZone);
  if (offer.tool.name === "tasks") return await tasksNote(now, timeZone);
  if (offer.tool.name === "email") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
    const found = await fromGoogle("email", () => google.mail(query || google.IMPORTANT, 8));
    if (failed(found)) return `couldn't check the email: ${found.error}`;
    if (!found?.length) return query ? `no email matches "${query}".` : "no unread email waiting from the last two days.";
    return found.map((m) => `• ${m.from}: ${m.subject} (${localIso(m.at, timeZone).slice(0, 16).replace("T", " ")})${m.snippet ? ` · ${m.snippet.slice(0, 120)}` : ""}`).join("\n");
  }
  throw new Error(`there's no Google tool called ${offer.tool.name}`);
}
