// Locks away secrets Butler keeps in the database, like the keys and links for your MCP
// connections. They're encrypted with AES-GCM, using BUTLER_VAULT_KEY, or a key made from
// SESSION_SECRET when that isn't set. Change either and the stored secrets can't be read.
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";

const PREFIX = "v1:";
const keys = new Map<string, CryptoKey>();

/** The secret the vault key is made from, or null when the server has neither. */
const source = () => Deno.env.get("BUTLER_VAULT_KEY") || Deno.env.get("SESSION_SECRET") || null;

/** Whether secrets can be locked away at all. */
export const vaultReady = () => source() !== null;

async function key(): Promise<CryptoKey> {
  const secret = source();
  if (!secret) throw new Error("set BUTLER_VAULT_KEY (or SESSION_SECRET) on the server first");
  const known = keys.get(secret);
  if (known) return known;
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  const made = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("butler vault v1") },
    raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  keys.set(secret, made);
  return made;
}

/** `text`, encrypted, as a string safe to store. */
export async function lock(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return PREFIX + encodeBase64(out);
}

/** The text `lock` was given. Throws if it was locked with another key or changed since. */
export async function unlock(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) throw new Error("not a locked secret");
  const bytes = decodeBase64(stored.slice(PREFIX.length));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await key(), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
