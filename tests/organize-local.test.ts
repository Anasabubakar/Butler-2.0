import { test } from "node:test";
import assert from "node:assert/strict";
import { organize, tidyCategory } from "../server/lib/organize.ts";

test("local model: pulls once, sends the image, queues requests and tidies the answer", async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let active = 0, maxActive = 0;
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const path = new URL(req.url).pathname;
    calls.push({ path, body: await req.json() });
    if (path === "/api/pull") return Response.json({ status: "success" });
    active++, maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    const answer = { title: "Jollof rice", summary: "A recipe.", tags: ["Food", "food", " Rice "], category: "food" };
    return Response.json({ message: { content: JSON.stringify(answer) } });
  });
  Deno.env.set("BUTLER_AI", "local");
  Deno.env.set("OLLAMA_URL", `http://localhost:${server.addr.port}`);
  try {
    const item = { kind: "image", platform: null, url: null, body: null, note: "make this weekend" };
    const [a] = await Promise.all([
      organize({ ...item, image: { data: "aGk=", mediaType: "image/png" } }),
      organize(item),
    ]);
    assert.deepEqual(a, { title: "Jollof rice", summary: "A recipe.", tags: ["food", "rice"], category: "Food" });
    assert.deepEqual(calls.filter((c) => c.path === "/api/pull").length, 1);
    assert.deepEqual(maxActive, 1);
    const chat = calls.find((c) => c.path === "/api/chat")!.body as { messages: { images?: string[] }[]; format: unknown };
    assert.deepEqual(chat.messages[0].images, ["aGk="]);
    assert.deepEqual(typeof chat.format, "object");
  } finally {
    Deno.env.delete("BUTLER_AI");
    await server.shutdown();
  }
});

test("local model: a model that can't see gets the words without the image", async () => {
  const sent: { images?: string[] }[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const body = await req.json();
    if (new URL(req.url).pathname === "/api/pull") return Response.json({ status: "success" });
    sent.push(body.messages[0]);
    if (body.messages[0].images) return Response.json({ error: "this model does not support images" }, { status: 500 });
    const answer = { title: "A TikTok post", summary: "A saved post.", tags: ["tiktok"], category: "other" };
    return Response.json({ message: { content: JSON.stringify(answer) } });
  });
  Deno.env.set("BUTLER_AI", "local");
  Deno.env.set("OLLAMA_URL", `http://localhost:${server.addr.port}`);
  try {
    const out = await organize({
      kind: "image", platform: "tiktok", url: "https://www.tiktok.com/@a/video/1", body: null, note: null,
      image: { data: "aGk=", mediaType: "image/png" },
    });
    assert.deepEqual(out.title, "A TikTok post");
    assert.deepEqual(sent.map((m) => Boolean(m.images)), [true, false]);
  } finally {
    Deno.env.delete("BUTLER_AI");
    await server.shutdown();
  }
});

test("local mode: screenshots go to Gemini when there's a key", async () => {
  let gemini = 0;
  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    if (req.method === "POST") gemini++; // not the model list
    const out = { title: "A reel", summary: "A saved reel.", tags: ["Reel"], category: "funny" };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
  });
  Deno.env.set("BUTLER_AI", "local");
  Deno.env.set("OLLAMA_URL", "http://localhost:1"); // would fail if used
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const out = await organize({
      kind: "image", platform: "instagram", url: null, body: null, note: null,
      image: { data: "aGk=", mediaType: "image/jpeg" },
    });
    assert.deepEqual(out, { title: "A reel", summary: "A saved reel.", tags: ["reel"], category: "Funny" });
    assert.equal(gemini, 1);
  } finally {
    Deno.env.delete("BUTLER_AI");
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("collections keep one spelling and never come back empty", () => {
  assert.equal(tidyCategory("ai crm", ["AI CRM", "Nigerian Recipes"]), "AI CRM");
  assert.equal(tidyCategory(' "Strength  Training". '), "Strength Training");
  assert.equal(tidyCategory("salary negotiation"), "Salary Negotiation");
  assert.equal(tidyCategory("React UI"), "React UI");
  assert.equal(tidyCategory("  "), "Other");
});

test("the model is told to name the real topic, reuse collections and use what the page says", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (new URL(req.url).pathname === "/api/pull") return Response.json({ status: "success" });
    prompt = (await req.json()).messages[0].content;
    const answer = { title: "Twenty", summary: "An AI CRM.", tags: ["ai", "crm"], category: "ai crm" };
    return Response.json({ message: { content: JSON.stringify(answer) } });
  });
  Deno.env.set("BUTLER_AI", "local");
  Deno.env.set("OLLAMA_URL", `http://localhost:${server.addr.port}`);
  try {
    const out = await organize({
      kind: "link", platform: "github", url: "https://github.com/twentyhq/twenty", body: null, note: null,
      pageText: "README: A CRM where AI agents do the busywork.", collections: ["AI CRM", "Nigerian Recipes"],
    });
    assert.equal(out.category, "AI CRM");
    assert.match(prompt, /README: A CRM where AI agents/);
    assert.match(prompt, /"AI CRM", "Nigerian Recipes"/);
    assert.match(prompt, /Never name the platform/);
  } finally {
    Deno.env.delete("BUTLER_AI");
    await server.shutdown();
  }
});
