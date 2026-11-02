import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkInitData, chunks, client, commandOf, escape, firstLink, onlyLink, pairCode, redact, TelegramError, webhookSecret,
} from "../server/lib/telegram.ts";

const TOKEN = "123456:ABC-def_secret";

/** initData signed the way Telegram signs it, for a Mini App opened by `user`. */
async function signed(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const enc = new TextEncoder();
  const hmac = async (key: Uint8Array, msg: string) => {
    const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  };
  const secret = await hmac(enc.encode("WebAppData"), token);
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const hash = [...await hmac(secret, check)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("a Mini App opened in Telegram says who opened it", async () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const data = await signed({ auth_date: String(now / 1000 - 60), query_id: "AAE", user: JSON.stringify({ id: 4242, first_name: "Anas" }) });
  assert.equal(await checkInitData(data, TOKEN, now), 4242);
});

test("forged, re-signed or stale Mini App data is refused", async () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const fields = { auth_date: String(now / 1000 - 60), user: JSON.stringify({ id: 4242 }) };
  const good = await signed(fields);
  // Someone swaps the user id but keeps the hash.
  assert.equal(await checkInitData(good.replace("4242", "999"), TOKEN, now), null);
  // Signed with another bot's token.
  assert.equal(await checkInitData(await signed(fields, "999:other"), TOKEN, now), null);
  // Two days old.
  assert.equal(await checkInitData(await signed({ ...fields, auth_date: String(now / 1000 - 2 * 86400) }), TOKEN, now), null);
  // No hash, nothing at all.
  assert.equal(await checkInitData("user=%7B%22id%22%3A1%7D&auth_date=1", TOKEN, now), null);
  assert.equal(await checkInitData("", TOKEN, now), null);
});

test("the webhook secret comes from the token, is the same each time, and fits Telegram's rules", async () => {
  const a = await webhookSecret(TOKEN);
  assert.equal(a, await webhookSecret(TOKEN));
  assert.notEqual(a, await webhookSecret("999:other"));
  assert.match(a, /^[A-Za-z0-9_-]{1,256}$/);
  assert.ok(!a.includes(TOKEN));
  assert.equal(await webhookSecret(TOKEN, "my-own-secret-1234"), "my-own-secret-1234");
  assert.equal(await webhookSecret(TOKEN, "bad secret!"), a); // not allowed by Telegram: ignored
});

test("pairing codes are 32 random hex characters, fit a /start link, and don't repeat", () => {
  const a = pairCode(), b = pairCode();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test("the bot token never shows in an error", async () => {
  assert.equal(redact(`fetch https://api.telegram.org/bot${TOKEN}/getMe failed`, TOKEN), "fetch https://api.telegram.org/bot<bot token>/getMe failed");
  const api = client(TOKEN, "https://example.invalid", () => Promise.reject(new TypeError(`error sending request for url (https://api.telegram.org/bot${TOKEN}/getMe)`)));
  await assert.rejects(api.call("getMe"), (e: Error) => {
    assert.ok(e instanceof TelegramError);
    assert.ok(!e.message.includes(TOKEN), e.message);
    return true;
  });
});

test("the client sends JSON and reads Telegram's answer and errors", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith("/sendMessage")) return Response.json({ ok: true, result: { message_id: 7 } });
    return Response.json({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 });
  }) as typeof fetch;
  const api = client(TOKEN, "https://tg.test/", fake);
  assert.deepEqual(await api.call("sendMessage", { chat_id: 1, text: "hi" }), { message_id: 7 });
  assert.equal(seen[0].url, `https://tg.test/bot${TOKEN}/sendMessage`);
  assert.deepEqual(seen[0].body, { chat_id: 1, text: "hi" });
  await assert.rejects(api.call("getChat", { chat_id: 2 }), /chat not found/);
});

test("text is escaped for Telegram and long text is split at line breaks", () => {
  assert.equal(escape("<b>Tom & Jerry</b>"), "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
  const long = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const parts = chunks(long, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join("\n"), long);
  assert.deepEqual(chunks("short"), ["short"]);
});

test("commands are read, with or without the bot's name", () => {
  assert.deepEqual(commandOf("/find jollof rice"), { name: "find", args: "jollof rice" });
  assert.deepEqual(commandOf("/Brief@ButlerVIfred_bot", "ButlerVIfred_bot"), { name: "brief", args: "" });
  assert.equal(commandOf("/brief@SomeOtherBot", "ButlerVIfred_bot"), null);
  assert.equal(commandOf("hello /find"), null);
  assert.deepEqual(commandOf("/laptop mango open\nYouTube"), { name: "laptop", args: "mango open\nYouTube" });
});

test("a message that's only a link is a save; a link inside words is not", () => {
  assert.equal(onlyLink("  https://youtu.be/abc  "), "https://youtu.be/abc");
  assert.equal(onlyLink("summarise https://youtu.be/abc"), null);
  assert.equal(firstLink("summarise https://youtu.be/abc please"), "https://youtu.be/abc");
  assert.equal(firstLink("no link here"), null);
});
