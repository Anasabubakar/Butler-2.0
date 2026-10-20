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
    savedYesterday: 1,
    resurface: { title: "Smoky party jollof", link: "https://www.tiktok.com/@chef/video/1", savedOn: new Date("2026-10-01T10:00:00Z") },
  }, now, "Africa/Lagos");
  assert.equal(text, [
    "Good morning! It's Wednesday 21 October.",
    "",
    "Today:",
    "• 10:00 Standup",
    "• All day Mum's birthday",
    "",
    "Reminders:",
    "• 15:00 call the bank",
    "",
    "You saved 1 thing yesterday.",
    "",
    "From your library (saved 1 Oct): Smoky party jollof",
    "https://www.tiktok.com/@chef/video/1",
  ].join("\n"));
});

test("without Google it says how to add your calendar, and greets for the hour", () => {
  const text = compose({ events: null, reminders: [], savedYesterday: 0, resurface: null },
    new Date("2026-10-21T19:00:00Z"), "Africa/Lagos");
  assert.equal(text, "Good evening! It's Wednesday 21 October.\n\nConnect Google on the website to see your calendar here.");
});
