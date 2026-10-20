import { test } from "node:test";
import assert from "node:assert/strict";
import { compose } from "../server/lib/recap.ts";

test("the recap groups the week and lists a few worth another look", () => {
  const text = compose({
    total: 12,
    categories: [{ name: "Food", n: 5 }, { name: "Tech", n: 3 }],
    platforms: [{ name: "tiktok", n: 7 }],
    tags: ["jollof", "budget"],
    highlights: [{ title: "Smoky party jollof", link: "https://www.tiktok.com/@chef/video/1" }, { title: "A note", link: null }],
  });
  assert.equal(text, [
    "Your week in Butler: you saved 12 things.",
    "",
    "By topic: Food 5, Tech 3.",
    "From: tiktok 7.",
    "Top tags: jollof, budget.",
    "",
    "Worth another look:",
    "• Smoky party jollof",
    "  https://www.tiktok.com/@chef/video/1",
    "• A note",
  ].join("\n"));
});

test("an empty week says so", () => {
  assert.match(compose({ total: 0, categories: [], platforms: [], tags: [], highlights: [] }), /nothing saved this week/);
});
