// The morning brief: today's calendar, Google Tasks and new email, reminders still to come,
// what you saved yesterday, and one older save worth another look. Written without AI, so it's
// free and always works. When Google fails it says so: an empty day is never a guess.
import { sql } from "./db.ts";
import * as google from "./google.ts";
import { localIso } from "./command.ts";
import { savedDays, streak } from "./streaks.ts";
import { addressed } from "./persona.ts";

/** What Google said went wrong, in words for the owner. */
export interface Failed {
  error: string;
}

/** A list from Google: what it found, why it couldn't, or null when Google isn't connected. */
export type Found<T> = T[] | Failed | null;

export const failed = <T>(f: Found<T> | undefined): f is Failed => f != null && !Array.isArray(f);

export interface Parts {
  events: Found<google.Event>;
  tasks?: Found<google.Task>;
  mail?: Found<google.Mail>; // only for today
  reminders: { body: string; due: Date }[];
  savedLastDay: number;
  resurface: { title: string; link: string | null; savedOn: Date } | null;
  streak?: number; // days in a row with a save
  /** The day it's about, like 2026-10-22, when that isn't today. */
  day?: string;
}

/** The last moment of today in `timeZone`. */
export function endOfDay(now: Date, timeZone: string): Date {
  const iso = localIso(now, timeZone);
  return new Date(`${iso.slice(0, 10)}T23:59:59${iso.slice(19)}`);
}

/** Today's date in `timeZone`, like 2026-10-20. */
export const today = (now: Date, timeZone: string) => localIso(now, timeZone).slice(0, 10);

/** The first moment of `day` (like 2026-10-22) in `timeZone`. */
export function startOfDay(day: string, timeZone: string): Date {
  const noon = new Date(`${day}T12:00:00Z`); // the offset at midday is the day's, give or take a clock change
  const offset = localIso(noon, timeZone).slice(19);
  return new Date(`${day}T00:00:00${offset}`);
}

/** Whether an event is on `day`. All-day events from Google run up to, not including, their end day. */
export function onDay(e: google.Event, day: string): boolean {
  if (!e.allDay || !e.until) return true;
  const first = e.start.toISOString().slice(0, 10);
  return first <= day && day < e.until;
}

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));

const clock = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);

/** The brief as a short plain note. */
export function compose(p: Parts, now: Date, timeZone: string): string {
  const isToday = !p.day || p.day === today(now, timeZone);
  const date = isToday ? now : new Date(`${p.day}T12:00:00Z`);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: isToday ? timeZone : "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(date);
  const hour = Number(localIso(now, timeZone).slice(11, 13));
  const hello = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const lines = [`${addressed(hello)}. here's ${isToday ? "your " : ""}${day}:`];
  const when = isToday ? "today" : "that day";
  if (p.events === null) lines.push("", "connect Google under Integrations on the website and your calendar shows up here.");
  else if (failed(p.events)) lines.push("", `couldn't read your calendar, so i can't tell you what's on: ${p.events.error}`);
  else if (!p.events.length) {
    lines.push("", isToday && hour >= 12 ? "nothing else on your calendar today." : `nothing on your calendar ${when}.`);
  } else {
    lines.push("", isToday ? "Today:" : "On your calendar:",
      ...p.events.map((e) => `• ${e.allDay ? "All day" : clock(e.start, timeZone)} ${e.title}`));
  }
  if (failed(p.tasks)) lines.push("", `couldn't read your Google Tasks: ${p.tasks.error}`);
  else if (p.tasks) {
    const target = p.day ?? today(now, timeZone);
    const due = p.tasks.filter((t) => t.due === target);
    const late = isToday ? p.tasks.filter((t) => t.due && t.due < target).sort((a, b) => a.due!.localeCompare(b.due!)) : [];
    const undated = p.tasks.filter((t) => !t.due).length;
    if (due.length) lines.push("", `Tasks due ${when}:`, ...due.slice(0, 10).map((t) => `• ${t.title}`));
    if (late.length) lines.push("", "Overdue:", ...late.slice(0, 10).map((t) => `• ${t.title} (due ${shortDay(t.due!)})`));
    if (!due.length && !late.length) {
      lines.push("", `no tasks due ${when}${undated ? ` (${undated} open with no date)` : ""}.`);
    }
  }
  if (failed(p.mail)) lines.push("", `couldn't check your email: ${p.mail.error}`);
  else if (p.mail && isToday) {
    if (p.mail.length) {
      lines.push("", `Unread email (${p.mail.length}${p.mail.length >= 5 ? "+" : ""}):`,
        ...p.mail.slice(0, 5).map((m) => `• ${m.from}: ${m.subject}`));
    } else lines.push("", "no unread email waiting on you.");
  }
  if (p.reminders.length) {
    lines.push("", "Reminders:", ...p.reminders.map((r) => `• ${clock(r.due, timeZone)} ${r.body}`));
  }
  if (!isToday) return lines.join("\n");
  if (p.savedLastDay) lines.push("", `you saved ${p.savedLastDay} thing${p.savedLastDay === 1 ? "" : "s"} in the last day.`);
  if (p.streak && p.streak >= 2) lines.push(`${p.streak}-day saving streak. save something today to keep it going.`);
  if (p.resurface) {
    const saved = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(p.resurface.savedOn);
    lines.push("", `from your library (saved ${saved}): ${p.resurface.title}`);
    if (p.resurface.link) lines.push(p.resurface.link);
  }
  return lines.join("\n");
}

