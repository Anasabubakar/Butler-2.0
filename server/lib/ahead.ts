// What the phone should be able to tell you with no internet: reminders and events coming
// up soon, handed over ahead of time so the phone can ring them on its own when the
// moment comes, even with mobile data off. Only things known in advance; never codes,
// links that unlock an account, or anything else that's secret.

import { sameEvent, soonNote } from "./alerts.ts";

/** How far ahead the phone keeps a copy. Two days covers a weekend with data off. */
export const AHEAD_HOURS = 48;

/** One thing for the phone to ring at `at`, by itself, if Butler hasn't reached it by then. */
export interface Ahead {
  /** Stays the same between refreshes, so the phone never rings it twice. */
  key: string;
  kind: "reminder" | "event";
  at: string;
  body: string;
  url: string | null;
  /**
   * How the phone tells, when it's online after all, that a note from Butler is this one:
   * a reminder has the same message id; an event's note starts with these words.
   */
  match: string;
}

export interface Reminder {
  id: string;
  body: string | null;
  due_at: Date | string;
}

export interface Event {
  title: string;
  starts_at: Date | string;
  place: string | null;
  link: string | null;
}

/** Events are told an hour before they start, as the server does (main.ts eventsSoon). */
const EVENT_LEAD_MS = 60 * 60_000;

/**
 * The phone's offline plan: reminders at their time, and each event (kept from email or on
 * your calendar, once each) an hour before, worded exactly as Butler would word it.
 */
export function plan(reminders: Reminder[], kept: Event[], calendar: Event[], now: Date, timeZone: string): Ahead[] {
  const until = now.getTime() + AHEAD_HOURS * 3_600_000;
  const out: Ahead[] = [];
  for (const r of reminders) {
    const at = new Date(r.due_at);
    if (at.getTime() <= now.getTime() || at.getTime() > until) continue;
    out.push({ key: `reminder:${r.id}`, kind: "reminder", at: at.toISOString(), body: r.body ?? "", url: null, match: r.id });
  }
  const events: Event[] = [...kept];
  for (const c of calendar) {
    const start = new Date(c.starts_at);
    if (!events.some((e) => sameEvent({ title: e.title, start: new Date(e.starts_at) }, { title: c.title, start }))) events.push(c);
  }
  for (const e of events) {
    const start = new Date(e.starts_at);
    const at = new Date(start.getTime() - EVENT_LEAD_MS);
    // Already inside the hour: Butler tells it now, online. Too far off: next refresh.
    if (at.getTime() <= now.getTime() || at.getTime() > until) continue;
    out.push({
      key: `event:${e.title.trim().toLowerCase()}|${start.toISOString().slice(0, 16)}`,
      kind: "event",
      at: at.toISOString(),
      body: soonNote({ ...e, starts_at: start }, at, timeZone),
      url: e.link?.startsWith("https://") ? e.link : null,
      match: `${e.title} starts `,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
