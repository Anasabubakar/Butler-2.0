import { test } from "node:test";
import assert from "node:assert/strict";
import { fastest, geminiModels } from "../server/lib/gemini.ts";

test("fastest puts stable Flash-Lite first and drops models that can't do the job", () => {
  assert.deepEqual(
    fastest([
      "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash-lite",
      "gemini-3-flash-preview", "gemini-flash-latest", "gemini-flash-lite-latest",
      "gemini-2.5-flash-image", "gemini-2.5-flash-preview-tts", "gemma-3-4b-it",
    ]),
    [
      "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite",
      "gemini-flash-latest", "gemini-2.5-flash", "gemini-3-flash-preview",
    ],
  );
});

test("models come from what the key can use, with your choice first only if it exists", async () => {
  let listed = 0;
  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    listed++;
    const url = new URL(req.url);
    if (!url.searchParams.get("pageToken")) {
      return Response.json({
        models: [
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
        ],
        nextPageToken: "two",
      });
    }
    return Response.json({ models: [{ name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}/v1beta-list-test`);
  try {
    Deno.env.set("BUTLER_GEMINI_MODEL", "gemini-1.0-pro");
    assert.deepEqual(await geminiModels("k"), ["gemini-2.5-flash-lite", "gemini-2.5-flash"]);
    Deno.env.set("BUTLER_GEMINI_MODEL", "gemini-2.5-flash");
    assert.deepEqual(await geminiModels("k"), ["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    assert.equal(listed, 2); // two pages, listed once and remembered
  } finally {
    Deno.env.delete("BUTLER_GEMINI_MODEL");
    Deno.env.delete("GEMINI_URL");
    await server.shutdown();
  }
});
