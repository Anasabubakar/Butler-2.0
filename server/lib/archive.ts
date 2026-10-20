// Dead-link rescue: each saved page is copied to the Internet Archive's Wayback Machine,
// and old links are checked now and then. When the original disappears, the copy is still there.

const wayback = () => Deno.env.get("WAYBACK_URL") ?? "https://web.archive.org";

/** Feeds and profiles change all the time, and the Archive can't copy most social posts. */
const SKIP = /^https?:\/\/([^/]+\.)?(tiktok|instagram|facebook|x|twitter|threads|snapchat)\.(com|net)\//i;

export const worthArchiving = (url: string) => /^https?:\/\//i.test(url) && !SKIP.test(url);

/**
 * Asks the Archive to copy `url` and returns a link to the copy, "busy" (try later) or
 * "failed" (it can't copy this page). The /web/2/ form always opens the newest copy.
 */
export async function archive(url: string): Promise<string | "busy" | "failed"> {
  const res = await fetch(`${wayback()}/save/${url}`, {
    headers: { "user-agent": "Butler (personal library; saves pages its owner bookmarked)" },
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);
  if (!res) return "busy";
  await res.body?.cancel();
  // A fresh copy answers 200 or redirects to it.
  if (res.status === 200 || (res.status >= 300 && res.status < 400)) return `${wayback()}/web/2/${url}`;
  return res.status === 429 || res.status === 503 ? "busy" : "failed";
}

/** "dead" only when the site clearly says the page is gone; network trouble isn't proof. */
export async function check(url: string): Promise<"alive" | "dead" | "unknown"> {
  for (const method of ["HEAD", "GET"]) {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; Butler link check)" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    await res?.body?.cancel();
    if (!res) return "unknown";
    if (res.ok) return "alive";
    const gone = res.status === 404 || res.status === 410;
    if (method === "GET") return gone ? "dead" : "unknown";
    if (!gone && res.status !== 405 && res.status !== 403) return "unknown";
    // Some sites refuse or fumble HEAD, so a GET has the final say.
  }
  return "unknown";
}
