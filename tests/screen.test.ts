import { test } from "node:test";
import assert from "node:assert/strict";
import { locate, look, nextStep } from "../server/lib/screen.ts";

/** A fake Gemini that answers each request with the next reply in line. */
function fakeGemini(replies: { status: number; body: unknown }[]) {
  const calls: { model: string; body: Record<string, any> }[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    calls.push({ model: new URL(req.url).pathname.split("/").pop()!, body: await req.json() });
    const { status, body } = replies.shift()!;
    return Response.json(body, { status });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  return {
    calls,
    close() {
      Deno.env.delete("GEMINI_API_KEY");
      return server.shutdown();
    },
  };
}

const answer = (json: unknown) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] } });
const picture = { data: "aGk=", mediaType: "image/jpeg" };

test("locate sends the screenshot and keeps the spot on the grid", async () => {
  const gemini = fakeGemini([answer({ found: true, x: 1203.6, y: 455.2 })]);
  try {
    assert.deepEqual(await locate(picture, "the Share button"), { found: true, x: 1000, y: 455 });
    const parts = gemini.calls[0].body.contents[0].parts;
    assert.deepEqual(parts[0], { inline_data: { mime_type: "image/jpeg", data: "aGk=" } });
    assert.match(parts[1].text, /the Share button/);
  } finally {
    await gemini.close();
  }
});

test("a model that rejects thinking settings is asked again, then the next model", async () => {
  const gemini = fakeGemini([
    { status: 400, body: { error: { message: "thinking budget not supported" } } },
    { status: 404, body: { error: { message: "model retired" } } },
    answer({ answer: "  x = 4  " }),
  ]);
  try {
    assert.equal(await look(picture, "solve", "what is x?"), "x = 4");
    assert.deepEqual(gemini.calls.map((c) => [c.model.split(":")[0], Boolean(c.body.generationConfig.thinkingConfig)]), [
      ["gemini-flash-latest", true],
      ["gemini-flash-latest", false],
      ["gemini-2.5-flash", true],
    ]);
  } finally {
    await gemini.close();
  }
});

test("a bad key stops at once", async () => {
  const gemini = fakeGemini([{ status: 400, body: { error: { message: "API key not valid" } } }]);
  try {
    await assert.rejects(locate(picture, "Copy link"), /API key not valid/);
    assert.equal(gemini.calls.length, 1);
  } finally {
    await gemini.close();
  }
});

test("the next step keeps clicks on the grid and tells Gemini what's been done", async () => {
  const gemini = fakeGemini([answer({ do: "click", x: 1100, y: -5, say: "Clicking Search", key: "" })]);
  try {
    const step = await nextStep(picture, "search for jollof rice", ["Opened YouTube"], "phone");
    assert.equal(step.do, "click");
    assert.deepEqual([step.x, step.y], [1000, 0]);
    const prompt = gemini.calls[0].body.contents[0].parts[1].text;
    assert.match(prompt, /1\. Opened YouTube/);
    assert.match(prompt, /long_press/);
    assert.match(prompt, /send a message, email or money/);
  } finally {
    await gemini.close();
  }
});
