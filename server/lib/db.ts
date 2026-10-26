import postgres from "npm:postgres@3.4.9";
import type { OrganizedItem } from "./organize.ts";

// DATABASE_URL if set; otherwise the standard PGHOST/PGUSER/PGDATABASE variables,
// with the password from PGPASSWORD or POSTGRES_PASSWORD (as the Docker setup provides).
const url = Deno.env.get("DATABASE_URL");
const options = { max: 5, onnotice: () => {} };
export const sql = url
  ? postgres(url, options)
  : postgres({ ...options, password: Deno.env.get("PGPASSWORD") ?? Deno.env.get("POSTGRES_PASSWORD") });

export interface Item {
  id: string;
  created_at: string;
  device: string;
  kind: "link" | "image" | "video" | "text" | "file";
  url: string | null;
  body: string | null;
  note: string | null;
  file_path: string | null;
  mime: string | null;
  thumbnail: string | null;
  platform: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
  category: string | null;
  status: "pending" | "organized" | "failed";
  error: string | null;
  board_x: number | null;
  board_y: number | null;
  board_tilt: number | null;
  share_token?: string | null; // set while the note has a public link
  details?: string | null; // longer notes, like a video's key points
  archive_url?: string | null; // a copy on the Internet Archive
  link_dead?: boolean; // the original stopped loading
  price?: string | null; // numeric comes back as text
  price_first?: string | null;
  price_currency?: string | null;
}

const COLUMNS = sql`id, created_at, device, kind, url, body, note, file_path, mime, thumbnail,
  platform, title, summary, tags, category, status, error, board_x, board_y, board_tilt, share_token, details,
  archive_url, link_dead, price, price_first, price_currency`;

/** Applies every db/migrations/*.sql file not applied yet, in name order. */
export async function migrate(dir: string) {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const name of files) {
    if (done.has(name)) continue;
    const text = await Deno.readTextFile(`${dir}/${name}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    console.log(`migrated ${name}`);
  }
}

export async function insertItem(row: Pick<Item, "device" | "kind" | "url" | "body" | "note" | "mime" | "platform">) {
  const [item] = await sql<{ id: string }[]>`insert into items ${sql(row)} returning id`;
  return item.id;
}

export async function updateItem(id: string, patch: Partial<Item> | (OrganizedItem & { status: Item["status"]; error: null })) {
  await sql`update items set ${sql(patch as Record<string, unknown>)} where id = ${id}`;
}

export interface ListQuery {
  q?: string;
  category?: string;
  platform?: string;
  tag?: string;
  before?: string;
  limit: number;
}

export function listItems(f: ListQuery) {
  return sql<Item[]>`
    select ${COLUMNS} from items
    where true
      ${f.q ? sql`and search @@ websearch_to_tsquery('simple', ${f.q})` : sql``}
      ${f.category === "unsorted" ? sql`and category is null` : f.category ? sql`and category = ${f.category}` : sql``}
      ${f.platform === "none" ? sql`and platform is null` : f.platform ? sql`and platform = ${f.platform}` : sql``}
      ${f.tag ? sql`and ${f.tag} = any(tags)` : sql``}
      ${f.before ? sql`and created_at < ${f.before}` : sql``}
    order by created_at desc
    limit ${f.limit}`;
}

export function itemsById(ids: string[]) {
  return sql<Item[]>`select ${COLUMNS} from items where id = any(${ids}::uuid[])`;
}

export async function getItem(id: string): Promise<Item | undefined> {
  const [item] = await sql<Item[]>`select ${COLUMNS} from items where id = ${id}`;
  return item;
}

export async function deleteItem(id: string): Promise<Item | undefined> {
  const [item] = await sql<Item[]>`delete from items where id = ${id} returning ${COLUMNS}`;
  return item;
}

/** Sticks a note somewhere on the board, or takes it off (all null). */
export async function place(id: string, x: number | null, y: number | null, tilt: number | null) {
  const rows = await sql`update items set board_x = ${x}, board_y = ${y}, board_tilt = ${tilt} where id = ${id} returning id`;
  return rows.length > 0;
}

/** Takes every note off the board, so they line up again. */
export async function tidyBoard() {
  await sql`update items set board_x = null, board_y = null, board_tilt = null where board_x is not null`;
}

export function facets() {
  return sql<{ facet: string; value: string; n: number }[]>`
    select 'category' as facet, coalesce(category, 'unsorted') as value, count(*)::int as n from items group by 2
    union all
    select 'platform', coalesce(platform, 'none'), count(*)::int from items group by 2
    union all
    (select 'tag', t, count(*)::int from items, unnest(tags) as t group by 2 order by 3 desc limit 30)`;
}

/** The library's collections, biggest first, leaving out the old fixed buckets. */
export async function collections(old: readonly string[], limit = 80): Promise<string[]> {
  const rows = await sql<{ category: string }[]>`
    select category from items where category is not null and not (lower(category) = any(${[...old]}))
    group by 1 order by count(*) desc, 1 limit ${limit}`;
  return rows.map((r) => r.category);
}

/** Items left pending by a crash or restart. */
export function stalePending() {
  return sql<Item[]>`select ${COLUMNS} from items where status = 'pending' and created_at < now() - interval '2 minutes'`;
}

/** Saved shopping links whose price is due a check: ones with a known price, or never tried. */
export function pricesToCheck(limit: number) {
  return sql<{ id: string; url: string; title: string | null; price: string | null; price_first: string | null; price_currency: string | null }[]>`
    select id, url, title, price, price_first, price_currency from items
    where kind = 'link' and url like 'http%' and created_at > now() - interval '180 days'
      and (price is not null or (price_checked_at is null and category = 'shopping'))
      and (price_checked_at is null or price_checked_at < now() - interval '12 hours')
    order by price_checked_at nulls first limit ${limit}`;
}

export async function setPrice(id: string, price: { amount: number; currency: string } | null) {
  if (!price) await sql`update items set price_checked_at = now() where id = ${id}`;
  else {
    await sql`update items set price = ${price.amount}, price_currency = ${price.currency},
      price_first = coalesce(price_first, ${price.amount}), price_checked_at = now() where id = ${id}`;
  }
}

/** Links that need archiving (newest first), or checking (least recently checked first). */
export function linksToArchive(limit: number) {
  return sql<{ id: string; url: string }[]>`
    select id, url from items where kind = 'link' and url like 'http%' and archive_url is null
      and created_at > now() - interval '30 days'
    order by created_at desc limit ${limit}`;
}

export function linksToCheck(limit: number) {
  return sql<{ id: string; url: string }[]>`
    select id, url from items where kind = 'link' and url like 'http%' and not link_dead
      and created_at < now() - interval '1 day'
      and (link_checked_at is null or link_checked_at < now() - interval '30 days')
    order by link_checked_at nulls first, created_at limit ${limit}`;
}

export async function markChecked(id: string, dead: boolean) {
  await sql`update items set link_checked_at = now(), link_dead = ${dead} where id = ${id}`;
}

/** Gives a note a public link token, or takes it away (null). False if there's no such note. */
export async function setShareToken(id: string, token: string | null): Promise<boolean> {
  const rows = await sql`update items set share_token = ${token} where id = ${id} returning id`;
  return rows.length > 0;
}

export async function itemByShareToken(token: string): Promise<Item | null> {
  const [item] = await sql<Item[]>`select ${COLUMNS} from items where share_token = ${token}`;
  return item ?? null;
}
