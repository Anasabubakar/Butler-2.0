import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanClientId, formatCursor, parseCursor, START, withOverlap } from "../server/lib/sync.ts";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

test("a cursor survives being written down and read back, microseconds and all", () => {
  const c = { micros: 1793000807228950n, id: ID };
  assert.deepEqual(parseCursor(formatCursor(c)), c);
});

test("a missing or broken cursor starts from the beginning", () => {
  assert.deepEqual(parseCursor(undefined), START);
  assert.deepEqual(parseCursor(""), START);
  assert.deepEqual(parseCursor("yesterday"), START);
  assert.deepEqual(parseCursor("123:not-an-id"), START);
  assert.deepEqual(parseCursor("-5:" + ID), START);
});

test("ids in cursors are read in lower case", () => {
  assert.equal(parseCursor("1:" + ID.toUpperCase()).id, ID);
});

test("catching up looks back a few seconds, but never before the beginning", () => {
  assert.deepEqual(withOverlap({ micros: 20_000_000n, id: ID }), { micros: 10_000_000n, id: START.id });
  assert.deepEqual(withOverlap({ micros: 3_000_000n, id: ID }), { micros: 0n, id: START.id });
  assert.deepEqual(withOverlap(START), START);
});

test("a device's own id for a save is short plain text or nothing", () => {
  assert.equal(cleanClientId(" phone-1:abc_2.x "), "phone-1:abc_2.x");
  assert.equal(cleanClientId(""), null);
  assert.equal(cleanClientId(null), null);
  assert.equal(cleanClientId("has space"), null);
  assert.equal(cleanClientId("x".repeat(101)), null);
});
