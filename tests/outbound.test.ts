import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrl, forgetOwnAddresses, isPrivateAddress } from "../server/lib/outbound.ts";

test("private and special addresses are spotted", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "145.241.215.1", "172.32.0.1", "2606:4700::1111"]) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
});

const fakeDns = (table: Record<string, string[]>) => (host: string) => Promise.resolve(table[host] ?? []);

test("public https addresses pass", async () => {
  forgetOwnAddresses();
  Deno.env.delete("PUBLIC_URL");
  const url = await checkUrl("https://mcp.zapier.com/api/mcp/s/abc/mcp", fakeDns({ "mcp.zapier.com": ["3.3.3.3"] }));
  assert.equal(url.host, "mcp.zapier.com");
});

test("http, passwords in the link, and private places are refused", async () => {
  forgetOwnAddresses();
  Deno.env.delete("PUBLIC_URL");
  const dns = fakeDns({ "sneaky.example.com": ["127.0.0.1"], "ok.example.com": ["3.3.3.3"] });
  await assert.rejects(() => checkUrl("http://ok.example.com/mcp", dns), /https/);
  await assert.rejects(() => checkUrl("https://me:pw@ok.example.com/mcp", dns), /key box/);
  await assert.rejects(() => checkUrl("https://localhost/mcp", dns), /public/);
  await assert.rejects(() => checkUrl("https://postgres/mcp", dns), /public/);
  await assert.rejects(() => checkUrl("https://10.0.0.5/mcp", dns), /public/);
  await assert.rejects(() => checkUrl("https://[::1]/mcp", dns), /public/);
  await assert.rejects(() => checkUrl("https://sneaky.example.com/mcp", dns), /public/);
  await assert.rejects(() => checkUrl("https://nowhere.example.com/mcp", dns), /couldn't find/);
  await assert.rejects(() => checkUrl("not a link", dns), /web address/);
});

test("this server's own machine is refused, even under another name", async () => {
  forgetOwnAddresses();
  Deno.env.set("PUBLIC_URL", "https://butler.example.com");
  const dns = fakeDns({ "butler.example.com": ["5.5.5.5"], "llm.example.com": ["5.5.5.5"] });
  await assert.rejects(() => checkUrl("https://llm.example.com/v1", dns), /public/);
  Deno.env.delete("PUBLIC_URL");
  forgetOwnAddresses();
});
