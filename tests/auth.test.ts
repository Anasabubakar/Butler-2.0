import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, newSession, Throttle, validSession, verifyPassword } from "../server/lib/auth.ts";

test("password hashes verify only the right password", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.match(stored, /^pbkdf2\$600000\$/);
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterY", stored), false);
  assert.equal(await verifyPassword("anything", "garbage"), false);
});

test("sessions expire and can't be forged", async () => {
  const now = Date.now();
  const cookie = await newSession("secret", now);
  assert.equal(await validSession(cookie, "secret", now), true);
  assert.equal(await validSession(cookie, "other-secret", now), false);
  assert.equal(await validSession(cookie, "secret", now + 31 * 86_400_000), false);
  const [, sig] = cookie.split(".");
  assert.equal(await validSession(`${now + 999 * 86_400_000}.${sig}`, "secret", now), false);
  assert.equal(await validSession(undefined, "secret"), false);
});

test("throttle allows a few tries per window", () => {
  const t = new Throttle(2, 1000);
  assert.equal(t.allow("ip", 0), true);
  assert.equal(t.allow("ip", 10), true);
  assert.equal(t.allow("ip", 20), false);
  assert.equal(t.allow("other", 20), true);
  assert.equal(t.allow("ip", 1500), true);
});
