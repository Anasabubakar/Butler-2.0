// Little celebrations: your 100th save, a 7-day saving streak. Counted, not guessed.
import { sql } from "./db.ts";

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000];
const STREAKS = [3, 7, 14, 30, 50, 100, 200, 365];

/** The milestone `total` just reached, if any. */
export const milestone = (total: number) => (MILESTONES.includes(total) ? total : null);

/**
 * Days in a row with at least one save, ending today (or yesterday, so the streak isn't
 * "broken" in the morning before you've saved anything). `days` are local dates like 2026-10-20.
 */
export function streak(days: string[], today: string): number {
  const have = new Set(days);
  const back = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  let start = have.has(today) ? today : back(today, 1);
  let n = 0;
  while (have.has(start)) {
    n++;
    start = back(start, 1);
  }
  return n;
}

export const streakWorthCheering = (n: number) => STREAKS.includes(n);

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n.toLocaleString("en")}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function milestoneNote(total: number): string {
  return `🎉 That was your ${ordinal(total)} save! Your library keeps growing. ` +
    (total >= 100 ? "Ask me \"what did I save about…\" any time to dig through it." : "Keep sharing things to Butler.");
}

export function streakNote(n: number): string {
  return `🔥 ${n} days in a row of saving to Butler! ` +
    (n >= 30 ? "That's a real habit now." : "Save something tomorrow to keep it going.");
}

/** Local dates (in `timeZone`) with at least one save, over the last year. */
export async function savedDays(timeZone: string): Promise<string[]> {
  const rows = await sql<{ day: string }[]>`
    select distinct to_char(created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day from items
    where created_at > now() - interval '400 days'`;
  return rows.map((r) => r.day);
}

export async function total(): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from items`;
  return n;
}
