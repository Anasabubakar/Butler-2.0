// Butler's memory: the conversation so far (so "and tomorrow?" makes sense), and lasting
// facts it learned about you (so it knows your sister's name next month). Both have limits:
// a prompt can only hold so much, and you can see and forget everything on the website.
import { sql } from "./db.ts";

export interface Turn {
  id: string;
  created_at: string;
  role: "owner" | "butler" | "break";
  device: string | null;
  text: string;
}

export interface Memory {
  id: string;
  created_at: string;
  text: string;
  source: "learned" | "told";
}

/** How many turns of the conversation a reply sees, and how far back (main chat only). */
export const HISTORY_TURNS = 20;
export const HISTORY_HOURS = 48;
/** The most facts kept; past this the oldest learned ones go first. */
export const MAX_MEMORIES = 200;
/** How much of what Butler knows fits in one prompt, newest first. */
const MEMORY_CHARS = 6000;
const TURN_CHARS = 1200;

/** Things never worth keeping in memory: passwords, codes, card and account numbers. */
const SECRET = /pass(word|code|phrase)|\bpin\b|\botp\b|\bcvv\b|security code|secret word|api key|token|seed phrase|\b\d[\d -]{11,22}\d\b/i;

/** A fact as it's kept: one tidy line, or null if it's empty, too long or a secret. */
export function cleanFact(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const fact = text.replace(/\s+/g, " ").trim().replace(/^[-•*]\s*/, "");
  if (fact.length < 3 || fact.length > 300 || SECRET.test(fact)) return null;
  return fact;
}

