import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, endOfDay, onDay, startOfDay, today } from "../server/lib/brief.ts";

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
    "morning, ser. here's your Wednesday 21 October:",
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
  assert.equal(text, "evening, ser. here's your Wednesday 21 October:\n\nconnect Google under Integrations on the website and your calendar shows up here.");
});

const quiet = { reminders: [], savedLastDay: 0, resurface: null };

test("when Google fails it says so, and never calls the day empty", () => {
  const text = compose({
    ...quiet,
    events: { error: "your Google sign-in has expired or was removed. press Connect Google on the Butler website to sign in again." },
    tasks: { error: "Google Tasks API is switched off in your Google Cloud project." },
    mail: { error: "Google didn't answer. try again in a minute." },
  }, now, "Africa/Lagos");
  assert.match(text, /couldn't read your calendar, so i can't tell you what's on: your Google sign-in has expired/);
  assert.match(text, /couldn't read your Google Tasks: Google Tasks API is switched off/);
  assert.match(text, /couldn't check your email: Google didn't answer/);
  assert.doesNotMatch(text, /nothing on your calendar/);
});

test("the brief lists tasks due today, overdue ones and unread email", () => {
  const text = compose({
    ...quiet,
    events: [],
    tasks: [
      { title: "Pay rent", due: "2026-10-21", list: "My Tasks" },
      { title: "Renew passport", due: "2026-10-18", list: "My Tasks" },
      { title: "Read a book", due: null, list: "My Tasks" },
      { title: "Dentist", due: "2026-10-25", list: "My Tasks" },
    ],
    mail: [{ from: "Ada", subject: "Invoice for October", at: now, unread: true, snippet: "" }],
  }, now, "Africa/Lagos");
  assert.match(text, /nothing on your calendar today\./);
  assert.match(text, /Tasks due today:\n• Pay rent\n\nOverdue:\n• Renew passport \(due 18 Oct\)/);
  assert.doesNotMatch(text, /Dentist/);
  assert.match(text, /Unread email \(1\):\n• Ada: Invoice for October/);
});

test("an empty inbox and no due tasks are said plainly", () => {
  const text = compose({ ...quiet, events: [], tasks: [{ title: "Someday", due: null, list: "x" }], mail: [] }, now, "Africa/Lagos");
  assert.match(text, /no tasks due today \(1 open with no date\)\./);
  assert.match(text, /no unread email waiting on you\./);
});

test("after midday an empty calendar means nothing else is on", () => {
  const text = compose({ ...quiet, events: [] }, new Date("2026-10-21T14:00:00Z"), "Africa/Lagos");
  assert.match(text, /nothing else on your calendar today\./);
});

test("the brief can be about another day", () => {
  const text = compose({
    ...quiet, day: "2026-10-22",
    events: [{ title: "Flight to Abuja", start: new Date("2026-10-22T06:30:00Z"), allDay: false }],
    tasks: [{ title: "Pack", due: "2026-10-22", list: "x" }, { title: "Late thing", due: "2026-10-01", list: "x" }],
    mail: null, streak: 5,
  }, now, "Africa/Lagos");
  assert.equal(text, [
    "morning, ser. here's Thursday 22 October:",
    "",
    "On your calendar:",
    "• 07:30 Flight to Abuja",
    "",
    "Tasks due that day:",
    "• Pack",
  ].join("\n"));
});

test("a day starts at local midnight, and all-day events only count on their days", () => {
  assert.equal(startOfDay("2026-10-22", "Africa/Lagos").toISOString(), "2026-10-21T23:00:00.000Z");
  assert.equal(startOfDay("2026-10-22", "America/New_York").toISOString(), "2026-10-22T04:00:00.000Z");
  const yesterday = { title: "Holiday", start: new Date("2026-10-20T12:00:00Z"), allDay: true, until: "2026-10-21" };
  const trip = { title: "Trip", start: new Date("2026-10-19T12:00:00Z"), allDay: true, until: "2026-10-24" };
  assert.equal(onDay(yesterday, "2026-10-21"), false);
  assert.equal(onDay(trip, "2026-10-21"), true);
});
