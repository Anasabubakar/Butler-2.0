import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "npm:zod@4.3.6";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.32.1/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.32.1/server/webStandardStreamableHttp.js";
import { defaultRule, discover, headersFor, resultText, run, useFetch } from "../server/lib/mcp.ts";

/** A small MCP server on localhost: one tool that reads, one that writes. Needs the key "s3cret". */
function serve() {
  const sent: string[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    if (req.headers.get("authorization") !== "Bearer s3cret") return new Response("no", { status: 401 });
    const mcp = new McpServer({ name: "test", version: "1.0.0" });
    mcp.registerTool("weather", {
      description: "Today's weather in a city",
      inputSchema: { city: z.string() },
      annotations: { readOnlyHint: true },
    }, ({ city }: { city: string }) => ({ content: [{ type: "text", text: `Sunny in ${city}` }] }));
    mcp.registerTool("send_sms", {
      description: "Sends a text message",
      inputSchema: { to: z.string(), text: z.string() },
    }, ({ to, text }: { to: string; text: string }) => {
      sent.push(`${to}: ${text}`);
      return { content: [{ type: "text", text: "Sent." }] };
    });
    mcp.registerTool("broken", { description: "Always fails" }, () => ({
      isError: true, content: [{ type: "text", text: "quota used up" }],
    }));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await mcp.connect(transport);
    return transport.handleRequest(req);
  });
  return { server, sent, url: `http://localhost:${server.addr.port}/mcp` };
}

test("keys go in the header the server wants", () => {
  assert.deepEqual(headersFor("none", "x"), {});
  assert.deepEqual(headersFor("bearer", "abc"), { Authorization: "Bearer abc" });
  assert.deepEqual(headersFor("header", "abc", "X-Api-Key"), { "X-Api-Key": "abc" });
  assert.throws(() => headersFor("header", "abc", "Host"));
  assert.throws(() => headersFor("header", "abc", "bad header"));
});

test("Butler lists a server's tools, and only read-only ones run without asking", async () => {
  const { server, url } = serve();
  useFetch(fetch);
  try {
    const tools = await discover({ url, headers: { Authorization: "Bearer s3cret" } });
    assert.deepEqual(tools.map((t) => t.name), ["weather", "send_sms", "broken"]);
    const [weather, sms] = tools;
    assert.equal(weather.description, "Today's weather in a city");
    assert.ok((weather.schema.properties as Record<string, unknown>).city);
    assert.equal(defaultRule(weather), "auto");
    assert.equal(defaultRule(sms), "ask");
  } finally {
    await server.shutdown();
  }
});

test("a wrong key is explained plainly", async () => {
  const { server, url } = serve();
  useFetch(fetch);
  try {
    await assert.rejects(() => discover({ url, headers: { Authorization: "Bearer nope" } }), /key is wrong/);
  } finally {
    await server.shutdown();
  }
});

test("tools run with their arguments, and failures come back as errors", async () => {
  const { server, url, sent } = serve();
  useFetch(fetch);
  const secret = { url, headers: { Authorization: "Bearer s3cret" } };
  try {
    assert.equal(await run(secret, "weather", { city: "Kano" }), "Sunny in Kano");
    assert.equal(await run(secret, "send_sms", { to: "Mum", text: "On my way" }), "Sent.");
    assert.deepEqual(sent, ["Mum: On my way"]);
    await assert.rejects(() => run(secret, "broken", {}), /quota used up/);
  } finally {
    await server.shutdown();
  }
});

test("results become readable text", () => {
  assert.equal(resultText({ content: [{ type: "text", text: "a" }, { type: "image", data: "", mimeType: "image/png" }] }), "a\n[a picture]");
  assert.equal(resultText({ content: [], structuredContent: { n: 1 } }), '{"n":1}');
  assert.equal(resultText({}), "(nothing came back)");
  assert.ok(resultText({ content: [{ type: "text", text: "x".repeat(9000) }] }).length < 8100);
});
