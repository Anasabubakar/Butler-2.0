import { test } from "node:test";
import assert from "node:assert/strict";
import { lock, unlock } from "../server/lib/vault.ts";

test("a locked secret comes back, and doesn't show in what's stored", async () => {
  Deno.env.set("BUTLER_VAULT_KEY", "test vault key");
  const stored = await lock("sk-very-secret");
  assert.ok(stored.startsWith("v1:"));
  assert.ok(!stored.includes("sk-very-secret"));
  assert.notEqual(stored, await lock("sk-very-secret")); // a fresh nonce each time
  assert.equal(await unlock(stored), "sk-very-secret");
});

test("a secret locked with another key can't be read", async () => {
  Deno.env.set("BUTLER_VAULT_KEY", "first key");
  const stored = await lock("hello");
  Deno.env.set("BUTLER_VAULT_KEY", "second key");
  await assert.rejects(() => unlock(stored));
});

test("a changed secret can't be read", async () => {
  Deno.env.set("BUTLER_VAULT_KEY", "test vault key");
  const stored = await lock("hello");
  const flipped = stored.slice(0, -4) + (stored.at(-4) === "A" ? "B" : "A") + stored.slice(-3);
  await assert.rejects(() => unlock(flipped));
});
