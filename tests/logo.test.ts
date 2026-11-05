import { test } from "node:test";
import assert from "node:assert/strict";
import { findLogo, iconsIn, sitesFor, sniff } from "../server/lib/logo.ts";

const png = (n = 200) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(n)]);
const svg = (body = "") => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}<circle r="4"/>${" ".repeat(80)}</svg>`);

/** A pretend web: link → [content type, body], with every request logged. */
function web(pages: Record<string, [string, Uint8Array | string]>) {
  const asked: string[] = [];
  const get = (url: string) => {
    asked.push(url);
    const hit = pages[url];
    if (!hit) return Promise.resolve(new Response("nope", { status: 404 }));
    return Promise.resolve(new Response(hit[1] as BodyInit, { headers: { "content-type": hit[0] } }));
  };
  return { get, asked };
}

test("the brand's main site comes before the server's own name", () => {
  assert.deepEqual(sitesFor("mcp.notion.com"), ["notion.com", "mcp.notion.com"]);
  assert.deepEqual(sitesFor("mcp.zapier.com"), ["zapier.com", "mcp.zapier.com"]);
  assert.deepEqual(sitesFor("api.githubcopilot.com"), ["github.com", "api.githubcopilot.com"]);
  assert.deepEqual(sitesFor("api.example.co.uk"), ["example.co.uk", "api.example.co.uk"]);
  assert.deepEqual(sitesFor("example.com"), ["example.com"]);
  assert.deepEqual(sitesFor("1.2.3.4"), ["1.2.3.4"]);
});

test("a page's icons are ranked: scalable first, then the biggest", () => {
  const html = `<head>
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="apple-touch-icon" href="/apple.png">
    <link rel="shortcut icon" href="/old.ico">
    <link rel="icon" type="image/svg+xml" href="/logo.svg">
    <link rel="icon" href="/big.png" sizes="192x192">
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" href="http://insecure.example/x.png">
    <link rel='icon' href='/quoted.png' sizes='64x64'>
  </head>`;
  assert.deepEqual(iconsIn(html, "https://site.example/").map((i) => i.url), [
    "https://site.example/logo.svg",
    "https://site.example/big.png",
    "https://site.example/apple.png",
    "https://site.example/quoted.png",
    "https://site.example/old.ico",
    "https://site.example/small.png",
  ]);
});

test("only real, safe pictures pass", () => {
  assert.equal(sniff(png()), "image/png");
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff, ...new Uint8Array(200)])), "image/jpeg");
  assert.equal(sniff(new Uint8Array([0, 0, 1, 0, ...new Uint8Array(200)])), "image/x-icon");
  assert.equal(sniff(svg()), "image/svg+xml");
  assert.equal(sniff(svg("<script>alert(1)</script>")), null);
  assert.equal(sniff(svg(`<rect onload="x()"/>`)), null);
  assert.equal(sniff(new TextEncoder().encode(`<!doctype html><html><body>${"x".repeat(200)}</body></html>`)), null);
  assert.equal(sniff(png(10).slice(0, 20)), null); // too small to be a logo
});

test("Butler takes the best icon from the brand's site", async () => {
  const { get, asked } = web({
    "https://notion.com/": ["text/html", `<link rel="icon" href="/small.png" sizes="16x16"><link rel="icon" href="/logo.svg" type="image/svg+xml">`],
    "https://notion.com/logo.svg": ["image/svg+xml", svg()],
    "https://notion.com/small.png": ["image/png", png()],
  });
  const logo = await findLogo("mcp.notion.com", get);
  assert.equal(logo?.type, "image/svg+xml");
  assert.deepEqual(asked, ["https://notion.com/", "https://notion.com/logo.svg"]);
});

test("a broken or fake icon moves on to the next, then to favicon.ico", async () => {
  const { get } = web({
    "https://thing.example/": ["text/html", `<link rel="icon" href="/gone.png" sizes="512x512"><link rel="icon" href="/fake.png" sizes="256x256">`],
    "https://thing.example/fake.png": ["image/png", "<html>sign in to see this</html>"],
    "https://thing.example/favicon.ico": ["image/x-icon", new Uint8Array([0, 0, 1, 0, ...new Uint8Array(300)])],
  });
  assert.equal((await findLogo("thing.example", get))?.type, "image/x-icon");
});

test("the server's own name is tried when the main site has nothing", async () => {
  const { get } = web({
    "https://mcp.thing.example/": ["text/html", `<link rel="icon" href="/i.png" sizes="64x64">`],
    "https://mcp.thing.example/i.png": ["image/png", png()],
  });
  assert.equal((await findLogo("mcp.thing.example", get))?.type, "image/png");
});

test("no logo anywhere gives null, and a failing site doesn't throw", async () => {
  assert.equal(await findLogo("nothing.example", web({}).get), null);
  const boom = () => Promise.reject(new Error("down"));
  assert.equal(await findLogo("nothing.example", boom), null);
});

test("a huge picture is not kept", async () => {
  const { get } = web({
    "https://big.example/": ["text/html", `<link rel="icon" href="/huge.png" sizes="512x512">`],
    "https://big.example/huge.png": ["image/png", png(500_000)],
  });
  assert.equal(await findLogo("big.example", get), null);
});
