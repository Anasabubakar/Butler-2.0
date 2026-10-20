import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { consentUrl, mime } from "../server/lib/google.ts";

const to = { name: "David Okafor", email: "david@example.com" };

test("a plain email has the name, subject and body", () => {
  const raw = mime({ to, subject: "Lunch", body: "Free at 1?" });
  assert.match(raw, /^To: "David Okafor" <david@example.com>\r\n/);
  assert.match(raw, /\r\nSubject: Lunch\r\n/);
  const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assert.equal(new TextDecoder().decode(decodeBase64(body)), "Free at 1?");
});

test("non-English subjects are encoded, and screenshots attached", () => {
  const raw = mime({
    to, subject: "Ẹ káàrọ̀", body: "See this",
    attachment: { name: "screenshot.jpg", mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) },
  });
  assert.match(raw, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="butler-/);
  assert.match(raw, /filename="screenshot.jpg"\r\nContent-Transfer-Encoding: base64\r\n\r\nAQID\r\n/);
});

test("names that could break the To line are left out", () => {
  assert.match(mime({ to: { name: 'Eve" <evil@x.com>', email: "eve@example.com" }, subject: "s", body: "b" }), /^To: eve@example.com\r\n/);
});

test("the consent page asks for offline access with every scope", () => {
  Deno.env.set("GOOGLE_CLIENT_ID", "id");
  Deno.env.set("PUBLIC_URL", "https://butler.example.com/");
  try {
    const url = new URL(consentUrl("st"));
    assert.equal(url.searchParams.get("redirect_uri"), "https://butler.example.com/api/google/callback");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.match(url.searchParams.get("scope")!, /gmail\.send/);
    assert.match(url.searchParams.get("scope")!, /calendar\.events/);
    assert.match(url.searchParams.get("scope")!, /drive\.file/); // only Butler's own backup files
  } finally {
    Deno.env.delete("GOOGLE_CLIENT_ID");
    Deno.env.delete("PUBLIC_URL");
  }
});
