import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addStrike,
  badWord,
  locked,
  normalize,
  STRIKE_WINDOW,
  takeSecret,
} from "../desktop/gnome/butler-pet@anasmasama.dev/secretword.js";
import { describeTool, finishedNote, readLine } from "../desktop/gnome/butler-pet@anasmasama.dev/claudeevents.js";

const isMango = (w: string) => w === "mango";

test("the secret word works anywhere in the command, in any case, and is taken out", () => {
  assert.deepEqual(takeSecret("Mango open YouTube", isMango), { ok: true, rest: "open YouTube" });
  assert.deepEqual(takeSecret("open YouTube mango.", isMango), { ok: true, rest: "open YouTube" });
  assert.deepEqual(takeSecret("finish the MANGO, glance project", isMango), { ok: true, rest: "finish the glance project" });
  assert.deepEqual(takeSecret("open YouTube", isMango), { ok: false, rest: "open YouTube" });
  assert.deepEqual(takeSecret("mangoes are nice", isMango), { ok: false, rest: "mangoes are nice" });
});

test("a secret word needs 4 or more letters and no spaces", () => {
  assert.equal(normalize("“Mango!”"), "mango");
  assert.equal(badWord("abc"), "Use at least 4 letters or numbers.");
  assert.equal(badWord("two words"), "Use one word, without spaces.");
  assert.equal(badWord("Jollof2026"), null);
});

test("three commands without the word in 15 minutes lock remote control", () => {
  const now = 1_000_000_000;
  let strikes = addStrike([], now);
  strikes = addStrike(strikes, now + 1000);
  assert.equal(locked(strikes), false);
  assert.equal(locked(addStrike(strikes, now + 2000)), true);
  assert.equal(locked(addStrike(strikes, now + STRIKE_WINDOW + 5000)), false); // the old ones expired
});

test("Claude Code's progress becomes short status lines", () => {
  assert.equal(describeTool("Edit", { file_path: "/home/gamp/glance/glance/agent/computer_loop.py" }), "Editing computer_loop.py");
  assert.equal(describeTool("Bash", { command: "npm   test" }), "Running npm test");
  assert.equal(describeTool("Grep", {}), "Searching the code");
  const tool = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "Let me look." }, { type: "tool_use", name: "Read", input: { file_path: "/a/README.md" } }] },
  });
  assert.deepEqual(readLine(tool), { action: "Reading README.md" });
  assert.equal(readLine(JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.deepEqual(readLine("bash: claude: command not found"), { error: "bash: claude: command not found" });
});

test("the finish line reports success or failure", () => {
  const done = readLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "All tests pass.", num_turns: 12 }));
  assert.deepEqual(done, { result: { ok: true, text: "All tests pass.", turns: 12, cost: null } });
  const failed = readLine(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
  assert.equal(failed?.result?.ok, false);
  assert.equal(failed?.result?.text, "error_max_turns");
  assert.equal(finishedNote("glance", 42.4, { ok: true, text: "Done." }), "Claude Code finished in glance (42 min).\n\nDone.");
  assert.equal(finishedNote("glance", 0.2, { ok: true, text: "" }), "Claude Code finished in glance (under a minute).");
});
