import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLocal } from "../server/lib/inbox.ts";

const FP = "ab".repeat(32);

test("a device's direct link keeps its port, fingerprint and LAN addresses", () => {
  assert.deepEqual(cleanLocal({ port: 53320, fingerprint: FP.toUpperCase().match(/../g)!.join(":"), addresses: ["192.168.1.4", "10.0.0.2"] }), {
    port: 53320, fingerprint: FP, addresses: ["192.168.1.4", "10.0.0.2"],
  });
});

test("odd ports, fingerprints and addresses are dropped", () => {
  assert.equal(cleanLocal(null), null);
  assert.equal(cleanLocal({ port: 80, fingerprint: FP }), null);
  assert.equal(cleanLocal({ port: 53320, fingerprint: "short" }), null);
  assert.deepEqual(cleanLocal({ port: 53320, fingerprint: FP, addresses: ["127.0.0.1", "evil.example", "::1", "192.168.0.9"] })?.addresses, ["192.168.0.9"]);
  assert.deepEqual(cleanLocal({ port: 53320, fingerprint: FP })?.addresses, []);
});
