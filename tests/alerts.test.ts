import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brand, classify, codeNote, eventKey, findCode, findExpiry, forAi, fromPerson, holdUntil, HourlyLimit, htmlToText, linkLine,
  linkNote, linksOf, pickLink, sameEvent, soonNote, spoofNote,
} from "../server/lib/alerts.ts";
import { authOf, callLink } from "../server/lib/google.ts";

// Every code, link and name here is made up.
const mail = (from: string, subject: string, bulk = false) => ({ from, subject, bulk, at: new Date("2026-11-02T10:34:00Z") });

test("login codes are found next to the word code, in many shapes", () => {
  assert.equal(findCode("Your OTP", "Your one-time password is 482913. It is valid for 5 minutes."), "482913");
  assert.equal(findCode("Sign in to Chowly", "Use this code to sign in: 5821"), "5821");
  assert.equal(findCode("Slack confirmation code: Q7X-2KD", ""), "Q7X-2KD");
  assert.equal(findCode("Verify", "593 204 is your verification code"), "593 204");
  assert.equal(findCode("Your code", "Enter A7K9Q2 to continue"), "A7K9Q2");
});

test("years, amounts, order numbers and card digits are not codes", () => {
  assert.equal(findCode("Welcome", "Thanks for joining in 2026. Your order number 88123344 ships soon."), null);
  assert.equal(findCode("Receipt", "You paid ₦33500 with card ending in 3000. Code of conduct applies."), null);
  assert.equal(findCode("Code review", "PR #4821 needs your review"), null);
});

test("how long a code lasts is read the email's way", () => {
  assert.deepEqual(findExpiry("This OTP is valid for 5 minutes."), { said: "valid for 5 mins", minutes: 5 });
  assert.deepEqual(findExpiry("The link expires in 1 hour."), { said: "expires in 1 hour", minutes: 60 });
  assert.equal(findExpiry("Thanks!"), null);
});

test("who it's from reads like a name, not an address", () => {
  assert.equal(brand('"STERLING BANK" <alerts@sterling.ng>'), "Sterling Bank");
  assert.equal(brand("Chowly <no-reply@chowly.com>"), "Chowly");
  assert.equal(brand("noreply@mail.recova.co.uk"), "Recova");
  assert.equal(brand("Slack <no-reply@slack.com>"), "Slack");
  assert.ok(fromPerson("Abdul Basit <abdul@gmail.com>"));
  assert.ok(!fromPerson("Higgsfield <billing@higgsfield.ai>"));
});

test("email is sorted by rules: codes, links, money, security, events, deadlines, people", () => {
  const sort = (from: string, subject: string, body: string, bulk = false) => classify(mail(from, subject, bulk), body).kind;
  assert.equal(sort("Bank <alerts@bank.ng>", "Your OTP", "Your one-time password is 482913."), "code");
  assert.equal(sort("Recova <noreply@recova.com>", "Reset your password", "Click below to reset your password."), "reset");
  assert.equal(sort("TunnelBear <hi@tunnelbear.com>", "Please confirm your email", "Confirm your email to start."), "confirm");
  assert.equal(sort("Higgsfield <billing@higgsfield.ai>", "Payment failed", "We couldn't charge your card for $49."), "payment");
  assert.equal(sort("Google Play <googleplay-noreply@google.com>", "Your payment was declined", "Update your payment method"), "payment");
  assert.equal(sort("Drips <noreply@drips.network>", "Withdrawal requested", "cjay requested a full withdrawal of 101 USDC."), "security");
  assert.equal(sort("Luma <calendar@luma.com>", "You're registered for Padel Pals", "See you there."), "event");
  assert.equal(sort("BYU-Pathway <no-reply@byupathway.edu>", "Action required", "Log in before Nov 2 or you will be dropped."), "deadline");
  assert.equal(sort("Bachs <team@bachs.io>", "One more step", "Please complete your verification (KYC) to take payments."), "action");
  assert.equal(sort("Abdul Basit <abdul@gmail.com>", "Market research", "Please read the attached before tonight."), "personal");
  assert.equal(sort("The Download <news@techletter.com>", "This week in AI", "The deadline for the grant is near.", true), "skip");
  assert.equal(sort("Shop <deals@shop.com>", "50% off", "Grab it now", true), "skip");
});

