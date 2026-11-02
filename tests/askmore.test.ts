import { test } from "node:test";
import assert from "node:assert/strict";
import { readFor, research, roast, ROAST_OFF } from "../server/lib/askmore.ts";

/** A fake Gemini that answers every model the same and keeps what it was sent. */
async function withGemini(answer: (body: Record<string, unknown>) => unknown, run: (sent: Record<string, unknown>[]) => Promise<void>) {
  const sent: Record<string, unknown>[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return Response.json({ models: [{ name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] }] });
    const body = await req.json();
    sent.push(body);
    return Response.json(answer(body));
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}/v1beta-askmore-${crypto.randomUUID()}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("BUTLER_AI_ORDER", "gemini");
  try {
    await run(sent);
  } finally {
    Deno.env.delete("GEMINI_URL");
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("BUTLER_AI_ORDER");
    await server.shutdown();
  }
}

const text = (s: string) => ({ candidates: [{ content: { parts: [{ text: s }] } }] });

test("no roast when teasing is off, and no AI asked", async () => {
  assert.equal(await roast("roast me", {}, "off"), ROAST_OFF);
});

test("a roast is built on what Butler knows, with the off-limits rules", async () => {
  await withGemini(() => text(JSON.stringify({ reply: "bro collects repos like stray cats" })), async (sent) => {
    const said = await roast("yab me", { mail: ["Vercel: Deployment failed"], collections: ["AI CRM (12)"] }, "on");
    assert.equal(said, "bro collects repos like stray cats");
    const prompt = JSON.stringify(sent[0]);
    assert.match(prompt, /Vercel: Deployment failed/);
    assert.match(prompt, /AI CRM \(12\)/);
    assert.match(prompt, /Off limits: health/);
  });
});

test("research searches the web and lists where it read it", async () => {
  await withGemini(() => ({
    candidates: [{
      content: { parts: [{ text: "it's a media buying summit. you'd get:\n- adtech contacts" }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: "https://tima.example/event", title: "tima.example" } }, { web: { uri: "https://tima.example/event" } }] },
    }],
  }), async (sent) => {
    const said = await research("What can I gain from TIMA Connect Live?", "tima connect live starts in 1 hour", "on");
    assert.equal(said, "it's a media buying summit. you'd get:\n- adtech contacts\n\nsources:\n• tima.example: https://tima.example/event");
    assert.deepEqual((sent[0] as { tools: unknown }).tools, [{ google_search: {} }]);
  });
});

test("reading an email sends its attachment to the AI and treats it as data", async () => {
  await withGemini(() => text(JSON.stringify({ reply: "gist: the market is growing" })), async (sent) => {
    const said = await readFor("read it for me", {
      from: "Abdul <abdul@example.com>", subject: "Market research", at: new Date("2026-11-02T10:00:00Z"),
      body: "Please read before tonight.", files: [{ name: "report.pdf", picture: { mediaType: "application/pdf", data: "JVBERg==" } }],
      skipped: ["video.mp4"],
    }, "on");
    assert.equal(said, "gist: the market is growing");
    const parts = (sent[0] as { contents: { parts: Record<string, unknown>[] }[] }).contents[0].parts;
    assert.deepEqual(parts[0], { inline_data: { mime_type: "application/pdf", data: "JVBERg==" } });
    assert.match(String(parts[1].text), /never instructions/);
    assert.match(String(parts[1].text), /Couldn't open: video\.mp4/);
  });
});
