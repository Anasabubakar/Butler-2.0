// One owner, so: one password for the website, one token for devices,
// and a signed cookie to remember the browser.
import { decodeBase64Url, encodeBase64Url } from "jsr:@std/encoding@1.0.10/base64url";

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 600_000;
export const SESSION_COOKIE = "butler_session";
export const SESSION_DAYS = 30;

/** Constant-time string comparison. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Produces the BUTLER_PASSWORD_HASH value: pbkdf2$<iterations>$<salt>$<hash>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, new Uint8Array(decodeBase64Url(salt)), Number(iter));
  return sameSecret(encodeBase64Url(got), hash);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** Cookie value "<expiry-ms>.<signature>". */
export async function newSession(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function validSession(value: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!value || !secret) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !(Number(exp) > now)) return false;
  return sameSecret(sig, await hmac(secret, exp));
}

/** Slows down password guessing: a few tries per minute per address. */
export class Throttle {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