test("discount codes are not login codes", () => {
  assert.equal(classify(mail("Shop <deals@shop.com>", "Your code inside", true), "Use code SAVE20 for 20% off").kind, "skip");
  assert.notEqual(classify(mail("Shop <n@shop.com>", "Hi", false), "Your promo code is SAVE20").kind, "code");
});

test("a newsletter has to say it in the subject to count", () => {
  assert.equal(classify(mail("X <n@x.com>", "Your invoice is ready", true), "Pay by Friday").kind, "payment");
  assert.equal(classify(mail("X <n@x.com>", "Weekly roundup", true), "Your invoice is ready").kind, "skip");
});

test("links are read from HTML with their words, junk left out", () => {
  const html = `<p>Hi&nbsp;Anas,</p><a href="https://recova.com/reset?t=abc&amp;u=1">Reset password</a>
    <a href="https://recova.com/unsubscribe">Unsubscribe</a><a href="https://twitter.com/recova">Twitter</a>
    <a href="http://plain.example.com">Insecure</a>`;
  const links = linksOf("", html);
  assert.deepEqual(links, [{ url: "https://recova.com/reset?t=abc&u=1", label: "Reset password" }]);
  assert.equal(htmlToText("<style>p{}</style><p>Hello&nbsp;there</p><p>Bye</p>"), "Hello there\nBye");
});

test("links in plain text get the words before them", () => {
  const links = linksOf("Join the webinar: https://undp.zoom.us/j/123?pwd=x.\nMore at https://luma.com/e/abc", "");
  assert.deepEqual(links.map((l) => l.url), ["https://undp.zoom.us/j/123?pwd=x", "https://luma.com/e/abc"]);
  assert.equal(links[0].label, "Join the webinar");
});

test("the link picked is the one you'd tap", () => {
  const links = [
    { url: "https://higgsfield.ai/blog", label: "Read our blog" },
    { url: "https://higgsfield.ai/billing", label: "Update payment method" },
  ];
  assert.equal(pickLink("payment", links)?.url, "https://higgsfield.ai/billing");
  assert.equal(pickLink("skip", links), null);
  assert.equal(linkLine("event", "https://us02web.zoom.us/j/1"), "🤝 https://us02web.zoom.us/j/1");
  assert.equal(linkLine("event", "https://luma.com/e/1"), "🎫 https://luma.com/e/1");
  assert.equal(linkLine("reset", "https://x.com/r"), "🔄 https://x.com/r");
});

test("a code note says whose code, the code and how long it lasts, and is shown once", () => {
  const note = codeNote(mail('"STERLING BANK" <alerts@sterling.ng>', "OTP"), "valid for 5 minutes", "482913");
  assert.equal(note.body, "your Sterling Bank code is 482913 (valid for 5 mins)");
  assert.equal(note.forget, true);
  assert.equal(note.expiresInMinutes, 5);
});

test("a reset link note gives the link, the expiry and any username, shown once", () => {
  const body = "Your portal is ready. Username: C2000001. Set your password here: https://portal.example.edu/set?t=1 This link expires in 1 hour.";
  const note = linkNote(mail("University <no-reply@example.edu>", "Your account"), body, "reset", linksOf(body, ""))!;
  assert.equal(note.body, "University password link just came in (expires in 1 hour). username: C2000001:\n\n🔄 https://portal.example.edu/set?t=1");
  assert.equal(note.forget, true);
  assert.equal(note.expiresInMinutes, 60);
  assert.equal(linkNote(mail("X <n@x.com>", "Reset"), "no link here", "reset", []), null);
});

