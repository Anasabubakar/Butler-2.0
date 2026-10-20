import { test } from "node:test";
import assert from "node:assert/strict";
import { videoLink, watch } from "../server/lib/video.ts";

test("only single YouTube videos count, in one standard form", () => {
  const id = "dQw4w9WgXcQ";
  const want = `https://www.youtube.com/watch?v=${id}`;
  assert.equal(videoLink(`https://www.youtube.com/watch?v=${id}&t=42s`), want);
  assert.equal(videoLink(`https://youtu.be/${id}?si=abc`), want);
  assert.equal(videoLink(`https://m.youtube.com/shorts/${id}`), want);
  assert.equal(videoLink("https://www.youtube.com/@somechannel"), null);
  assert.equal(videoLink("https://www.youtube.com/"), null);
  assert.equal(videoLink("https://www.tiktok.com/@a/video/1"), null);
  assert.equal(videoLink("not a link"), null);
  assert.equal(videoLink(null), null);
});

test("Gemini gets the video link and its answer becomes a bulleted note", async () => {
  const sent: { parts: Record<string, unknown>[]; config: Record<string, unknown> }[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return new Response(null, { status: 404 });
    const body = await req.json();
    sent.push({ parts: body.contents[0].parts, config: body.generationConfig });
    const answer = { summary: "How to make smoky jollof.", points: ["Fry the tomato paste well", "Cook on low heat"] };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const note = await watch("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Party jollof");
    assert.equal(note, "How to make smoky jollof.\n• Fry the tomato paste well\n• Cook on low heat");
    assert.deepEqual(sent[0].parts[0], { file_data: { file_uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    assert.match(String((sent[0].parts[1] as { text: string }).text), /Party jollof/);
    assert.equal(sent[0].config.mediaResolution, "MEDIA_RESOLUTION_LOW");
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});
