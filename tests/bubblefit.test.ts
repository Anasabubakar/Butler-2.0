import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED_LINES, LONGEST, lineCount, preview, whole } from "../desktop/gnome/butler-pet@anasmasama.dev/fit.js";

test("a short answer is shown whole, with no Show more", () => {
  assert.deepEqual(preview("done. saved it to your library."), { text: "done. saved it to your library.", cut: false });
  assert.deepEqual(preview("  hi  "), { text: "hi", cut: false });
});

test("a few sentences that fit in the closed lines are never cut to the first words", () => {
  const answer = "Your 3pm with Tolu moved to 4pm. I updated the calendar and set a reminder for 3:45.";
  assert.equal(preview(answer).cut, false);
  assert.equal(preview(answer).text, answer);
});

test("a long answer shows its start, ends in … on a word, and offers Show more", () => {
  const answer = "word ".repeat(200).trim();
  const { text, cut } = preview(answer);
  assert.equal(cut, true);
  assert.ok(text.endsWith("…"));
  assert.ok(!text.endsWith(" …"));
  assert.ok(lineCount(text) <= CLOSED_LINES);
  assert.ok(text.length > 100, "shows a real chunk, not two or three words");
  assert.ok(answer.startsWith(text.slice(0, -1)));
});

test("many short lines are cut by line count, not just length", () => {
  const list = Array.from({ length: 12 }, (_, i) => `${i + 1}. item`).join("\n");
  const { text, cut } = preview(list);
  assert.equal(cut, true);
  assert.equal(text.split("\n").length, CLOSED_LINES);
  assert.ok(text.startsWith("1. item\n2. item"));
});

test("a single long word with no spaces still gets cut and marked", () => {
  const url = "https://example.com/" + "a".repeat(600);
  const { text, cut } = preview(url);
  assert.equal(cut, true);
  assert.ok(text.length < url.length);
});

test("the open bubble holds the whole answer, up to a very long limit", () => {
  const answer = "line of the answer\n".repeat(300).trim();
  assert.equal(whole(answer), answer);
  const huge = "x ".repeat(LONGEST);
  assert.ok(whole(huge).length <= LONGEST + 1);
  assert.ok(whole(huge).endsWith("…"));
});

test("empty or missing text doesn't break the bubble", () => {
  assert.deepEqual(preview(""), { text: "", cut: false });
  assert.deepEqual(preview(undefined), { text: "", cut: false });
  assert.equal(whole(null), "");
});
