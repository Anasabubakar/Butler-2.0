import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInNote, headlinesNote, parseRss, rememberTopic } from "../server/lib/daily.ts";

const rss = `<?xml version="1.0"?><rss><channel><title>AI</title>
<item><title>Lab ships new open model - TechNews</title><link>https://news.google.com/rss/articles/a1</link>
<pubDate>Mon, 02 Nov 2026 07:00:00 GMT</pubDate><source url="https://technews.example">TechNews</source></item>
<item><title><![CDATA[Chip maker &amp; cloud firm sign deal]]></title><link>https://news.google.com/rss/articles/a2</link>
<pubDate>Mon, 02 Nov 2026 05:00:00 GMT</pubDate><source url="https://wire.example">Wire</source></item>
<item><title>No link</title><pubDate>Mon, 02 Nov 2026 05:00:00 GMT</pubDate></item>
</channel></rss>`;

test("news feeds are read into headlines, without the source tacked on", () => {
  const found = parseRss(rss);
  assert.equal(found.length, 2);
  assert.equal(found[0].title, "Lab ships new open model");
  assert.equal(found[0].source, "TechNews");
  assert.equal(found[1].title, "Chip maker & cloud firm sign deal");
});

test("without AI the newest headlines go as they are, with links", async () => {
  const note = await headlinesNote(parseRss(rss), ["AI"], false);
  assert.equal(note, [
    "AI headlines from the past day:",
    "• Lab ships new open model (TechNews)\n  https://news.google.com/rss/articles/a1",
    "• Chip maker & cloud firm sign deal (Wire)\n  https://news.google.com/rss/articles/a2",
  ].join("\n"));
});

test("a thin news day is said plainly, not padded", async () => {
  assert.match(await headlinesNote([], ["AI"], true), /news scan was thin/);
});

test("recent fact topics are kept, newest last, without repeats", () => {
  assert.deepEqual(rememberTopic(["lions", "bats"], "lions"), ["bats", "lions"]);
  assert.equal(rememberTopic(Array.from({ length: 50 }, (_, i) => `t${i}`), "new").length, 40);
});

test("the Friday check-in changes each week and offers to keep the answer", () => {
  Deno.env.set("BUTLER_TITLE", "ser");
  assert.equal(checkInNote(0, 3), "friday check-in, ser. what did you actually get done this week? (i saw you save 3 things this week.)\n\nreply and i'll keep it in your library.");
  assert.notEqual(checkInNote(1, 0), checkInNote(0, 0));
});
