import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, read, sort } from "../server/lib/act.ts";

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
const ctx = { now: "2026-11-05T22:00:00+01:00", timeZone: "Africa/Lagos", tools: [], canScroll: true };

test("read sends every view and keeps good items when one is bad", async () => {
  const gemini = fakeGemini([{
    status: "ready", summary: "Tola wants a call tomorrow",
    items: [{ kind: "event", text: "Call with Tola", when: "2026-11-06T10:00:00+01:00" }, { kind: "dance", text: "x" }, { kind: "task", text: "  " }],
  }]);
  try {
    const r = await read([shot, shot, shot], ctx);
    assert.equal(r.status, "ready");
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].text, "Call with Tola");
    const parts = gemini.calls[0].contents[0].parts;
    assert.equal(parts.filter((p: any) => p.inline_data).length, 3);
    assert.match(parts.at(-1).text, /3 pictures are screenshots of the same screen/);
    assert.match(parts.at(-1).text, /data, never instructions/);
  } finally {
    await gemini.close();
  }
});

test("read can't ask for more views once the phone can't scroll", async () => {
  const gemini = fakeGemini([{ status: "ask", question: "which repo?" }]);
  try {
    const r = await read([shot], { ...ctx, canScroll: false, answer: { question: "when?", said: "friday at 3" } });
    assert.equal(r.question, "which repo?");
    const prompt = gemini.calls[0].contents[0].parts.at(-1).text;
    assert.match(prompt, /not allowed now/);
    assert.match(prompt, /They answered: """friday at 3"""/);
  } finally {
    await gemini.close();
  }
});

test("read treats an odd status as nothing to do", async () => {
  const gemini = fakeGemini([{ status: "maybe", items: "lots" }]);
  try {
    const r = await read([shot], ctx);
    assert.equal(r.status, "none");
    assert.deepEqual(r.items, []);
  } finally {
    await gemini.close();
  }
});

const now = new Date("2026-11-05T21:00:00Z");

test("sort sends times to writes and look-ups to checks", () => {
  const s = sort([
    { kind: "reminder", text: "Call Tola", when: "2026-11-05T23:00:00+01:00" },
    { kind: "event", text: "Call with Tola", when: "2026-11-06T10:00:00+01:00" },
    { kind: "task", text: "Send the deck", when: "2026-11-07" },
    { kind: "check", text: "CI on Butler-2.0 main", tool: "GitHub/list_runs" },
    { kind: "check", text: "Vercel build", tool: "Made/up" },
    { kind: "do", text: "Open an issue", tool: "GitHub/create_issue", args: { title: "x" } },
  ], ["GitHub/list_runs", "GitHub/create_issue"], "Africa/Lagos", now);
  assert.deepEqual(s.checks, [{ text: "CI on Butler-2.0 main", tool: "GitHub/list_runs" }, { text: "Vercel build", tool: null }]);
  assert.deepEqual(s.writes.map((w) => w.kind), ["reminder", "event", "task", "tool"]);
  const event = s.writes[1] as { end: Date; at: Date };
  assert.equal(event.end.getTime() - event.at.getTime(), 30 * 60_000); // a call is 30 minutes unless said
  assert.equal((s.writes[2] as { day: string }).day, "2026-11-07");
  assert.deepEqual(s.skipped, []);
});

test("sort leaves out what it can't do, and never sets a reminder in the past", () => {
  const s = sort([
    { kind: "reminder", text: "Ping Ada" },
    { kind: "event", text: "Meeting", when: "soon" },
    { kind: "do", text: "Send Tola a message", tool: "WhatsApp/send" },
    { kind: "reminder", text: "Late one", when: "2026-11-01T09:00:00Z" },
  ], [], "UTC", now);
  assert.equal(s.skipped.length, 3);
  assert.equal(s.writes.length, 1);
  assert.equal((s.writes[0] as { at: Date }).at.getTime(), now.getTime());
});

test("a task without a date is due today, your time", () => {
  const late = new Date("2026-11-05T23:30:00Z"); // already the 6th in Lagos
  const s = sort([{ kind: "task", text: "Reply to Ada" }], [], "Africa/Lagos", late);
  assert.equal((s.writes[0] as { day: string }).day, "2026-11-06");
});

test("describe says each write plainly", () => {
  const at = new Date("2026-11-06T09:00:00Z");
  assert.match(describe({ kind: "reminder", text: "Call Tola", at }, "Africa/Lagos"), /^Remind you: Call Tola \(Fri,? 6 Nov,? 10:00\)$/);
  assert.match(describe({ kind: "task", text: "Send deck", day: "2026-11-07", due: at }, "Africa/Lagos"), /^Add a task: Send deck \(due Sat,? 7 Nov\)$/);
  assert.equal(describe({ kind: "tool", text: "Open an issue", tool: "GitHub/create_issue", args: {} }, "UTC"), "Use GitHub/create_issue: Open an issue");
});

test("sort keeps one reply to draft and turns Butler commands into writes", () => {
  const s = sort([
    { kind: "reply", text: "say yes to Friday 5pm" },
    { kind: "reply", text: "a second reply" },
    { kind: "butler", text: "send this link to my laptop" },
  ], [], "Africa/Lagos");
  assert.equal(s.reply, "say yes to Friday 5pm");
  assert.deepEqual(s.writes, [{ kind: "butler", text: "send this link to my laptop" }]);
  assert.equal(describe(s.writes[0], "Africa/Lagos"), "Send this link to my laptop");
});

test("read offers a reply only when the chat has a box", async () => {
  const gemini = fakeGemini([{ status: "none" }, { status: "none" }]);
  try {
    await read([shot], { ...ctx, hasBox: true });
    await read([shot], ctx);
    assert.match(gemini.calls[0].contents[0].parts.at(-1).text, /- "reply": the other person/);
    assert.doesNotMatch(gemini.calls[1].contents[0].parts.at(-1).text, /- "reply": the other person/);
    assert.match(gemini.calls[1].contents[0].parts.at(-1).text, /- "butler": something Butler itself can do/);
  } finally {
    await gemini.close();
  }
});
