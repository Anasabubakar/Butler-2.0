import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarUrl, localIso, parseWhen, plan, safeZone } from "../server/lib/command.ts";

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
