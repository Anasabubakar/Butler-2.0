// The morning brief: today's calendar, reminders still to come, what you saved
// yesterday, and one older save worth another look. Written without AI, so it's free and always works.
import { sql } from "./db.ts";
import * as google from "./google.ts";
import { localIso } from "./command.ts";
import { savedDays, streak } from "./streaks.ts";

export interface Parts {
  events: google.Event[] | null; // null: Google isn't connected
  reminders: { body: string; due: Date }[];
  savedLastDay: number;
  resurface: { title: string; link: string | null; savedOn: Date } | null;
  streak?: number; // days in a row with a save
}

/** The last moment of today in `timeZone`. */
export function endOfDay(now: Date, timeZone: string): Date {
  const iso = localIso(now, timeZone);
  return new Date(`${iso.slice(0, 10)}T23:59:59${iso.slice(19)}`);
}

/** Today's date in `timeZone`, like 2026-10-20. */
export const today = (now: Date, timeZone: string) => localIso(now, timeZone).slice(0, 10);

const clock = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);

/** The brief as a short plain note. */
export function compose(p: Parts, now: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(now);
  const hour = Number(localIso(now, timeZone).slice(11, 13));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lines = [`${hello}! It's ${day}.`];
  if (p.events === null) lines.push("", "Connect Google on the website to see your calendar here.");
  else if (!p.events.length) lines.push("", "Nothing on your calendar today.");
  else lines.push("", "Today:", ...p.events.map((e) => `• ${e.allDay ? "All day" : clock(e.start, timeZone)} ${e.title}`));
  if (p.reminders.length) {
    lines.push("", "Reminders:", ...p.reminders.map((r) => `• ${clock(r.due, timeZone)} ${r.body}`));
  }
  if (p.savedLastDay) lines.push("", `You saved ${p.savedLastDay} thing${p.savedLastDay === 1 ? "" : "s"} in the last day.`);
  if (p.streak && p.streak >= 2) lines.push(`🔥 ${p.streak}-day saving streak. Save something today to keep it going.`);
  if (p.resurface) {
    const when = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(p.resurface.savedOn);
    lines.push("", `From your library (saved ${when}): ${p.resurface.title}`);
    if (p.resurface.link) lines.push(p.resurface.link);
  }
  return lines.join("\n");
}

/** Collects what goes in today's brief. */
export async function gather(now: Date, timeZone: string, publicUrl?: string): Promise<Parts> {
  const end = endOfDay(now, timeZone);
  let events: google.Event[] | null = null;
  if (google.googleConfigured() && await google.account()) {
    events = await google.events(now, end).catch((e) => {
      console.warn("brief: calendar", String(e).slice(0, 200));
      return [];
    });
  }
  const reminders = await sql<{ body: string; due: Date }[]>`
    select distinct on (body, due_at) body, due_at as due from messages
    where kind = 'reminder' and delivered_at is null and due_at > ${now} and due_at <= ${end} and body is not null
    order by due_at, body limit 10`;
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
    events, reminders: reminders.map((r) => ({ body: r.body, due: new Date(r.due) })), savedLastDay: n, resurface,
    streak: streak(await savedDays(timeZone), today(now, timeZone)),
  };
}
