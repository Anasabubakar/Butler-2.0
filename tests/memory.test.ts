import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFact, findSaid, historyText, lastWord, memoryText, type Memory, pushedText, shownText, type Turn } from "../server/lib/memory.ts";

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

test("Butler's own notes and every reminder join the conversation, not notes between your devices", () => {
  assert.equal(pushedText({ kind: "note", from_device: "Butler", body: " Morning check: 3 emails need a reply. Follow up? " }),
    "Morning check: 3 emails need a reply. Follow up?");
  assert.equal(pushedText({ kind: "reminder", from_device: "phone", body: "call Mum" }), "Reminder: call Mum");
  assert.equal(pushedText({ kind: "reminder", from_device: "Butler focus", body: "Focus time's up" }), "Reminder: Focus time's up");
  assert.equal(pushedText({ kind: "note", from_device: "phone", body: "buy bread" }), null);
  assert.equal(pushedText({ kind: "clip", from_device: "Butler", body: "copied" }), null);
  assert.equal(pushedText({ kind: "note", from_device: "Butler", body: "  " }), null);
  assert.equal(pushedText({ kind: "note", from_device: "Butler", body: null }), null);
});

const turn = (role: Turn["role"], text: string, at = "2026-10-30T09:00:00Z"): Turn => ({ id: at + text, created_at: at, role, device: null, text });

test("a reply finds the message it answers, whatever heading the device showed", () => {
  const turns = [
    turn("butler", "Morning check: 3 emails need a reply. Want me to follow up on them?"),
    turn("owner", "what's my day?"),
    turn("butler", "Reminder: call Mum"),
    turn("butler", "nothing on your calendar today."),
  ];
  assert.equal(findSaid(turns, "A note from Butler: Morning check: 3 emails need a reply. Want me to follow up on them?"), turns[0]);
  assert.equal(findSaid(turns, "A note: Morning check: 3 emails need a reply.   Want me to follow up\non them?"), turns[0]);
  assert.equal(findSaid(turns, "Reminder: call Mum"), turns[2]);
  assert.equal(findSaid(turns, "Nothing on your calendar today."), turns[3]);
  assert.equal(findSaid(turns, "Morning check: 3 emails need a reply. Want me"), turns[0]); // cut short by the device
  assert.equal(findSaid(turns, "call Mum"), null); // the reminder's heading is part of what was said
  assert.equal(findSaid(turns, "what's my day?"), null); // only Butler's words
  assert.equal(findSaid(turns, "Price drop: shoes are now ₦20,000"), null); // an old note: not in the conversation
  assert.equal(findSaid(turns, "A note from Butler: "), null);
  assert.equal(shownText("A note from Butler: Morning check: hi"), "Morning check: hi");
  assert.equal(shownText("On your clipboard from phone: hello"), "hello");
  assert.equal(shownText("Reminder: call Mum"), "Reminder: call Mum");
});

test("the latest of two identical messages is the one being answered", () => {
  const turns = [turn("butler", "Focus time's up.", "2026-10-30T08:00:00Z"), turn("owner", "ok"), turn("butler", "Focus time's up.", "2026-10-30T09:00:00Z")];
  assert.equal(findSaid(turns, "Focus time's up."), turns[2]);
});

test("a short reply answers Butler's last word only if nothing came after it and it's recent", () => {
  const now = new Date("2026-10-30T10:00:00Z");
  const asked = turn("butler", "Want me to follow up on those emails?", "2026-10-30T09:30:00Z");
  assert.equal(lastWord([turn("owner", "brief me", "2026-10-30T09:29:00Z"), asked], now), asked);
  assert.equal(lastWord([asked, turn("owner", "nah", "2026-10-30T09:31:00Z")], now), null);
  assert.equal(lastWord([turn("butler", "old news", "2026-10-29T08:00:00Z")], now), null);
  assert.equal(lastWord([], now), null);
});
