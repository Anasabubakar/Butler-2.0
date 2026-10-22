import { test } from "node:test";
import assert from "node:assert/strict";
import { checked, planJob, statusTitle } from "../server/lib/laptop.ts";

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
  assert.equal(statusTitle("done"), "Laptop: done");
  assert.equal(statusTitle("locked"), "Laptop: remote control locked");
});
