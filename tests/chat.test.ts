import { test } from "node:test";
import assert from "node:assert/strict";
import { chatSystem, chatTurns, converse, learnFacts, tidy } from "../server/lib/chat.ts";
import { alternate, smartest, talk } from "../server/lib/gemini.ts";
import { olderText, searchWords, type Turn } from "../server/lib/memory.ts";

const t = (role: Turn["role"], text: string, at: string): Turn => ({ id: at, created_at: at, role, device: null, text });

/** A fake Gemini that keeps every request it gets and answers with `answer(body)`. */
function fakeGemini(answer: (body: Record<string, unknown>, url: string) => Response) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const url = new URL(req.url).pathname;
    if (req.method === "GET") return new Response("no list", { status: 404 }); // the built-in fallbacks are used
    const body = await req.json();
    seen.push({ url, body });
    return answer(body, url);
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", `test-key-${server.addr.port}`);
  return {
    seen,
    async [Symbol.asyncDispose]() {
      Deno.env.delete("GEMINI_API_KEY");
      await server.shutdown();
    },
  };
}
const said = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });

test("the conversation goes to the AI as real turns, ending with what they just said", () => {
  const turns = chatTurns([
    t("owner", "i'm thinking of moving to Lagos", "2026-11-05T09:00:00Z"),
    t("butler", "for work or vibes?", "2026-11-05T09:00:04Z"),
    t("break", "", "2026-11-05T09:01:00Z"),
    t("owner", "work. the job pays 2x", "2026-11-05T09:02:00Z"),
  ], "but rent is crazy there", "Africa/Lagos", new Date("2026-11-05T09:03:00Z"));
  assert.deepEqual(turns.map((x) => x.role), ["user", "model", "user", "user"]);
  assert.match(turns[0].text, /^\(Thu 5 Nov, 10:00\) i'm thinking of moving to Lagos$/);
  assert.equal(turns[1].text, "for work or vibes?"); // Butler's own turns never carry a time
  assert.equal(turns[2].text, "work. the job pays 2x"); // minutes later: no new time
  assert.equal(turns[3].text, "but rent is crazy there");
});

test("a long pause gets a time marker, and a long note is cut to its gist", () => {
  const turns = chatTurns([
    t("butler", `Morning brief: ${"x".repeat(5000)}`, "2026-11-04T06:00:00Z"),
  ], "what was in the brief?", "UTC", new Date("2026-11-05T12:00:00Z"));
  assert.ok(turns[0].text.length < 2600);
  assert.match(turns[1].text, /^\(Thu 5 Nov, 12:00\) what was in the brief\?$/);
});

test("turns take turns, and a conversation starting with Butler gets an opening", () => {
  assert.deepEqual(alternate([
    { role: "model", text: "Reminder: call Mum" },
    { role: "user", text: "done" },
    { role: "user", text: "what next" },
    { role: "model", text: "  " },
  ]), [
    { role: "user", text: "(earlier)" },
    { role: "model", text: "Reminder: call Mum" },
    { role: "user", text: "done\n\nwhat next" },
  ]);
});

test("talking picks Flash before Flash-Lite; planning still picks the fastest", () => {
  const names = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  assert.deepEqual(smartest(names).slice(0, 2), ["gemini-flash-latest", "gemini-2.5-flash"]);
});

test("a conversation reply sends the system prompt, the turns, Google Search and some thinking", async () => {
  await using gemini = fakeGemini(() => said("lowkey yes, but check rent first"));
  const reply = await talk([{ role: "user", text: "should i move?" }], { system: "be Butler", search: true });
  assert.equal(reply, "lowkey yes, but check rent first");
  const body = gemini.seen[0].body as {
    contents: { role: string }[]; systemInstruction: { parts: { text: string }[] };
    tools?: unknown[]; generationConfig: { thinkingConfig?: { thinkingBudget: number }; responseMimeType?: string };
  };
  assert.match(gemini.seen[0].url, /gemini-flash-latest:generateContent$/); // not Flash-Lite
  assert.equal(body.systemInstruction.parts[0].text, "be Butler");
  assert.deepEqual(body.contents.map((c) => c.role), ["user"]);
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.ok((body.generationConfig.thinkingConfig?.thinkingBudget ?? 0) > 0);
  assert.equal(body.generationConfig.responseMimeType, undefined); // plain text, not a JSON field
});

test("a model that refuses search is asked again without it", async () => {
  await using gemini = fakeGemini((body) =>
    body.tools ? new Response("search not allowed", { status: 400 }) : said("answered without search")
  );
  assert.equal(await talk([{ role: "user", text: "hi" }], { system: "s", search: true }), "answered without search");
  assert.equal(gemini.seen.length, 2);
});

test("thinking parts are never shown as the reply", async () => {
  await using _ = fakeGemini(() =>
    Response.json({ candidates: [{ content: { parts: [{ text: "let me think...", thought: true }, { text: "nah, keep it" }] } }] })
  );
  assert.equal(await talk([{ role: "user", text: "sell it?" }], { system: "s" }), "nah, keep it");
});

test("the reply knows what Butler remembers, older chat, and what it can do", async () => {
  await using gemini = fakeGemini(() => said("**yes.** your sister Aisha said the same"));
  const reply = await converse("should i take the job?", {
    device: "laptop", timeZone: "Africa/Lagos", now: new Date("2026-11-05T21:00:00Z"),
    turns: [t("owner", "got an offer from Paystack", "2026-11-05T20:50:00Z"), t("butler", "congrats! taking it?", "2026-11-05T20:50:05Z")],
    memories: "[1] Their sister is Aisha", older: "[2 Nov, 10:00] owner: i hate long commutes", connections: ["Notion"],
  });
  assert.equal(reply, "yes. your sister Aisha said the same"); // markdown taken off
  const body = gemini.seen[0].body as { contents: { role: string; parts: { text: string }[] }[]; systemInstruction: { parts: { text: string }[] } };
  const system = body.systemInstruction.parts[0].text;
  assert.match(system, /Their sister is Aisha/);
  assert.match(system, /i hate long commutes/);
  assert.match(system, /set reminders/);
  assert.match(system, /Notion/);
  assert.match(system, /Thursday 2026-11-05T22:00:00\+01:00/);
  assert.match(system, /<friend>|close Gen Z friend/); // the persona is still the voice
  assert.deepEqual(body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(body.contents.at(-1)?.parts.at(-1)?.text, "should i take the job?");
});

test("a chat about one save never searches the web and carries the save", () => {
  const system = chatSystem({ device: "phone", timeZone: "UTC", turns: [], save: "Title: Jollof recipe" });
  assert.match(system, /Title: Jollof recipe/);
});

test("markdown a bubble can't show is taken off, and lists stay readable", () => {
  assert.equal(tidy("## Plan\n**Step one**: do it\n* buy rice\n* cook\n\n\n\nok"), "Plan\nStep one: do it\n- buy rice\n- cook\n\nok");
  assert.equal(tidy("2 * 3 = 6"), "2 * 3 = 6");
});

test("old chat is searched by the words that matter", () => {
  assert.deepEqual(searchWords("What did I tell you about the visa interview, abeg?"), ["visa", "interview"]);
  assert.deepEqual(searchWords("ok"), []);
  assert.deepEqual(searchWords("Café résumé 2026"), ["cafe", "resume"]);
});

test("older chat reads with its date", () => {
  assert.equal(
    olderText([t("owner", "my visa interview is on the 12th", "2026-10-01T09:00:00Z"), t("butler", "noted", "2026-10-01T09:00:03Z")], "UTC"),
    "[1 Oct, 09:00] owner: my visa interview is on the 12th\n[1 Oct, 09:00] you: noted",
  );
});

test("learning skips small talk and reads facts from what they said", async () => {
  assert.deepEqual(await learnFacts("lol", "😭", ""), []);
  await using gemini = fakeGemini(() => said(JSON.stringify({ remember: ["Their sister is Aisha"] })));
  assert.deepEqual(await learnFacts("my sister Aisha is visiting next week", "nice, want a reminder?", ""), ["Their sister is Aisha"]);
  const prompt = (gemini.seen[0].body as { contents: { parts: { text: string }[] }[] }).contents[0].parts.at(-1)?.text ?? "";
  assert.match(prompt, /my sister Aisha is visiting/);
});

test("the sample conversations are well formed, and their rules catch bad replies", async () => {
  const { broken } = await import("../server/eval-chat.ts");
  const { cases } = JSON.parse(await Deno.readTextFile(new URL("./evals/chat.json", import.meta.url)));
  assert.ok(cases.length >= 10);
  for (const c of cases) {
    assert.ok(c.name && c.say, "every case has a name and something said");
    for (const r of [...(c.mention ?? []), ...(c.avoid ?? [])]) new RegExp(r, "iu"); // every rule compiles
  }
  const veg = cases.find((c: { name: string }) => c.name === "uses remembered facts");
  assert.deepEqual(broken(veg, "jollof with spinach and beans", "answer"), []);
  assert.equal(broken(veg, "grill some chicken for her", "answer").length, 1);
});