test("an email that fails the sender check never has its code passed on", () => {
  assert.equal(authOf("mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=REJECT)"), "pass");
  assert.equal(authOf("mx.google.com; spf=softfail; dmarc=fail (p=NONE)"), "fail");
  assert.equal(authOf(""), "unknown");
  const note = spoofNote(mail("PayPal <service@paypa1.com>", "Reset your password"));
  assert.match(note.body, /failed Gmail's sender check/);
  assert.doesNotMatch(note.body, /https?:/);
});

test("the AI sees numbered links and no passwords", () => {
  const body = "Wi-Fi password: Courage1$ . Pay here https://pay.example.com/i/9 now. password is hunter2";
  const text = forAi(mail("Event <hi@ev.com>", "Day 2"), body, linksOf(body, ""));
  assert.match(text, /Pay here \[link 1\] now/);
  assert.match(text, /\[1\] "Pay here" → pay\.example\.com/);
  assert.doesNotMatch(text, /Courage1|hunter2/);
});

test("heads-ups that can wait are held until quiet hours end", () => {
  assert.equal(holdUntil("2026-11-02T15:00:00+01:00", "23:00-07:00"), null);
  assert.equal(holdUntil("2026-11-02T01:39:00+01:00", "23:00-07:00")?.toISOString(), "2026-11-02T06:00:00.000Z");
  assert.equal(holdUntil("2026-11-02T23:30:00+01:00", "23:00-07:00")?.toISOString(), "2026-11-03T06:00:00.000Z");
  assert.equal(holdUntil("2026-11-02T01:39:00+01:00", "off"), null);
});

test("the AI is asked at most so many times an hour", () => {
  const limit = new HourlyLimit(2);
  assert.ok(limit.allow(0));
  assert.ok(limit.allow(1));
  assert.ok(!limit.allow(2));
  assert.ok(limit.allow(3_600_001));
});

test("the same event from email and calendar is told once", () => {
  const start = new Date("2026-11-07T17:00:00Z");
  assert.ok(sameEvent({ title: "Consonance Connect Lagos IV", start }, { title: "Connect Lagos IV · Luma", start: new Date(start.getTime() + 5 * 60_000) }));
  assert.ok(!sameEvent({ title: "Padel Pals", start }, { title: "Afro Soirée", start }));
  assert.ok(!sameEvent({ title: "Padel Pals", start }, { title: "Padel Pals", start: new Date(start.getTime() + 3_600_000) }));
  assert.equal(eventKey("Padel Pals @ PadelX!", start), "padel pals padelx|2026-11-07T17:00");
});

test("an event an hour away says when, where and how to get in", () => {
  const now = new Date("2026-11-07T16:00:00Z");
  const e = { title: "Padel Pals", starts_at: new Date("2026-11-07T17:00:00Z"), place: "PadelX, Ikoyi", link: "https://luma.com/e/1" };
  assert.equal(soonNote(e, now, "Africa/Lagos"), "Padel Pals starts in an hour (6:00 PM) at PadelX, Ikoyi\n\n🎫 https://luma.com/e/1");
  assert.equal(soonNote({ ...e, place: "online", link: null, starts_at: new Date("2026-11-07T16:20:00Z") }, now, "Africa/Lagos"),
    "Padel Pals starts in 20 mins (5:20 PM) (online)");
});

test("a calendar event's video call is found", () => {
  assert.equal(callLink({ hangoutLink: "https://meet.google.com/abc-defg-hij" }), "https://meet.google.com/abc-defg-hij");
  assert.equal(callLink({ description: "Join: https://us02web.zoom.us/j/123?pwd=x thanks" }), "https://us02web.zoom.us/j/123?pwd=x");
  assert.equal(callLink({ location: "Cafe One, Yaba" }), undefined);
});
