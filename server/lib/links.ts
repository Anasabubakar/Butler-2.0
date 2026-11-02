// Short links and link previews for heads-ups, so a note reads like Poke's: one tidy link
// with a picture and a title, not a wall of tracking URL. Secret links (password resets,
// sign-in links) never get either: they're shown once, as they are, and never kept.
import { sql } from "./db.ts";
import { fetchMeta } from "./meta.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random token for a short link: 10 characters, hard to guess. */
export function token(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** The server's own address, when it's on https; short links need it. */
const base = () => {
  const url = (Deno.env.get("PUBLIC_URL") ?? "").replace(/\/$/, "");
  return url.startsWith("https://") ? url : null;
};

/** A short link to `url` on this server (/go/<token>), or the url itself when there's no public address. */
export async function shorten(url: string): Promise<string> {
  const home = base();
  if (!home || !url.startsWith("https://") || url.length <= 60) return url;
  const t = token();
  await sql`insert into short_links (token, url) values (${t}, ${url.slice(0, 2000)})`;
  return `${home}/go/${t}`;
}

/** Where a short link goes, or null when it's unknown or has expired. */
export async function resolve(t: string): Promise<string | null> {
  if (!/^[A-Za-z0-9]{8,16}$/.test(t)) return null;
  const [row] = await sql<{ url: string }[]>`select url from short_links where token = ${t} and expires_at > now()`;
  return row?.url ?? null;
}

export const sweep = () => sql`delete from short_links where expires_at < now()`;

/** What a device shows with a note. */
export interface Card {
  title?: string;
  site?: string;
  image?: string;
  /** A login code, for a one-tap Copy button. */
  copy?: string;
}

/** A preview of a link: the page's title, its site and its picture. Empty when the page won't say. */
export async function preview(url: string): Promise<Card> {
  const meta = await fetchMeta(url, null).catch(() => null);
  let site = "";
  try {
    site = new URL(url).hostname.replace(/^www\./, "");
  } catch { /* not a URL */ }
  const card: Card = {};
  if (meta?.title) card.title = meta.title.slice(0, 120);
  if (site) card.site = site;
  if (meta?.image?.startsWith("https://")) card.image = meta.image.slice(0, 1000);
  return card;
}
