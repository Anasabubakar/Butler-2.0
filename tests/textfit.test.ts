import { test } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW, preview } from "../desktop/gnome/butler-pet@anasmasama.dev/textfit.js";

test("a short answer shows whole", () => {
  assert.equal(preview("  got you. reminder's set.  "), "got you. reminder's set.");
});

test("a long answer shows its start, cut at a word, with an ellipsis", () => {
  const long = "word ".repeat(200);
  const shown = preview(long);
  assert.ok(shown.length <= PREVIEW + 1);
  assert.ok(shown.endsWith("word…"));
});

test("one huge word is still cut, so it can't run off the bubble", () => {
  assert.equal(preview("x".repeat(500), 10), `${"x".repeat(10)}…`);
});
