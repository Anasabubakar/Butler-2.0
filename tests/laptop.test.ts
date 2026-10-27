import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, checked, missedReason, offlineWarning, planJob, silentReason, statusTitle } from "../server/lib/laptop.ts";

const folders = ["glance", "Butler-2.0", "morrow"];

test("a Claude Code job only runs in one of the laptop's own project folders", () => {
  assert.deepEqual(checked({ do: "claude", folder: "GLANCE", prompt: "Finish it", say: "" }, folders), {
    do: "claude", folder: "glance", prompt: "Finish it", say: "Starting Claude Code in glance",
  });
  assert.equal(checked({ do: "claude", folder: "../../etc", prompt: "x", say: "" }, folders).do, "refuse");
  assert.equal(checked({ do: "claude", folder: "glance", prompt: " ", say: "" }, folders).do, "refuse");
});

test("only http and https links are opened, and empty jobs are refused", () => {
  assert.equal(checked({ do: "open", url: "https://youtube.com", say: "" }, folders).do, "open");
  assert.equal(checked({ do: "open", url: "file:///etc/passwd", say: "" }, folders).do, "refuse");
  assert.equal(checked({ do: "open", url: "javascript:alert(1)", say: "" }, folders).do, "refuse");
  assert.equal(checked({ do: "app", name: "", say: "" }, folders).do, "refuse");
  assert.equal(checked({ do: "screen", goal: "play the next episode", say: "" }, folders).do, "screen");
  assert.equal(checked({ do: "refuse", say: "That pays for something." }, folders).say, "That pays for something.");
});

test("the planner gets the command and the folders, and its job is checked", async () => {
  let prompt = "";
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return new Response("no model list here", { status: 404 });
    prompt = (await req.json()).contents[0].parts.at(-1).text;
    const text = JSON.stringify({ do: "claude", folder: "glance", prompt: "Complete the Glance project.", say: "" });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    const job = await planJob("open Claude Code and make it finish the Glance project", folders);
    assert.equal(job.do, "claude");
    assert.equal(job.folder, "glance");
    assert.match(prompt, /finish the Glance project/);
    assert.match(prompt, /glance, Butler-2\.0, morrow/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("each state has a title for the phone's notification", () => {
  assert.equal(statusTitle("done"), "My laptop • Complete");
  assert.equal(statusTitle("locked"), "My laptop • Remote control is locked");
});

test("how long ago, in plain words", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const before = (s: number) => new Date(now.getTime() - s * 1000);
  assert.equal(ago(before(40), now), "40 seconds");
  assert.equal(ago(before(14 * 60), now), "14 min");
  assert.equal(ago(before(3600), now), "1 hour");
  assert.equal(ago(before(3 * 3600), now), "3 hours");
  assert.equal(ago(before(3 * 86400), now), "3 days");
});

test("sending to a laptop that's gone quiet says so, and a missed command says why", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const before = (s: number) => new Date(now.getTime() - s * 1000);
  assert.equal(offlineWarning(before(20), now), null);
  assert.match(offlineWarning(before(14 * 60), now)!, /last checked in 14 min ago.*asleep.*10 minutes/);
  assert.match(offlineWarning(null, now)!, /hasn't heard from your laptop/);
  assert.match(missedReason(before(3 * 3600), now), /didn't pick this up within 10 minutes.*3 hours ago.*asleep/);
  assert.match(missedReason(before(10), now), /online but didn't take it.*Log out and back in/);
  assert.match(missedReason(null, now), /never checked in/);
});

test("a running job with no news for 25 minutes is called out", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const before = (m: number) => new Date(now.getTime() - m * 60_000);
  assert.equal(silentReason("working", before(5), now), null);
  assert.equal(silentReason("done", before(60), now), null);
  assert.match(silentReason("working", before(40), now)!, /No news from your laptop for 40 min/);
});
