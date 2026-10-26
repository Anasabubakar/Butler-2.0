import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFact, historyText, memoryText, type Memory, type Turn } from "../server/lib/memory.ts";

test("facts are tidied, and secrets are never kept", () => {
  assert.equal(cleanFact("  - Their sister   is Aisha "), "Their sister is Aisha");
  assert.equal(cleanFact("ok"), null);
  assert.equal(cleanFact(42), null);
  assert.equal(cleanFact("x".repeat(301)), null);
  assert.equal(cleanFact("Their bank password is hunter2"), null);
  assert.equal(cleanFact("Their PIN is 4821"), null);
  assert.equal(cleanFact("Card 4111 1111 1111 1111 is theirs"), null);
  assert.equal(cleanFact("Prefers meetings after 10am"), "Prefers meetings after 10am");
});

test("memories are numbered newest first and stop at the prompt's budget", () => {
  const m = (text: string): Memory => ({ id: text, created_at: "", text, source: "learned" });
  assert.equal(memoryText([m("Lives in Abuja"), m("Likes jollof")]), "[1] Lives in Abuja\n[2] Likes jollof");
  const many = Array.from({ length: 100 }, (_, i) => m(`fact ${i} ${"x".repeat(100)}`));
  const text = memoryText(many);
  assert.ok(text.length <= 6000);
  assert.match(text, /^\[1\] fact 0 /);
});

test("the conversation reads oldest first with times, skipping breaks", () => {
  const t = (role: Turn["role"], text: string, at: string): Turn => ({ id: at, created_at: at, role, device: null, text });
  const text = historyText([
    t("owner", "remind me to call Mum", "2026-10-26T09:00:00Z"),
    t("butler", "got you, 3pm.", "2026-10-26T09:00:05Z"),
    t("break", "", "2026-10-26T09:01:00Z"),
  ], "Africa/Lagos");
  assert.equal(text, "[Mon 10:00] owner: remind me to call Mum\n[Mon 10:00] you: got you, 3pm.");
});