/** What Butler knows about you, numbered for the AI, newest first, within the prompt's budget. */
export function memoryText(memories: Memory[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const [i, m] of memories.entries()) {
    const line = `[${i + 1}] ${m.text}`;
    if (used + line.length > MEMORY_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** The conversation for the AI, oldest first, each line with when it was said. */
export function historyText(turns: Turn[], timeZone: string): string {
  const when = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" });
  return turns.filter((t) => t.role !== "break").map((t) => {
    const text = t.text.length > TURN_CHARS ? `${t.text.slice(0, TURN_CHARS)}…` : t.text;
    return `[${when.format(new Date(t.created_at))}] ${t.role === "owner" ? "owner" : "you"}: ${text}`;
  }).join("\n");
}

// --- the conversation -----------------------------------------------------------------------

/** Adds one turn: what you said, what Butler said, or a "new chat" break. */
export async function addTurn(role: Turn["role"], text: string, device: string | null, itemId: string | null = null) {
  const [row] = await sql<{ id: string }[]>`
    insert into chat_turns (role, text, device, item_id) values (${role}, ${text.slice(0, 8000)}, ${device}, ${itemId})
    returning id`;
  // Now and then, the main conversation drops what's more than a year old.
  if (Number(row.id) % 200 === 0) await sql`delete from chat_turns where item_id is null and created_at < now() - interval '365 days'`;
}

/**
 * The latest turns, oldest first, since the last "new chat": for the main conversation only
 * those from the last two days (older ones are what memories are for), for a save all of them.
 */
export async function recentTurns(itemId: string | null, limit = HISTORY_TURNS): Promise<Turn[]> {
  const rows = await sql<Turn[]>`
    select id::text, created_at, role, device, text from chat_turns
    where ${itemId ? sql`item_id = ${itemId}` : sql`item_id is null and created_at > now() - ${`${HISTORY_HOURS} hours`}::interval`}
    order by created_at desc, id desc limit ${limit}`;
  const sinceBreak = rows.findIndex((r) => r.role === "break");
  return (sinceBreak === -1 ? rows : rows.slice(0, sinceBreak)).reverse();
}

/** The last thing Butler said in a conversation, if anything. */
export async function lastSaid(itemId: string | null): Promise<string | null> {
  const [row] = await sql<{ text: string }[]>`
    select text from chat_turns where role = 'butler' and ${itemId ? sql`item_id = ${itemId}` : sql`item_id is null`}
    order by created_at desc, id desc limit 1`;
  return row?.text ?? null;
}

// --- what Butler sent you on its own --------------------------------------------------------

/** Who sends Butler's own notes: the brief, recaps, recipes, price drops, cheers, focus timers. */
const BUTLER_SENDERS = ["Butler", "Butler focus"];

/**
 * What Butler said in a message it pushed to your devices, as the conversation keeps it: its own
 * notes and every reminder. Null for things you sent between your own devices.
 */
export function pushedText(m: { kind: string; from_device: string; body: string | null }): string | null {
  const body = m.body?.trim();
  if (!body) return null;
  if (m.kind === "reminder") return `Reminder: ${body}`;
  if (m.kind === "note" && BUTLER_SENDERS.includes(m.from_device)) return body;
  return null;
}

let pushing: Promise<unknown> = Promise.resolve();

/**
 * Puts something Butler pushed into the main conversation, so a reply to it ("nah", "yes do
 * it") follows on, wherever you answer. Each device takes its own copy, so it's kept once:
 * not again if it's already there since it was sent (`since`). One at a time, so two devices
 * taking it at the same moment don't both add it.
 */
export function addPushed(text: string, since: string): Promise<void> {
  const next = pushing.then(async () => {
    const [seen] = await sql`
      select 1 from chat_turns where item_id is null and role = 'butler' and text = ${text.slice(0, 8000)}
      and created_at >= ${since}::timestamptz limit 1`;
    if (!seen) await addTurn("butler", text, null);
  });
  pushing = next.catch(() => {});
  return next;
}

// --- what you're answering -------------------------------------------------------------------

/** The heading a device puts on what it shows, like "A note from Butler: ". Reminders keep theirs. */
const SHOWN_AS = /^(?:A note|A link|On your clipboard|Files?)(?: from [^:\n]{1,60})?:\s*/i;

/** What Butler said, from what a device showed: its heading taken off. */
export function shownText(text: string): string {
  return text.trim().replace(SHOWN_AS, "").trim();
}

const plain = (text: string) => shownText(text).replace(/\s+/g, " ").toLowerCase();

/**
 * The turn where Butler said what a device showed (`shown`, from its bubble), newest first.
 * A long message matches when one is the start of the other, in case a device cut it short.
 */
export function findSaid(turns: Turn[], shown: string): Turn | null {
  const want = plain(shown);
  if (!want) return null;
  for (const t of [...turns].reverse()) {
    if (t.role !== "butler") continue;
    const said = plain(t.text);
    if (said === want) return t;
    if (Math.min(said.length, want.length) >= 40 && (said.startsWith(want) || want.startsWith(said))) return t;
  }
  return null;
}

/** How long Butler's last word stays what a short reply like "nah" is taken to answer. */
const ANSWERING_MS = 12 * 3_600_000;

/** Butler's last word in the conversation, if nothing came after it and it's recent: what you're likely answering. */
export function lastWord(turns: Turn[], now = new Date()): Turn | null {
  const last = turns.at(-1);
  if (last?.role !== "butler") return null;
  return now.getTime() - new Date(last.created_at).getTime() <= ANSWERING_MS ? last : null;
}

/** Starts a new chat: what came before is kept but no longer read. */
export const newChat = (itemId: string | null) => addTurn("break", "", null, itemId);

/** Deletes a conversation for good: the main one, or one save's. */
export async function clearChat(itemId: string | null) {
  await sql`delete from chat_turns where ${itemId ? sql`item_id = ${itemId}` : sql`item_id is null`}`;
}

// --- what Butler knows about you -------------------------------------------------------------

export function memories(): Promise<Memory[]> {
  return sql<Memory[]>`select id, created_at, text, source from memories order by created_at desc limit ${MAX_MEMORIES}`;
}

/** Keeps facts not already known (same words, ignoring case). Returns the ones added. */
export async function remember(facts: unknown[], source: Memory["source"] = "learned"): Promise<string[]> {
  const known = new Set((await memories()).map((m) => m.text.toLowerCase()));
  const added: string[] = [];
  for (const raw of facts.slice(0, 5)) {
    const fact = cleanFact(raw);
    if (!fact || known.has(fact.toLowerCase())) continue;
    await sql`insert into memories (text, source) values (${fact}, ${source})`;
    known.add(fact.toLowerCase());
    added.push(fact);
  }
  if (added.length) {
    await sql`delete from memories where id in (
      select id from memories order by (source = 'told') desc, created_at desc offset ${MAX_MEMORIES})`;
  }
  return added;
}

export async function forget(id: string): Promise<boolean> {
  return (await sql`delete from memories where id = ${id} returning id`).length > 0;
}

export async function forgetAll() {
  await sql`delete from memories`;
}
