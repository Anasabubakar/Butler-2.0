import { test } from "node:test";
import assert from "node:assert/strict";
import type { Offer, Rule } from "../server/lib/mcp.ts";
import { type Recipe, run, runsFreely, toolsFor } from "../server/lib/recipes.ts";

const offer = (connection: string, name: string, readOnly: boolean, rule: Rule = readOnly ? "auto" : "ask"): Offer => ({
  key: `${connection}/${name}`,
  connection: { id: connection, name: connection, host: "x", tools: [], rules: {}, checked_at: null, error: null },
  tool: { name, description: `${name} tool`, schema: { type: "object", properties: { q: { type: "string" } } }, readOnly },
  rule,
});

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: "r1", name: "Morning check", instructions: "Look at my tasks, then text me the top one.", connections: [], last_run_at: null, ...over,
});

const offers = [offer("Notion", "list_tasks", true), offer("Zapier", "send_sms", false), offer("Notion", "search", true, "ask")];

test("a recipe only gets the tools from its connections", () => {
  assert.equal(toolsFor(recipe(), offers).length, 3);
  assert.deepEqual(toolsFor(recipe({ connections: ["notion"] }), offers).map((o) => o.key), ["Notion/list_tasks", "Notion/search"]);
});

test("only read-only tools you haven't asked to confirm run freely", () => {
  assert.deepEqual(offers.map(runsFreely), [true, false, false]);
});

/** A fake Gemini that answers each step from `steps`, in order, and keeps the prompts. */
function fakeAi(steps: unknown[]) {
  const prompts: string[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.method === "GET") return Response.json({ models: [{ name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] }] });
    prompts.push((await req.json()).contents[0].parts.at(-1).text);
    const text = JSON.stringify(steps[prompts.length - 1] ?? { do: "finish", reply: "out of script" });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  });
  Deno.env.set("GEMINI_URL", `http://localhost:${server.addr.port}`);
  Deno.env.set("GEMINI_API_KEY", "test-key");
  return { server, prompts };
}

const ctx = (used: string[]) => ({
  said: "", now: "2026-10-23T09:00:00+01:00", timeZone: "Africa/Lagos", offers,
  use: (o: Offer, args: Record<string, unknown>) => {
    used.push(`${o.key} ${JSON.stringify(args)}`);
    return Promise.resolve("1. Finish the essay (due today)\n2. Call the bank");
  },
});

test("a recipe reads with tools, then stops for your yes before changing anything", async () => {
  const { server, prompts } = fakeAi([
    { do: "tool", tool: "Notion/list_tasks", args: { q: "today" }, reply: "Checking tasks." },
    { do: "tool", tool: "Zapier/send_sms", args: { q: "Finish the essay" }, reply: "Your top task is the essay. I'll text it to you." },
  ]);
  const used: string[] = [];
  try {
    const done = await run(recipe(), ctx(used));
    assert.deepEqual(used, ['Notion/list_tasks {"q":"today"}']);
    assert.equal(done.waiting?.offer.key, "Zapier/send_sms");
    assert.deepEqual(done.waiting?.args, { q: "Finish the essay" });
    assert.match(done.say, /top task is the essay/);
    assert.match(prompts[1], /Finish the essay \(due today\)/); // the second step saw the first tool's reply
    assert.match(prompts[0], /"Zapier\/send_sms" \(changes things: asks the owner first\)/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("a read-only tool you set to ask first also waits for your yes", async () => {
  const { server } = fakeAi([{ do: "tool", tool: "Notion/search", args: { q: "visa" }, reply: "Searching." }]);
  const used: string[] = [];
  try {
    const done = await run(recipe(), ctx(used));
    assert.deepEqual(used, []);
    assert.equal(done.waiting?.offer.key, "Notion/search");
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("made-up tools are skipped and a recipe can't run forever", async () => {
  const loop = { do: "tool", tool: "Notion/list_tasks", args: {}, reply: "Again." };
  const { server, prompts } = fakeAi([
    { do: "tool", tool: "Gmail/send", args: {}, reply: "?" },
    loop, loop, loop, loop, loop, loop, loop,
  ]);
  const used: string[] = [];
  try {
    const done = await run(recipe(), ctx(used));
    assert.equal(used.length, 4); // 5 steps, one wasted on the made-up tool
    assert.match(prompts[1], /isn't one of your tools/);
    assert.match(prompts.at(-1)!, /used all your steps/);
    assert.equal(done.waiting, undefined);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});

test("a recipe with no tools just answers", async () => {
  const { server, prompts } = fakeAi([{ do: "finish", reply: "Good morning. Drink water." }]);
  try {
    const done = await run(recipe({ connections: ["Nothing"] }), ctx([]));
    assert.equal(done.say, "Good morning. Drink water.");
    assert.match(prompts[0], /no tools for this recipe/);
  } finally {
    Deno.env.delete("GEMINI_API_KEY");
    await server.shutdown();
  }
});
