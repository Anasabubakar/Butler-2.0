import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addClip,
  KEEP_MAX,
  ordered,
  preview,
  prune,
  search,
  when,
} from "../desktop/gnome/butler-pet@anasmasama.dev/cliplist.js";

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 22, 15, 30).getTime(); // Thu 22 Oct 2026, 15:30 local

test("a new copy goes on top, and copying it again moves it up instead of listing it twice", () => {
  let { list } = addClip([], { id: "a", kind: "text", text: "hello" }, NOW - 3000);
  ({ list } = addClip(list, { id: "b", kind: "text", text: "world" }, NOW - 2000));
  assert.deepEqual(ids(list), ["b", "a"]);
  ({ list } = addClip(list, { id: "c", kind: "text", text: "hello" }, NOW));
  assert.deepEqual(ids(list), ["a", "b"]);
  assert.equal(list[0].at, NOW);
});

test("the same picture twice keeps the first file and drops the new one", () => {
  let { list } = addClip([], { id: "a", kind: "image", hash: "x1", file: "a.png" }, NOW - 1000);
  const again = addClip(list, { id: "b", kind: "image", hash: "x1", file: "b.png" }, NOW);
  assert.equal(again.list.length, 1);
  assert.equal(again.list[0].file, "a.png");
  assert.deepEqual(again.removed.map((c: { file?: string }) => c.file), ["b.png"]);
});

test("a pin survives copying the same thing again", () => {
  const list = [{ id: "a", kind: "text", text: "pin me", at: NOW - DAY, pinned: true }];
  const after = addClip(list, { id: "b", kind: "text", text: "pin me" }, NOW).list;
  assert.equal(after[0].pinned, true);
});

test("old and extra copies are forgotten, pinned ones never", () => {
  const list = [
    { id: "old", kind: "text", text: "old", at: NOW - 31 * DAY, pinned: false },
    { id: "pinned-old", kind: "text", text: "keep", at: NOW - 400 * DAY, pinned: true },
    { id: "new", kind: "text", text: "new", at: NOW - DAY, pinned: false },
  ];
  const { list: kept, removed } = prune(list, NOW);
  assert.deepEqual(ids(kept).sort(), ["new", "pinned-old"]);
  assert.deepEqual(ids(removed), ["old"]);

  const many = Array.from({ length: KEEP_MAX + 5 }, (_, i) => ({ id: `${i}`, kind: "text", text: `${i}`, at: NOW - i, pinned: false }));
  const pruned = prune(many, NOW);
  assert.equal(pruned.list.length, KEEP_MAX);
  assert.equal(pruned.removed.length, 5);
  assert.equal(pruned.removed[0].id, `${KEEP_MAX}`); // the oldest go
});

test("pinned copies list first, then newest", () => {
  const list = [
    { id: "a", at: 1, pinned: false },
    { id: "b", at: 3, pinned: false },
    { id: "c", at: 2, pinned: true },
  ];
  assert.deepEqual(ids(ordered(list)), ["c", "b", "a"]);
});

test("search finds text by every word, and pictures by 'image' or 'screenshot'", () => {
  const list = [
    { id: "a", kind: "text", text: "Meeting at 3pm with David" },
    { id: "b", kind: "text", text: "david@example.com", from: "phone" },
    { id: "c", kind: "image", hash: "x" },
  ];
  assert.deepEqual(ids(search(list, "david")), ["a", "b"]);
  assert.deepEqual(ids(search(list, "DAVID meeting")), ["a"]);
  assert.deepEqual(ids(search(list, "screenshot")), ["c"]);
  assert.deepEqual(ids(search(list, "phone")), ["b"]);
  assert.equal(search(list, "  ").length, 3);
});

test("a row shows the first lines of a copy, cut short", () => {
  assert.equal(preview("one\n\n two\nthree\nfour"), "one\n two\nthree");
  assert.equal(preview("x".repeat(400)).length, 301);
  assert.equal(preview("   "), "(spaces only)");
});

test("times read like a person would say them", () => {
  assert.equal(when(NOW - 10_000, NOW), "just now");
  assert.equal(when(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.equal(when(new Date(2026, 9, 22, 9, 5).getTime(), NOW), "09:05");
  assert.equal(when(new Date(2026, 9, 21, 23, 59).getTime(), NOW), "Yesterday 23:59");
  assert.equal(when(new Date(2026, 9, 19, 8, 0).getTime(), NOW), "Mon 19 Oct");
  assert.equal(when(new Date(2025, 11, 31, 8, 0).getTime(), NOW), "Wed 31 Dec 2025");
});
