import { test } from "node:test";
import assert from "node:assert/strict";
import { backUp } from "../server/lib/backup.ts";

test("without Google set up, a backup round says how to turn backups on", async () => {
  const status = await backUp("/nonexistent/dumps", "/nonexistent/files");
  assert.equal(status.ok, false);
  assert.match(status.note, /connect Google/);
});
