// Best-effort page metadata for a saved link. Never throws.

export interface PageMeta {
  title: string | null;
  description: string | null;
  image: string | null;
}

const EMPTY: PageMeta = { title: null, description: null, image: null };

const OEMBED: Record<string, (url: string) => string> = {
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ButlerBot/0.1)", accept },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export function metaTag(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']` +
      `|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decode(v) : null;
}

export function parseHtmlMeta(html: string): PageMeta {
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return {
    title: metaTag(html, "og:title") ?? (titleTag ? decode(titleTag) : null),
    description: metaTag(html, "og:description") ?? metaTag(html, "description"),
    image: metaTag(html, "og:image"),
  };
}

export async function fetchMeta(url: string, platform: string | null): Promise<PageMeta> {
  if (!/^https?:\/\//i.test(url)) return EMPTY;

  const oembed = platform ? OEMBED[platform] : undefined;
  if (oembed) {
    const res = await get(oembed(url), "application/json");
    if (res) {
      try {
        const j = await res.json();
        return {
          title: j.title ?? null,
          description: j.author_name ? `by ${j.author_name}` : null,
          image: j.thumbnail_url ?? null,
        };
      } catch { /* fall through to HTML */ }
    }
  }

  const res = await get(url, "text/html");
  if (!res || !(res.headers.get("content-type") ?? "").includes("html")) return EMPTY;
  const html = (await res.text()).slice(0, 300_000);
  return parseHtmlMeta(html);
}
