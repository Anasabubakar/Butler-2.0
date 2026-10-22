import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "npm:zod@4.3.6";
import { aiProviders, askGemini, fastest, geminiModels } from "../server/lib/gemini.ts";

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

const Answer = z.object({ answer: z.string() });

test("a key that's out of quota passes the question to the next key, then to a backup", async () => {
  const seen: string[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const url = new URL(req.url);
    const key = req.headers.get("x-goog-api-key") ?? req.headers.get("authorization");
    if (url.pathname.endsWith("/models")) return Response.json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
    seen.push(`${url.pathname.split("/").pop()} ${key}`);
    if (url.pathname.endsWith("/chat/completions")) {
      const body = await req.json();
      assert.equal(body.messages[1].content[1].image_url.url, "data:image/png;base64,AAAA");
      return Response.json({ choices: [{ message: { content: '```json\n{"answer":"from groq"}\n```' } }] });
    }
    if (key === "full") return new Response("quota exceeded", { status: 429 });
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"answer":"from gemini"}' }] } }] });
  });
  const at = `http://localhost:${server.addr.port}`;
  Deno.env.set("GEMINI_URL", `${at}/v1beta-fallback-test`);
  Deno.env.set("GROQ_URL", at);
  const picture = { data: "AAAA", mediaType: "image/png" };
  try {
    Deno.env.set("GEMINI_API_KEY", "full, works");
    assert.deepEqual(await askGemini("hi", picture, Answer), { answer: "from gemini" });
    assert.deepEqual(seen, ["gemini-2.5-flash:generateContent full", "gemini-2.5-flash:generateContent works"]);

    Deno.env.set("GEMINI_API_KEY", "full");
    Deno.env.set("GROQ_API_KEY", "g");
    assert.deepEqual(await askGemini("hi", picture, Answer), { answer: "from groq" });
    assert.equal(seen.at(-1), "completions Bearer g");

    // Backups can't watch videos, so the error says what each provider did.
    await assert.rejects(askGemini("hi", { uri: "https://youtu.be/x" }, Answer), /Gemini key 1: .*429.*groq: skipped/);

    Deno.env.set("BUTLER_AI_ORDER", "groq,gemini");
    assert.deepEqual(aiProviders(), ["groq", "gemini"]);
    Deno.env.delete("GEMINI_API_KEY");
    assert.deepEqual(aiProviders(), ["groq"]);
  } finally {
    for (const name of ["GEMINI_URL", "GROQ_URL", "GEMINI_API_KEY", "GROQ_API_KEY", "BUTLER_AI_ORDER"]) Deno.env.delete(name);
    await server.shutdown();
  }
});
