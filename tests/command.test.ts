import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarUrl, localIso, parseWhen, plan, safeZone, shortArgs } from "../server/lib/command.ts";

test("local time carries the zone's offset", () => {
  const now = new Date("2026-10-20T10:40:05Z");
  assert.equal(localIso(now, "Africa/Lagos"), "2026-10-20T11:40:05+01:00");
  assert.equal(localIso(now, "UTC"), "2026-10-20T10:40:05+00:00");
  assert.equal(localIso(now, "America/New_York"), "2026-10-20T06:40:05-04:00");
});

test("an unknown zone falls back to UTC", () => {
  assert.equal(safeZone("Mars/Base"), "UTC");
  assert.equal(safeZone(null), "UTC");
  assert.equal(safeZone("Africa/Lagos"), "Africa/Lagos");
});

test("times with an offset become the right moment", () => {
  assert.equal(parseWhen("2026-10-20T15:00:00+01:00")?.toISOString(), "2026-10-20T14:00:00.000Z");
  assert.equal(parseWhen("soon"), null);
  assert.equal(parseWhen(null), null);
});

test("the calendar link opens a filled-in event", () => {
  const url = new URL(calendarUrl("Dentist", new Date("2026-10-21T09:00:00Z"), new Date("2026-10-21T10:00:00Z")));
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Dentist");
  assert.equal(url.searchParams.get("dates"), "20261021T090000Z/20261021T100000Z");
});

test("the planner tells Gemini the time and devices, and reads its plan", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    const text = JSON.stringify({ action: "send", reply: "Sent.", target: "laptop", content: "" });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const got = await plan("send this to my laptop", {
      device: "android-pixel", timeZone: "Africa/Lagos", now: new Date("2026-10-20T10:40:00Z"),
      devices: [{ name: "laptop", kind: "laptop" }],
    }, null);
    assert.equal(got.action, "send");
    assert.equal(got.content, null); // an empty content is treated as missing
    assert.match(prompt, /Tuesday 2026-10-20T11:40:00\+01:00 \(Africa\/Lagos\)/);
    assert.match(prompt, /laptop \(laptop\)/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("a tool's arguments are described in a few words", () => {
  assert.equal(shortArgs({
    type: "object",
    properties: { city: { type: "string", description: "Which city" }, units: { enum: ["c", "f"] } },
    required: ["city"],
  }), 'city: string (required) - Which city; units: "c" | "f"');
  assert.equal(shortArgs({ type: "object" }), "none");
});

test("the planner offers connected tools and reads a tool choice", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    const text = JSON.stringify({ action: "tool", reply: "Checking.", tool: "Zapier/weather", args: { city: "Kano" } });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const got = await plan("weather in Kano?", {
      device: "android-pixel", timeZone: "Africa/Lagos", devices: [],
      tools: [{ key: "Zapier/weather", description: "Today's weather", args: "city: string (required)" }],
    }, null);
    assert.equal(got.action, "tool");
    assert.equal(got.tool, "Zapier/weather");
    assert.deepEqual(got.args, { city: "Kano" });
    assert.match(prompt, /"Zapier\/weather": Today's weather Arguments: city: string \(required\)/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("without tools, the planner doesn't mention them", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"action":"answer","reply":"Hi."}' }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    await plan("hi", { device: "phone", timeZone: "UTC", devices: [] }, null);
    assert.doesNotMatch(prompt, /"tool": use one/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("the planner lists saved recipes and reads which one to run", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"action":"recipe","reply":"On it.","recipe":"Morning check"}' }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const got = await plan("run my morning check", {
      device: "phone", timeZone: "UTC", devices: [], recipes: [{ name: "Morning check", about: "Look at my tasks" }],
    }, null);
    assert.equal(got.action, "recipe");
    assert.equal(got.recipe, "Morning check");
    assert.match(prompt, /"Morning check": Look at my tasks/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("the planner sees memories, the conversation and an open save, and says what to remember", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    const text = JSON.stringify({ action: "edit", reply: "Renamed.", subject: "Suya spots", remember: ["Loves suya"], forget: ["2"] });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const got = await plan("call it suya spots, i love suya", {
      device: "phone", timeZone: "UTC", devices: [], learn: true,
      memories: "[1] Lives in Abuja\n[2] Hates suya", history: "[Mon 10:00] owner: what's this?", save: "[1] Best suya in Abuja",
    }, null);
    assert.equal(got.action, "edit");
    assert.deepEqual(got.remember, ["Loves suya"]);
    assert.deepEqual(got.forget, [2]);
    assert.match(prompt, /\[2\] Hates suya/);
    assert.match(prompt, /owner: what's this\?/);
    assert.match(prompt, /Best suya in Abuja/);
    assert.match(prompt, /"edit": change this save/);
    assert.match(prompt, /worth knowing for months/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("a reply to a pushed message is read as an answer to it, and the screenshot stays in the background", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    const text = JSON.stringify({ action: "answer", reply: "cool, i'll leave them." });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const shot = { data: "AAAA", mediaType: "image/jpeg" };
    const got = await plan("Nah", {
      device: "laptop", timeZone: "UTC", devices: [],
      answering: "Morning check: 3 emails need a reply. Want me to follow up on them?", replied: true,
    }, shot);
    assert.equal(got.reply, "cool, i'll leave them.");
    assert.match(prompt, /tapped reply on this message/);
    assert.match(prompt, /"""Morning check: 3 emails need a reply\. Want me to follow up on them\?"""/);
    assert.match(prompt, /"nah".*mean don't/);
    assert.match(prompt, /never describe it unasked/);

    await plan("yes", { device: "phone", timeZone: "UTC", devices: [], answering: "Want me to draft a reply?" }, null);
    assert.match(prompt, /last thing in your conversation is your message/);
    assert.match(prompt, /otherwise it's something new/);

    await plan("hi", { device: "phone", timeZone: "UTC", devices: [], answering: "x".repeat(3000), replied: true }, null);
    assert.match(prompt, /x{1500}…"""/);
    assert.doesNotMatch(prompt, /x{1501}/);

    await plan("hi", { device: "phone", timeZone: "UTC", devices: [] }, null);
    assert.doesNotMatch(prompt, /tapped reply|last thing in your conversation/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});
