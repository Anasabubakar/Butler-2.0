import { test } from "node:test";
import assert from "node:assert/strict";
import { shorten, token } from "../server/lib/links.ts";

test("short link tokens are long, random and easy to read", () => {
  const a = token();
  assert.match(a, /^[A-Za-z0-9]{10}$/);
  assert.doesNotMatch(a, /[0O1lI]/);
  assert.notEqual(a, token());
});

test("without an https address of its own, Butler leaves links as they are", async () => {
  const before = Deno.env.get("PUBLIC_URL");
  Deno.env.delete("PUBLIC_URL");
  try {
    const long = `https://example.com/${"x".repeat(80)}`;
    assert.equal(await shorten(long), long);
    Deno.env.set("PUBLIC_URL", "https://butler.example.com");
    assert.equal(await shorten("https://example.com/short"), "https://example.com/short");
    assert.equal(await shorten(`http://example.com/${"x".repeat(80)}`), `http://example.com/${"x".repeat(80)}`);
  } finally {
    if (before === undefined) Deno.env.delete("PUBLIC_URL");
    else Deno.env.set("PUBLIC_URL", before);
  }
});
