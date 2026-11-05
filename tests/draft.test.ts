import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, isDraftAsk, write } from "../server/lib/draft.ts";

/** A fake Gemini that answers each request with the next reply in line. */
function fakeGemini(replies: unknown[]) {
  const calls: Record<string, any>[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return new Response(null, { status: 404 });
    calls.push(await req.json());
    const text = JSON.stringify(replies.shift());
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
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

const shot = { data: "aGk=", mediaType: "image/jpeg" };

test("asking for a reply counts only when a text box is showing", () => {
  for (const s of ["help me respond to this message", "Help me draft a response", "draft a reply", "refine this message",
    "what should I say?", "reply to this for me", "polish my message", "write a reply"]) {
    assert.ok(isDraftAsk(s, { hasBox: true, recentDraft: false }), s);
    assert.ok(!isDraftAsk(s, { hasBox: false, recentDraft: true }), `${s} without a box`);
  }
  assert.ok(!isDraftAsk("remind me at 3 to call mum", { hasBox: true, recentDraft: false }));
});

test("follow-ups count only right after a draft", () => {
  for (const s of ["shorter", "make it more casual", "say no politely", "in pidgin", "less formal abeg", "try again"]) {
    assert.ok(isDraftAsk(s, { hasBox: true, recentDraft: true }), s);
    assert.ok(!isDraftAsk(s, { hasBox: true, recentDraft: false }), `${s} with no draft`);
  }
  assert.ok(!isDraftAsk("what's the weather like in Lagos today and should I take an umbrella? ".repeat(3), { hasBox: true, recentDraft: true }));
});

test("clean drops a lead-in and wrapping quotes", () => {
  assert.equal(clean('Here\'s a draft: "sure, see you at 5"'), "sure, see you at 5");
  assert.equal(clean("“omo i no fit make am today”"), "omo i no fit make am today");
  assert.equal(clean("  fine by me  "), "fine by me");
});

test("write sends the box, the screen words and every view", async () => {
  const gemini = fakeGemini([{ status: "ready", text: '"cool, 5pm works"', note: "kept it short" }]);
  try {
    const out = await write([shot, shot], {
      instruction: "shorter", box: "Yes that is completely fine with me, 5pm works perfectly", screenText: "Tola: can we do 5?",
      previous: "Yes that is completely fine with me, 5pm works perfectly", canScroll: false,
    });
    assert.equal(out.status, "ready");
    assert.equal(out.text, "cool, 5pm works");
    const parts = gemini.calls[0].contents[0].parts;
    assert.equal(parts.filter((p: any) => p.inline_data).length, 2);
    const prompt = parts.at(-1).text;
    assert.match(prompt, /already holds:\n"""Yes that is completely fine/);
    assert.match(prompt, /Tola: can we do 5\?/);
    assert.match(prompt, /not allowed now/);
    assert.doesNotMatch(prompt, /Your last draft was/); // same as the box
  } finally {
    await gemini.close();
  }
});

test("write can ask to scroll up when allowed", async () => {
  const gemini = fakeGemini([{ status: "more", text: "" }]);
  try {
    const out = await write([shot], { instruction: "help me respond", box: "", canScroll: true });
    assert.equal(out.status, "more");
    assert.match(gemini.calls[0].contents[0].parts.at(-1).text, /The message box is empty/);
  } finally {
    await gemini.close();
  }
});
