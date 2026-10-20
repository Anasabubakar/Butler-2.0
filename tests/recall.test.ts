import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "../server/lib/db.ts";
import { describe, linkFor, recall } from "../server/lib/recall.ts";

const item = (over: Partial<Item>): Item => ({
  id: "11111111-1111-1111-1111-111111111111", created_at: "2026-10-01T09:00:00Z", device: "phone", kind: "link",
  url: null, body: null, note: null, file_path: null, mime: null, thumbnail: null, platform: null,
  title: null, summary: null, tags: [], category: null, status: "organized", error: null, ...over,
});

const jollof = item({
  title: "Smoky party jollof", summary: "A TikTok recipe for jollof rice cooked over firewood.", platform: "tiktok",
  url: "https://www.tiktok.com/@chef/video/1", tags: ["recipe", "jollof"],
});
const budget = item({
  id: "22222222-2222-2222-2222-222222222222", kind: "image", title: "Budget sheet", file_path: "a/b.png",
});

/** A fake Gemini that gives `reply` and keeps the prompt it was sent. */
function fakeGemini(reply: unknown) {
  const prompts: string[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return new Response(null, { status: 404 });
    prompts.push((await req.json()).contents[0].parts.at(-1).text);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  return {
    prompts,
    close() {
      Deno.env.delete("GEMINI_API_KEY");
      return server.shutdown();
    },
  };
}

test("items link to their page, or to the saved file on the website", () => {
  assert.equal(linkFor(jollof, undefined), "https://www.tiktok.com/@chef/video/1");
  assert.equal(linkFor(budget, "https://butler.example.com/"), `https://butler.example.com/files/${budget.id}`);
  assert.equal(linkFor(budget, undefined), null);
});

test("the model sees each item numbered, with when and where it was saved", () => {
  const text = describe(jollof, 2);
  assert.match(text, /^\[2\] Smoky party jollof/);
  assert.match(text, /saved 2026-10-01 from tiktok, link/);
  assert.match(text, /tags: recipe, jollof/);
});

test("an empty library search says so without asking the model", async () => {
  assert.deepEqual(await recall("that jollof video", []), { say: "I couldn't find anything like that in your library." });
});

test("the answer lists the items it used, and opens the first when asked", async () => {
  const gemini = fakeGemini({ answer: "It's the smoky party jollof from TikTok.", used: [1, 1, 9], open: true });
  try {
    const got = await recall("open that jollof video", [jollof, budget]);
    assert.equal(got.say, "It's the smoky party jollof from TikTok.\n\n• Smoky party jollof\n  https://www.tiktok.com/@chef/video/1");
    assert.equal(got.open, "https://www.tiktok.com/@chef/video/1");
    assert.match(gemini.prompts[0], /\[2\] Budget sheet/);
  } finally {
    await gemini.close();
  }
});

test("nothing opens unless they asked", async () => {
  const gemini = fakeGemini({ answer: "You saved a jollof recipe.", used: [1] });
  try {
    assert.equal((await recall("did I save a jollof recipe?", [jollof])).open, undefined);
  } finally {
    await gemini.close();
  }
});
