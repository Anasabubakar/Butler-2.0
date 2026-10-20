// "Find similar" and search by meaning: each organized item gets an embedding from
// Gemini, a list of numbers where items about the same thing end up close together.
import { sql } from "./db.ts";
import { geminiReady } from "./gemini.ts";

const base = () => Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;

export const meaningReady = geminiReady;

/** The embedding of `text`. Documents and search queries are embedded slightly differently. */
export async function embed(text: string, kind: "document" | "query"): Promise<number[]> {
  const res = await fetch(`${base()}/models/${MODEL}:embedContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "" },
    body: JSON.stringify({
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      outputDimensionality: DIMENSIONS,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini embedding answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values?.length) throw new Error("Gemini gave no embedding");
  return values;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Embeddable {
  title: string | null;
  summary: string | null;
  tags: string[];
  note: string | null;
  url: string | null;
  body: string | null;
}

/** The text that stands for an item: what it's called, what it's about, and your note. */
export function itemText(item: Embeddable): string {
  return [item.title, item.summary, item.tags.join(", "), item.note, item.url, item.body?.slice(0, 1000)]
    .filter(Boolean).join("\n");
}

/** Embeds one organized item and stores it. Failures are left for the next backfill. */
export async function embedItem(id: string) {
  if (!meaningReady()) return;
  const [item] = await sql<(Embeddable & { id: string })[]>`
    select id, title, summary, tags, note, url, body from items where id = ${id}`;
  if (!item) return;
  const embedding = await embed(itemText(item), "document");
  await sql`update items set embedding = ${embedding}::real[] where id = ${id}`;
}

/** Embeds organized items that don't have one yet, a few at a time. */
export async function backfill(limit = 200) {
  if (!meaningReady()) return;
  const rows = await sql<{ id: string }[]>`
    select id from items where status = 'organized' and embedding is null order by created_at desc limit ${limit}`;
  for (const { id } of rows) {
    await embedItem(id).catch((e) => console.error("embedding", id, String(e).slice(0, 200)));
    await new Promise((r) => setTimeout(r, 250)); // gentle on the free quota
  }
}

/** Item ids closest in meaning to `vector`, best first, leaving out `except`. */
export async function nearest(vector: number[], limit: number, except?: string): Promise<{ id: string; score: number }[]> {
  const rows = await sql<{ id: string; embedding: number[] }[]>`
    select id, embedding from items where embedding is not null`;
  return rows
    .filter((r) => r.id !== except)
    .map((r) => ({ id: r.id, score: cosine(vector, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function embeddingOf(id: string): Promise<number[] | null> {
  const [row] = await sql<{ embedding: number[] | null }[]>`select embedding from items where id = ${id}`;
  return row?.embedding ?? null;
}
