// A spending log you talk to: "I spent 2,500 on suya", then "how much did I spend this week?".
// Totals are added up here, not by AI, so they're always right.
import { sql } from "./db.ts";
import { localIso } from "./command.ts";

export const SPEND_CATEGORIES = [
  "food", "transport", "airtime", "bills", "shopping", "fun", "health", "family", "other",
] as const;
export type SpendCategory = typeof SPEND_CATEGORIES[number];
export const PERIODS = ["today", "week", "month", "year"] as const;
export type Period = typeof PERIODS[number];

export interface Spend {
  amount: number;
  currency: string;
  what: string;
  category: SpendCategory;
}

/** The currency to assume when you don't say one. */
export const defaultCurrency = () => (Deno.env.get("BUTLER_CURRENCY") ?? "NGN").toUpperCase();

export function category(c: string | null | undefined): SpendCategory {
  const lower = c?.trim().toLowerCase() ?? "";
  return SPEND_CATEGORIES.find((k) => k === lower) ?? (/data|airtime|recharge/.test(lower) ? "airtime" : "other");
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 })
      .format(amount);
  } catch {
    return `${amount.toLocaleString("en")} ${currency}`; // not a currency code Intl knows
  }
}

/** When `period` began in `timeZone`. Weeks start on Monday. */
export function startOf(period: Period, now: Date, timeZone: string): Date {
  const iso = localIso(now, timeZone); // 2026-10-20T16:05:00+01:00
  const offset = iso.slice(19);
  const day = new Date(`${iso.slice(0, 10)}T00:00:00${offset}`);
  if (period === "today") return day;
  if (period === "month") return new Date(`${iso.slice(0, 8)}01T00:00:00${offset}`);
  if (period === "year") return new Date(`${iso.slice(0, 5)}01-01T00:00:00${offset}`);
  const weekday = (new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return new Date(day.getTime() - weekday * 86_400_000);
}

export async function record(spend: Spend, device: string) {
  await sql`insert into spending ${sql({ ...spend, device })}`;
}

export interface Row extends Spend {
  spent_at: Date;
}

export async function since(from: Date, cat?: SpendCategory | null): Promise<Row[]> {
  const rows = await sql<(Omit<Row, "amount"> & { amount: string })[]>`
    select spent_at, amount, currency, what, category from spending
    where spent_at >= ${from} ${cat ? sql`and category = ${cat}` : sql``}
    order by spent_at`;
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

const PERIOD_WORDS: Record<Period, string> = { today: "today", week: "this week", month: "this month", year: "this year" };

/** "This week you spent ₦12,500: food ₦7,000, transport ₦5,500. The biggest was suya (₦3,000)." */
export function compose(rows: Row[], period: Period, cat?: SpendCategory | null): string {
  const when = PERIOD_WORDS[period];
  const on = cat ? ` on ${cat}` : "";
  if (!rows.length) return `You haven't logged any spending${on} ${when}. Tell me things like "I spent 2,500 on suya".`;
  const byCurrency = new Map<string, Row[]>();
  for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);
  const parts: string[] = [];
  for (const [currency, list] of byCurrency) {
    const total = list.reduce((sum, r) => sum + r.amount, 0);
    const byCat = new Map<string, number>();
    for (const r of list) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
    const split = cat || byCat.size < 2 ? "" : `: ${[...byCat].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${money(v, currency)}`).join(", ")}`;
    const biggest = list.reduce((a, b) => (b.amount > a.amount ? b : a));
    parts.push(`${money(total, currency)}${on}${split}. The biggest was ${biggest.what} (${money(biggest.amount, currency)})`);
  }
  const count = `${rows.length} thing${rows.length === 1 ? "" : "s"}`;
  return `${when[0].toUpperCase()}${when.slice(1)} you spent ${parts.join("; and ")}. (${count} logged.)`;
}
