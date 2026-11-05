// Finds a service's logo on the web, for the card of each connection. Butler looks at the
// service's own website for its icon (the one browsers show in a tab), tries the big ones
// first, and keeps the first that really is a picture. Nothing private is sent: only a
// plain request for the public home page and its icons.
import { publicFetch } from "./outbound.ts";

export interface Logo {
  type: string; // the image's real type, found from its first bytes
  bytes: Uint8Array;
}

/** Fetches a link; tests give it a pretend web. */
export type Get = (url: string, init?: RequestInit) => Promise<Response>;

const PAGE_MAX = 300_000;
const IMAGE_MAX = 400_000;
const IMAGE_MIN = 80;
const TRIES = 6;
const WAIT_MS = 5_000;

/** Services whose MCP address is on a different name than the brand people know. */
const ALIASES: Record<string, string> = { "githubcopilot.com": "github.com" };

/** Second-level names that count as part of the ending, like co.uk. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** Sites to look at for a host, the brand's main site first: mcp.notion.com → notion.com, mcp.notion.com. */
export function sitesFor(host: string): string[] {
  const name = host.toLowerCase().replace(/\.$/, "");
  const labels = name.split(".");
  if (labels.length < 2 || /^[\d.]+$/.test(name) || name.includes(":")) return [name];
  const last = labels[labels.length - 1];
  const least = last.length <= 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  const found: string[] = [];
  for (let n = least; n <= labels.length && found.length < 3; n++) {
    const site = labels.slice(-n).join(".");
    const aliased = ALIASES[site] ?? site;
    if (!found.includes(aliased)) found.push(aliased);
  }
  return found;
}

interface Icon {
  url: string;
  score: number;
}

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

/** The icons a page points to, best first: scalable ones, then the biggest. */
export function iconsIn(html: string, base: string): Icon[] {
  const icons: Icon[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!href || !rel.some((r) => r === "icon" || r === "apple-touch-icon" || r === "apple-touch-icon-precomposed")) continue;
    let url: URL;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const sizes = (attr(tag, "sizes") ?? "").toLowerCase();
    const wide = Math.max(0, ...(sizes.match(/\d+/g) ?? []).map(Number));
    const vector = /svg/i.test(attr(tag, "type") ?? "") || /\.svg(\?|$)/i.test(url.pathname + url.search) || sizes === "any";
    const apple = rel.some((r) => r.startsWith("apple-touch-icon"));
    icons.push({ url: url.href, score: vector ? 1000 : wide || (apple ? 180 : 32) });
  }
  return icons.sort((a, b) => b.score - a.score);
}

/** What kind of picture these bytes are, or null when they aren't one Butler will show. */
export function sniff(bytes: Uint8Array): string | null {
  if (bytes.length < IMAGE_MIN) return null;
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0, 0, 1, 0)) return "image/x-icon";
  const head = new TextDecoder().decode(bytes.slice(0, 600)).toLowerCase();
  if (head.includes("<svg") && !/^\s*<!doctype html|<html/.test(head)) {
    const all = new TextDecoder().decode(bytes);
    // A logo is a drawing. Anything that could run code is refused.
    if (/<script|<foreignobject|\bon[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(all)) return null;
    return "image/svg+xml";
  }
  return null;
}

/** Reads at most `max` bytes of a response, or null when it's bigger. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function pictureAt(url: string, get: Get): Promise<Logo | null> {
  const res = await get(url, { signal: AbortSignal.timeout(WAIT_MS) });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const bytes = await readCapped(res, IMAGE_MAX);
  const type = bytes && sniff(bytes);
  return bytes && type ? { type, bytes } : null;
}

/** The logo of the service at `host`, or null when none could be found. */
export async function findLogo(host: string, get: Get = (u, i) => publicFetch(u, i)): Promise<Logo | null> {
  for (const site of sitesFor(host)) {
    try {
      const home = await get(`https://${site}/`, { signal: AbortSignal.timeout(WAIT_MS) });
      let icons: Icon[] = [];
      let origin = `https://${site}`;
      if (home.ok && /html/i.test(home.headers.get("content-type") ?? "")) {
        const page = await readCapped(home, PAGE_MAX);
        if (page) {
          origin = new URL(home.url || `https://${site}/`).origin;
          icons = iconsIn(new TextDecoder().decode(page), home.url || `https://${site}/`);
        }
      } else {
        await home.body?.cancel();
      }
      icons.push({ url: `${origin}/favicon.ico`, score: 0 });
      const seen = new Set<string>();
      for (const icon of icons) {
        if (seen.has(icon.url) || seen.size >= TRIES) continue;
        seen.add(icon.url);
        const logo = await pictureAt(icon.url, get).catch(() => null);
        if (logo) return logo;
      }
    } catch {
      // this site didn't work out; try the next
    }
  }
  return null;
}
