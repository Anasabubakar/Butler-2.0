import { test } from "node:test";
import assert from "node:assert/strict";
import { category, compose, money, type Row, startOf } from "../server/lib/spending.ts";

const now = new Date("2026-10-22T10:30:00Z"); // a Thursday

test("periods start at local midnight, weeks on Monday", () => {
  assert.equal(startOf("today", now, "Africa/Lagos").toISOString(), "2026-10-21T23:00:00.000Z");
  assert.equal(startOf("week", now, "Africa/Lagos").toISOString(), "2026-10-18T23:00:00.000Z");
  assert.equal(startOf("month", now, "Africa/Lagos").toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(startOf("year", now, "UTC").toISOString(), "2026-01-01T00:00:00.000Z");
});

test("categories are tidied, and data counts as airtime", () => {
  assert.equal(category("Food"), "food");
  assert.equal(category("mobile data"), "airtime");
  assert.equal(category("rent"), "other");
  assert.equal(category(null), "other");
});

test("money shows the currency sign", () => {
  assert.equal(money(2500, "NGN"), "₦2,500");
  assert.equal(money(12.5, "USD"), "US$12.50");
});

const row = (amount: number, what: string, cat: Row["category"], currency = "NGN"): Row =>
  ({ amount, what, category: cat, currency, spent_at: now });

test("the total splits by category and names the biggest spend", () => {
  const rows = [row(3000, "suya", "food"), row(4000, "rice", "food"), row(5500, "bolt rides", "transport")];
  assert.equal(
    compose(rows, "week"),
    "This week you spent ₦12,500: food ₦7,000, transport ₦5,500. The biggest was bolt rides (₦5,500). (3 things logged.)",
  );
});

test("one category, and nothing logged yet", () => {
  assert.equal(compose([row(3000, "suya", "food")], "today", "food"), "Today you spent ₦3,000 on food. The biggest was suya (₦3,000). (1 thing logged.)");
  assert.match(compose([], "month"), /^You haven't logged any spending this month/);
});
