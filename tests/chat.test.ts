import { test } from "node:test";
import assert from "node:assert/strict";
import { alternate, chatGemini, forTalking } from "../server/lib/gemini.ts";
import { talkSystem, talkTurns } from "../server/lib/chat.ts";

test("talking uses full Flash before Flash-Lite", () => {
  assert.deepEqual(
    forTalking(["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"]),
    ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"],
  );
});

test("the conversation alternates, starts with the owner, and has no empty turns", () => {
  assert.deepEqual(alternate([
    { role: "model", text: "Reminder: call Mum" },
    { role: "user", text: "ok" },
    { role: "user", text: "  " },
    { role: "user", text: "and Dad too" },
    { role: "model", text: "got you" },
  ]), [
    { role: "user", text: "(earlier)" },
    { role: "model", text: "Reminder: call Mum" },
    { role: "user", text: "ok\n\nand Dad too" },
    { role: "model", text: "got you" },
  ]);
});

test("chat sends every turn with the persona as the system prompt, and falls back to a backup", async () => {
  let gemini: { contents: { role: string; parts: { text?: string }[] }[]; systemInstruction: { parts: { text: string }[] } } | null = null;
  let backup: { messages: { role: string; content: unknown }[] } | null = null;
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/models")) return Response.json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
    if (url.pathname.endsWith("/chat/completions")) {
      backup = await req.json();
      return Response.json({ choices: [{ message: { content: "from the backup" } }] });
    }
    gemini = await req.json();
    if (req.headers.get("x-goog-api-key") === "spent") return new Response("quota", { status: 429 });
    return Response.json({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Aisha's birthday is Friday." }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}/v1beta-chat-test`);
  Deno.env.set("OPENROUTER_URL", `http://localhost:${server.addr.port}/or`);
  try {
    Deno.env.set("GEMINI_API_KEY", "good");
    const turns = [
      { role: "user" as const, text: "my sister's birthday is friday" },
      { role: "model" as const, text: "noted" },
      { role: "user" as const, text: "when is it again?" },
    ];
    assert.equal(await chatGemini(turns, [], { system: "be Butler" }), "Aisha's birthday is Friday.");
    assert.deepEqual(gemini!.contents.map((c) => c.role), ["user", "model", "user"]);
    assert.equal(gemini!.contents[2].parts.at(-1)?.text, "when is it again?");
    assert.equal(gemini!.systemInstruction.parts[0].text, "be Butler");

    Deno.env.set("GEMINI_API_KEY", "spent");
    Deno.env.set("OPENROUTER_API_KEY", "or-key");
    assert.equal(await chatGemini(turns, [], { system: "be Butler" }), "from the backup");
    assert.deepEqual(backup!.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  } finally {
    for (const k of ["GEMINI_URL", "OPENROUTER_URL", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]) Deno.env.delete(k);
    await server.shutdown();
  }
});

const turn = (role: "owner" | "butler" | "break", text: string, at: string) => ({ id: "1", created_at: at, role, device: null, text });

test("the conversation ends with what they just said and points out long gaps", () => {
  const turns = [
    turn("owner", "old chat", "2026-11-04T08:00:00Z"),
    turn("break", "", "2026-11-04T08:01:00Z"),
    turn("owner", "who won the match?", "2026-11-05T09:00:00Z"),
    turn("butler", "Arsenal, 2-1.", "2026-11-05T09:00:05Z"),
  ];
  const out = talkTurns(turns, "who scored?", "UTC", new Date("2026-11-05T09:01:00Z"));
  assert.deepEqual(out.map((t) => t.role), ["user", "user", "model", "user"]);
  assert.equal(out.at(-1)?.text, "who scored?");
  const later = talkTurns(turns.slice(2), "and the next game?", "UTC", new Date("2026-11-05T15:00:00Z"));
  assert.match(later.at(-1)!.text, /^\(Thu 15:00\) and the next game\?$/);
});

test("Butler's talking rules carry the persona, memories, related saves and what they replied to", () => {
  const system = talkSystem({
    said: "x", device: "phone", timeZone: "Africa/Lagos", turns: [], now: new Date("2026-11-05T09:00:00Z"),
    memories: "[1] Their sister is Aisha", saves: "[1] Jollof recipe", answering: "Want me to remind you?",
  });
  assert.match(system, /Read the whole conversation/);
  assert.match(system, /Their sister is Aisha/);
  assert.match(system, /Jollof recipe/);
  assert.match(system, /Want me to remind you\?/);
  assert.match(system, /Thursday 5 November 2026 at 10:00/);
});
