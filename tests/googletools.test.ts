import { test } from "node:test";
import assert from "node:assert/strict";
import { byDay, daysFrom, googleOffers, isGoogleTool } from "../server/lib/googletools.ts";
import { type Recipe, runsFreely, toolsFor } from "../server/lib/recipes.ts";
import type { Offer } from "../server/lib/mcp.ts";

const zone = "Africa/Lagos";
const now = new Date("2026-11-05T07:01:00Z"); // 08:01 in Lagos, a Thursday

test("Google tools only read, so a recipe runs them without asking", () => {
  const offers = googleOffers();
  assert.deepEqual(offers.map((o) => o.key), ["Google/calendar", "Google/tasks", "Google/email"]);
  assert.ok(offers.every(runsFreely));
  assert.ok(offers.every(isGoogleTool));
});

test("a recipe limited to other connections still gets your Google tools", () => {
  const apollo: Offer = {
    key: "Apollo/list_tasks",
    connection: { id: "c1", name: "Apollo", host: "x", tools: [], rules: {}, checked_at: null, error: null },
    tool: { name: "list_tasks", description: "", schema: {}, readOnly: true },
    rule: "auto",
  };
  const recipe = { connections: ["Apollo"] } as unknown as Recipe;
  assert.deepEqual(toolsFor(recipe, [...googleOffers(), apollo]).map((o) => o.key),
    ["Google/calendar", "Google/tasks", "Google/email", "Apollo/list_tasks"]);
});

test("a calendar look covers today unless told otherwise, at most two weeks", () => {
  assert.deepEqual(daysFrom({}, now, zone), ["2026-11-05"]);
  assert.deepEqual(daysFrom({ day: "2026-11-30", days: 3 }, now, zone), ["2026-11-30", "2026-12-01", "2026-12-02"]);
  assert.equal(daysFrom({ days: 99 }, now, zone).length, 14);
  assert.deepEqual(daysFrom({ day: "next week" }, now, zone), ["2026-11-05"]);
});

test("events are laid out day by day in your time, and an empty day says so", () => {
  const events = [
    { title: "Away", start: new Date("2026-11-05T12:00:00Z"), allDay: true, until: "2026-11-07" },
    { title: "FCMB AgriTech Summit", start: new Date("2026-11-05T07:30:00Z"), allDay: false, place: "Legend Hotel" },
    { title: "Recova meeting", start: new Date("2026-11-05T21:00:00Z"), allDay: false, link: "https://meet.google.com/abc" },
  ];
  assert.equal(byDay(events, ["2026-11-05", "2026-11-06", "2026-11-07"], now, zone), [
    "2026-11-05 (today):",
    "  • all day Away",
    "  • 08:30 FCMB AgriTech Summit · Legend Hotel",
    "  • 22:00 Recova meeting · https://meet.google.com/abc",
    "2026-11-06:",
    "  • all day Away",
    "2026-11-07:",
    "  nothing on the calendar",
  ].join("\n"));
});
