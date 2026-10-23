// Guards for links you give Butler to call, like an MCP server's address. The server
// shares its machine with your other projects, so it won't call anything private:
// localhost, the Docker network, home networks, or this machine's own public address.

/** Whether `ip` is loopback, private, link-local or otherwise not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT, Tailscale
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!v6.includes(":")) return true; // not an address we understand
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff") ||
    v6.startsWith("::ffff:") || v6.startsWith("64:ff9b:");
}

type Resolve = (host: string) => Promise<string[]>;

const resolveDns: Resolve = async (host) => {
  const found = await Promise.all([
    Deno.resolveDns(host, "A").catch(() => [] as string[]),
    Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
  ]);
  return found.flat();
};

let ownAddresses: Promise<Set<string>> | null = null;

/** This server's own public addresses, from PUBLIC_URL, so links can't loop back into it. */
function own(resolve: Resolve): Promise<Set<string>> {
  if (!ownAddresses) {
    const host = (() => {
      try {
        return new URL(Deno.env.get("PUBLIC_URL") ?? "").hostname;
      } catch {
        return "";
      }
    })();
    ownAddresses = host ? resolve(host).then((ips) => new Set(ips)) : Promise.resolve(new Set());
  }
  return ownAddresses;
}

/** Forgets the addresses learned from PUBLIC_URL (for tests). */
export const forgetOwnAddresses = () => { ownAddresses = null; };

/**
 * The link, checked: https only, no user:password@, and every address the name points at
 * is public and not this server. Throws with a plain reason otherwise.
 */
export async function checkUrl(link: string, resolve: Resolve = resolveDns): Promise<URL> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("that isn't a web address");
  }
  if (url.protocol !== "https:") throw new Error("the address has to start with https://");
  if (url.username || url.password) throw new Error("put the password in the key box, not in the address");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home)$/.test(host) || !host.includes(".") && !host.includes(":")) {
    throw new Error("Butler can only connect to public addresses");
  }
  const literal = /^[\d.]+$/.test(host) || host.includes(":");
  const ips = literal ? [host] : await resolve(host);
  if (!ips.length) throw new Error(`couldn't find ${host}`);
  const mine = await own(resolve);
  if (ips.some((ip) => isPrivateAddress(ip) || mine.has(ip))) throw new Error("Butler can only connect to public addresses");
  return url;
}

/**
 * fetch, for links you gave Butler: checks the address first, and every redirect too.
 * Redirects to another site are refused, so your key is never handed to it.
 * (A name that changes what it points at between the check and the call can still slip
 * through; the check stops the everyday mistakes and the obvious tricks.)
 */
export async function guardedFetch(input: string | URL | Request, init: RequestInit = {}, resolve: Resolve = resolveDns): Promise<Response> {
  let request = new Request(input, init);
  for (let hop = 0; hop < 4; hop++) {
    await checkUrl(request.url, resolve);
    const res = await fetch(request.clone(), { redirect: "manual" });
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) return res;
    await res.body?.cancel();
    const to = new URL(next, request.url);
    if (to.origin !== new URL(request.url).origin) throw new Error(`the server tried to send Butler to ${to.host}`);
    const keep = res.status === 307 || res.status === 308;
    request = new Request(to, keep ? request : { method: "GET", headers: request.headers });
  }
  throw new Error("too many redirects");
}
