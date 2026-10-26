import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, endOfDay, today } from "../server/lib/brief.ts";

const now = new Date("2026-10-21T07:05:00Z"); // 08:05 in Lagos

test("the day ends at midnight in your time zone", () => {
  assert.equal(endOfDay(now, "Africa/Lagos").toISOString(), "2026-10-21T22:59:59.000Z");
  assert.equal(today(new Date("2026-10-21T23:30:00Z"), "Africa/Lagos"), "2026-10-22");
});

test("the brief lists the day, reminders, yesterday's saves and one old save", () => {
  const text = compose({
    events: [
      { title: "Standup", start: new Date("2026-10-21T09:00:00Z"), allDay: false },
      { title: "Mum's birthday", start: new Date("2026-10-21T00:00:00Z"), allDay: true },
    ],
    reminders: [{ body: "call the bank", due: new Date("2026-10-21T14:00:00Z") }],
    savedLastDay: 1,
    resurface: { title: "Smoky party jollof", link: "https://www.tiktok.com/@chef/video/1", savedOn: new Date("2026-10-01T10:00:00Z") },
  }, now, "Africa/Lagos");
  assert.equal(text, [
    "morning, sir. here's your Wednesday 21 October:",
    "",
    "Today:",
    "• 10:00 Standup",
    "• All day Mum's birthday",
    "",
    "Reminders:",
    "• 15:00 call the bank",
    "",
    "you saved 1 thing in the last day.",
    "",
    "from your library (saved 1 Oct): Smoky party jollof",
    "https://www.tiktok.com/@chef/video/1",
  ].join("\n"));
});

test("without Google it says how to add your calendar, and greets for the hour", () => {
  const text = compose({ events: null, reminders: [], savedLastDay: 0, resurface: null },
    new Date("2026-10-21T19:00:00Z"), "Africa/Lagos");
  assert.equal(text, "evening, sir. here's your Wednesday 21 October:\n\nconnect Google under Integrations on the website and your calendar shows up here.");
});
