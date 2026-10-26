import { test } from "node:test";
import assert from "node:assert/strict";
import { friendPart, persona, voiceRules } from "../server/lib/persona.ts";

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

test("Anas's persona is kept word for word", async () => {
  const friend = friendPart();
  assert.ok(friend.startsWith("You are a highly capable personal AI agent who speaks like a close Gen Z friend"));
  assert.ok(friend.endsWith("the extremely capable friend the user happens to text whenever they need something handled."));
  // If you change Anas's part on purpose, update this fingerprint too.
  assert.equal(await sha256(friend), "87b8c456b1fd76a7135415c9df50f41136c8225d0e654db1992095324e3ed5e0");
});

test("the AI gets both parts, without the notes for people", () => {
  const words = persona();
  assert.match(words, /^<friend>/);
  assert.match(words, /<butler>[\s\S]*Never claim something is done before it is/);
  assert.doesNotMatch(words, /<!--|notes like this one/);
});

test("the teasing setting decides how much sass is allowed", () => {
  assert.match(voiceRules(), /Teasing is on/);
  assert.match(voiceRules("less"), /Teasing is set to less/);
  assert.match(voiceRules("off"), /never tease or roast them/);
  assert.ok(voiceRules("off").startsWith(persona()));
});

test("Butler calls you boss unless BUTLER_TITLE says otherwise, and none drops the title", async () => {
  const { addressed, persona: words } = await import("../server/lib/persona.ts");
  try {
    assert.equal(addressed("morning"), "morning, boss");
    assert.match(words(), /"handled, boss\."/);
    Deno.env.set("BUTLER_TITLE", "sir");
    assert.equal(addressed("morning"), "morning, sir");
    Deno.env.set("BUTLER_TITLE", "none");
    assert.equal(addressed("morning"), "morning");
    assert.doesNotMatch(words(), /\{title\}|handled, /);
  } finally {
    Deno.env.delete("BUTLER_TITLE");
  }
});

test("the butler part doesn't assume who the owner is", () => {
  const butler = persona().split("<butler>")[1];
  assert.doesNotMatch(butler, /\bAnas\b|\bsir\b/);
  assert.match(butler, /Your owner could be anyone/);
});
