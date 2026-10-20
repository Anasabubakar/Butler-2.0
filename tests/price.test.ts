import { test } from "node:test";
import assert from "node:assert/strict";
import { dropped, parsePrice } from "../server/lib/price.ts";

test("prices come from the shop's structured data", () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
     {"@type":"Product","name":"Air fryer","offers":{"@type":"Offer","price":"45,999.00","priceCurrency":"ngn"}}]}
  </script></head></html>`;
  assert.deepEqual(parsePrice(html), { amount: 45999, currency: "NGN" });
});

test("a range of offers uses the lowest price", () => {
  const html = `<script type="application/ld+json">[{"@type":["Product"],"offers":
    {"@type":"AggregateOffer","lowPrice":120.5,"highPrice":150,"priceCurrency":"USD"}}]</script>`;
  assert.deepEqual(parsePrice(html), { amount: 120.5, currency: "USD" });
});

test("meta tags and microdata work too", () => {
  assert.deepEqual(
    parsePrice('<meta property="product:price:amount" content="19.99"><meta property="product:price:currency" content="GBP">'),
    { amount: 19.99, currency: "GBP" },
  );
  assert.deepEqual(
    parsePrice('<span itemprop="price" content="2500"></span><meta itemprop="priceCurrency" content="NGN">'),
    { amount: 2500, currency: "NGN" },
  );
});

test("pages without a trustworthy price give nothing", () => {
  assert.equal(parsePrice("<p>Only ₦5,000 today!</p>"), null);
  assert.equal(parsePrice('<script type="application/ld+json">{broken</script>'), null);
  assert.equal(parsePrice('<script type="application/ld+json">{"@type":"Product","offers":{"price":"0","priceCurrency":"NGN"}}</script>'), null);
});

test("a drop is 5% or more in the same currency", () => {
  const was = { amount: 10000, currency: "NGN" };
  assert.equal(dropped(was, { amount: 9500, currency: "NGN" }), true);
  assert.equal(dropped(was, { amount: 9600, currency: "NGN" }), false);
  assert.equal(dropped(was, { amount: 10, currency: "USD" }), false);
});
