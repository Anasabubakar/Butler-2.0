// Telegram's Bot API, for Butler's bot: calls, file downloads, and the checks that make sure
// an update really came from Telegram and a Mini App really was opened by you.
// The bot token never appears in a log or an error: see redact().

export interface Api {
  /** Calls a Bot API method with JSON parameters and returns its result. */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Calls a method with a file in it (sendDocument, sendPhoto). */
  upload<T = unknown>(method: string, form: FormData): Promise<T>;
  /** Downloads a file you sent the bot. Telegram only hands bots files up to 20 MB. */
  download(fileId: string): Promise<{ bytes: Uint8Array; path: string }>;
}

/** The largest file Telegram lets a bot download. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** How much text fits in one Telegram message (4096), with room to spare for a heading. */
export const MAX_TEXT = 3900;

export class TelegramError extends Error {
  constructor(message: string, readonly code: number, readonly retryAfter?: number) {
    super(message);
  }
}

/** Takes the bot token out of any text that might be logged or shown. */
export function redact(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("<bot token>");
}

/** A Bot API client for `token`. `base` and `fetchFn` are for tests. */
export function client(token: string, base = "https://api.telegram.org", fetchFn: typeof fetch = fetch): Api {
  const root = base.replace(/\/$/, "");

  async function send<T>(method: string, body: BodyInit, headers: Record<string, string>, retried = false): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(`${root}/bot${token}/${method}`, { method: "POST", body, headers, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new TelegramError(redact(`couldn't reach Telegram: ${(e as Error).message ?? e}`, token), 0);
    }
    const json = await res.json().catch(() => null) as
      | { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }
      | null;
    if (json?.ok) return json.result as T;
    const retryAfter = json?.parameters?.retry_after;
    // Too many messages at once: wait as long as Telegram asks (up to half a minute) and try once more.
    if (res.status === 429 && retryAfter && retryAfter <= 30 && !retried && typeof body === "string") {
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return send(method, body, headers, true);
    }
    throw new TelegramError(redact(`${method}: ${json?.description ?? `HTTP ${res.status}`}`, token), json?.error_code ?? res.status, retryAfter);
  }

  return {
    call: <T>(method: string, params: Record<string, unknown> = {}) =>
      send<T>(method, JSON.stringify(params), { "content-type": "application/json" }),
    upload: <T>(method: string, form: FormData) => send<T>(method, form, {}),
    async download(fileId: string) {
      const file = await send<{ file_path?: string; file_size?: number }>(
        "getFile", JSON.stringify({ file_id: fileId }), { "content-type": "application/json" },
      );
      if (!file.file_path) throw new TelegramError("Telegram didn't give that file to me (it may be over 20 MB)", 400);
      let res: Response;
      try {
        res = await fetchFn(`${root}/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        throw new TelegramError(redact(`couldn't download the file: ${(e as Error).message ?? e}`, token), 0);
      }
      if (!res.ok) throw new TelegramError(`couldn't download the file (HTTP ${res.status})`, res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
    },
  };
}

// --- checks ----------------------------------------------------------------------------------

const encoder = new TextEncoder();

async function hmac(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", typeof key === "string" ? encoder.encode(key) : key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(message)));
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Two strings compared without leaking where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The secret Telegram sends with every update (X-Telegram-Bot-Api-Secret-Token), so nobody
 * else can post fake updates to the webhook. Made from the bot token, so it needs no setting;
 * TELEGRAM_WEBHOOK_SECRET overrides it.
 */
export async function webhookSecret(token: string, override?: string): Promise<string> {
  if (override && /^[A-Za-z0-9_-]{16,256}$/.test(override)) return override;
  return hex(await hmac(token, "butler telegram webhook"));
}

export const sameSecret = same;

/**
 * Checks the data a Mini App was opened with (Telegram signs it with the bot token) and
 * returns who opened it, or null if it's forged or older than `maxAge` seconds.
 */
export async function checkInitData(initData: string, token: string, now = Date.now(), maxAge = 24 * 3600): Promise<number | null> {
  if (!initData || !token || initData.length > 10_000) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac("WebAppData", token);
  if (!same(hex(await hmac(secret, check)), hash.toLowerCase())) return null;
  const at = Number(params.get("auth_date"));
  if (!Number.isFinite(at) || now / 1000 - at > maxAge || at - now / 1000 > 300) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id?: unknown } | null;
    return typeof user?.id === "number" && Number.isSafeInteger(user.id) ? user.id : null;
  } catch {
    return null;
  }
}

/** A code for the website's Connect Telegram link (t.me/bot?start=code): 32 letters and numbers. */
export function pairCode(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

// --- text --------------------------------------------------------------------------------------

/** Text made safe for Telegram's HTML formatting. */
export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Splits long text into messages that fit, at line breaks where it can. */
export function chunks(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest || !out.length) out.push(rest);
  return out;
}

/** "/find@ButlerBot jollof rice" → {name: "find", args: "jollof rice"}; null if it isn't a command for this bot. */
export function commandOf(text: string | undefined, bot?: string): { name: string; args: string } | null {
  const m = text?.match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  if (m[2] && bot && m[2].toLowerCase() !== bot.toLowerCase()) return null;
  return { name: m[1].toLowerCase(), args: (m[3] ?? "").trim() };
}

/** The link, when a message is a link and nothing else (that's a save). */
export function onlyLink(text: string | undefined): string | null {
  const t = text?.trim() ?? "";
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 4000 ? t : null;
}

/** The first link in a message, if any. */
export function firstLink(text: string | undefined): string | null {
  return text?.match(/https?:\/\/[^\s<>"]+/i)?.[0] ?? null;
}
