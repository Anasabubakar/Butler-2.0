import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, itemText } from "../server/lib/meaning.ts";

test("closeness is 1 for the same direction and 0 for unrelated", () => {
  assert.equal(cosine([1, 2, 3], [2, 4, 6]).toFixed(6), "1.000000");
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("an item's text has its title, summary, tags and note", () => {
  const text = itemText({ title: "Jollof", summary: "A recipe", tags: ["food", "rice"], note: "try sunday", url: null, body: null });
  assert.equal(text, "Jollof\nA recipe\nfood, rice\ntry sunday");
});
