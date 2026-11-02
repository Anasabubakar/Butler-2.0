import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "../server/lib/ahead.ts";

const now = new Date("2026-11-02T12:00:00Z");
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);

test("reminders in the next two days are handed over, keyed by message id", () => {
  const out = plan([
    { id: "r1", body: "call mum", due_at: at(3) },
    { id: "r2", body: "too late", due_at: at(-1) },
    { id: "r3", body: "too far", due_at: at(49) },
  ], [], [], now, "Africa/Lagos");
  assert.deepEqual(out, [{ key: "reminder:r1", kind: "reminder", at: at(3).toISOString(), body: "call mum", url: null, match: "r1" }]);
});

test("events ring an hour before, worded as Butler words them", () => {
  const [e] = plan([], [{ title: "Padel Pals", starts_at: at(5), place: "PadelX, Ikoyi", link: "https://luma.com/e/1" }], [], now, "Africa/Lagos");
  assert.equal(e.kind, "event");
  assert.equal(e.at, at(4).toISOString());
  assert.equal(e.body, "Padel Pals starts in an hour (6:00 PM) at PadelX, Ikoyi\n\n🎫 https://luma.com/e/1");
  assert.equal(e.url, "https://luma.com/e/1");
  assert.equal(e.match, "Padel Pals starts ");
});

test("an event already inside its hour is left to Butler online", () => {
  assert.deepEqual(plan([], [{ title: "Standup", starts_at: at(0.5), place: null, link: null }], [], now, "UTC"), []);
});

test("a calendar event already kept from email is planned once, with the kept title", () => {
  const out = plan([], [{ title: "Connect Lagos IV · Luma", starts_at: at(6), place: null, link: null }],
    [{ title: "Consonance Connect Lagos IV", starts_at: new Date(at(6).getTime() + 5 * 60_000), place: null, link: null },
     { title: "Dentist", starts_at: at(10), place: null, link: null }], now, "UTC");
  assert.deepEqual(out.map((e) => e.match), ["Connect Lagos IV · Luma starts ", "Dentist starts "]);
});

test("the plan comes in time order, and keys stay the same between refreshes", () => {
  const r = [{ id: "r1", body: "late one", due_at: at(20) }];
  const ev = [{ title: "Early", starts_at: at(3), place: null, link: null }];
  const a = plan(r, ev, [], now, "UTC");
  const b = plan(r, ev, [], new Date(now.getTime() + 600_000), "UTC");
  assert.deepEqual(a.map((x) => x.kind), ["event", "reminder"]);
  assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key));
});

test("a link that isn't https isn't offered to tap", () => {
  const [e] = plan([], [{ title: "Old site", starts_at: at(3), place: null, link: "http://example.com" }], [], now, "UTC");
  assert.equal(e.url, null);
});
