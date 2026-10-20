import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl, extractUrl, kindFor, platformFor } from "../server/lib/rules.ts";
import { parseHtmlMeta } from "../server/lib/meta.ts";

test("extractUrl finds the link inside shared text", () => {
  assert.equal(
    extractUrl("Check this out! https://vm.tiktok.com/ZMabc123/ so funny."),
    "https://vm.tiktok.com/ZMabc123/",
  );
  assert.equal(extractUrl("(see https://example.com/a)."), "https://example.com/a");
  assert.equal(extractUrl("no link here"), null);
  assert.equal(extractUrl(null), null);
});

test("platformFor recognises common apps and subdomains", () => {
  assert.equal(platformFor("https://vm.tiktok.com/ZMabc/"), "tiktok");
  assert.equal(platformFor("https://www.instagram.com/reel/C1/"), "instagram");
  assert.equal(platformFor("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(platformFor("https://x.com/a/status/1"), "x");
  assert.equal(platformFor("https://blog.example.com/post"), "web");
  assert.equal(platformFor("https://notyoutube.com/"), "web");
  assert.equal(platformFor("not a url"), null);
  assert.equal(platformFor(null), null);
});

test("kindFor uses the file type first, then the link", () => {
  assert.equal(kindFor({ mime: "image/png", url: null, hasFile: true }), "image");
  assert.equal(kindFor({ mime: "video/mp4", url: "https://x.com", hasFile: true }), "video");
  assert.equal(kindFor({ mime: "application/pdf", url: null, hasFile: true }), "file");
  assert.equal(kindFor({ mime: null, url: "https://x.com", hasFile: false }), "link");
  assert.equal(kindFor({ mime: null, url: null, hasFile: false }), "text");
});

test("cleanUrl drops tracking parameters and keeps real ones", () => {
  assert.equal(
    cleanUrl("https://www.instagram.com/reel/C1/?igsh=abc&utm_source=ig_web"),
    "https://www.instagram.com/reel/C1/",
  );
  assert.equal(
    cleanUrl("https://www.youtube.com/watch?v=abc&si=xyz#t=10"),
    "https://www.youtube.com/watch?v=abc",
  );
  assert.equal(cleanUrl("not a url"), "not a url");
});

test("parseHtmlMeta reads Open Graph tags in either attribute order", () => {
  const html = `<html><head><title>Fallback &amp; title</title>
    <meta property="og:title" content="Real Title">
    <meta content="A &quot;quoted&quot; description" name="description">
    <meta property="og:image" content="https://img.example.com/a.jpg"></head></html>`;
  assert.deepEqual(parseHtmlMeta(html), {
    title: "Real Title",
    description: 'A "quoted" description',
    image: "https://img.example.com/a.jpg",
  });
  assert.equal(parseHtmlMeta("<title>Only &amp; title</title>").title, "Only & title");
});
