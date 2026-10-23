import { test } from "node:test";
import assert from "node:assert/strict";
import { milestone, milestoneNote, streak, streakNote, streakWorthCheering } from "../server/lib/streaks.ts";

test("round numbers of saves are milestones", () => {
  assert.equal(milestone(100), 100);
  assert.equal(milestone(101), null);
  assert.match(milestoneNote(100), /100th save/);
  assert.match(milestoneNote(1000), /1,000th save/);
  assert.match(milestoneNote(10), /10th save/);
});

test("a streak counts days in a row, through yesterday if today has no save yet", () => {
  const days = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"];
  assert.equal(streak(days, "2026-10-20"), 4);
  assert.equal(streak(days, "2026-10-21"), 4); // morning, nothing saved yet today
  assert.equal(streak(days, "2026-10-22"), 0); // missed a day
  assert.equal(streak(["2026-10-18", "2026-10-20"], "2026-10-20"), 1);
  assert.equal(streak([], "2026-10-20"), 0);
});

test("streaks across a month end and some lengths get a cheer", () => {
  assert.equal(streak(["2026-09-29", "2026-09-30", "2026-10-01"], "2026-10-01"), 3);
  assert.equal(streakWorthCheering(7), true);
  assert.equal(streakWorthCheering(8), false);
  assert.match(streakNote(7), /^7 days in a row/);
});
