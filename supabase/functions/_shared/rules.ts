// Cheap, instant classification that runs before (and instead of) the LLM where it can.

export type Kind = "link" | "image" | "video" | "text" | "file";

const PLATFORMS: Array<[string, string[]]> = [
  ["tiktok", ["tiktok.com"]],
  ["instagram", ["instagram.com", "instagr.am"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["x", ["x.com", "twitter.com"]],
  ["facebook", ["facebook.com", "fb.watch"]],
  ["reddit", ["reddit.com", "redd.it"]],
  ["linkedin", ["linkedin.com"]],
  ["github", ["github.com"]],
  ["spotify", ["spotify.com"]],
  ["threads", ["threads.net", "threads.com"]],
];

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** First http(s) URL in a piece of shared text, without trailing punctuation. */
export function extractUrl(text: string | null | undefined): string | null {
  const m = text?.match(URL_RE);
  return m ? m[0].replace(/[.,;:!?)\]]+$/, "") : null;
}

export function platformFor(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [name, domains] of PLATFORMS) {
    if (domains.some((d) => host === d || host.endsWith("." + d))) return name;
  }
  return "web";
}

export function kindFor(opts: { mime?: string | null; url?: string | null; hasFile: boolean }): Kind {
  const mime = opts.mime?.toLowerCase() ?? "";
  if (opts.hasFile) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    return "file";
  }
  return opts.url ? "link" : "text";
}

/** Strips tracking parameters so the same reel shared twice looks the same. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|igsh|igshid|si$|_r$|_t$|is_from_webapp|sender_device|fbclid|share_)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