/** Asks Google for one part of the brief; a failure becomes words for the owner, never an empty list. */
async function fromGoogle<T>(what: string, ask: () => Promise<T[]>): Promise<Found<T>> {
  try {
    return await ask();
  } catch (e) {
    console.warn(`brief: ${what}`, String(e).slice(0, 300));
    const message = e instanceof google.GoogleError ? e.message : `Google didn't answer (${String((e as Error).message ?? e).slice(0, 120)}). try again in a minute.`;
    return { error: message };
  }
}

/** Collects what goes in the brief for today, or for `day` (like 2026-10-22). */
export async function gather(now: Date, timeZone: string, publicUrl?: string, day?: string): Promise<Parts> {
  const isToday = !day || day <= today(now, timeZone);
  const target = isToday ? today(now, timeZone) : day!;
  const from = isToday ? now : startOfDay(target, timeZone);
  const end = isToday ? endOfDay(now, timeZone) : endOfDay(new Date(`${target}T12:00:00Z`), timeZone);
  let events: Found<google.Event> = null, tasks: Found<google.Task> = null, mail: Found<google.Mail> = null;
  if (google.googleConfigured() && await google.account()) {
    [events, tasks, mail] = await Promise.all([
      // From now on today: an event still going on counts, one that ended this morning doesn't.
      fromGoogle("calendar", async () => (await google.events(from, end)).filter((e) => onDay(e, target))),
      fromGoogle("tasks", google.tasks),
      isToday ? fromGoogle("email", () => google.mail(google.IMPORTANT, 5)) : Promise.resolve(null),
    ]);
  }
  const reminders = await sql<{ body: string; due: Date }[]>`
    select distinct on (body, due_at) body, due_at as due from messages
    where kind = 'reminder' and delivered_at is null and due_at > ${from} and due_at <= ${end} and body is not null
    order by due_at, body limit 10`;
  if (!isToday) return { day: target, events, tasks, reminders: reminders.map((r) => ({ body: r.body, due: new Date(r.due) })), savedLastDay: 0, resurface: null };
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from items
    where created_at >= ${new Date(now.getTime() - 86_400_000)} and created_at < ${now}`;
  const [old] = await sql<{ id: string; title: string; url: string | null; file_path: string | null; created_at: Date }[]>`
    select id, title, url, file_path, created_at from items
    where status = 'organized' and title is not null and created_at < ${new Date(now.getTime() - 7 * 86_400_000)}
    order by random() limit 1`;
  const base = publicUrl?.replace(/\/$/, "");
  const resurface = old
    ? {
      title: old.title,
      savedOn: new Date(old.created_at),
      link: old.url?.startsWith("https://") ? old.url : old.file_path && base?.startsWith("https://") ? `${base}/files/${old.id}` : null,
    }
    : null;
  return {
    events, tasks, mail, reminders: reminders.map((r) => ({ body: r.body, due: new Date(r.due) })), savedLastDay: n, resurface,
    streak: streak(await savedDays(timeZone), today(now, timeZone)),
  };
}
