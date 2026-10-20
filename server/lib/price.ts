// Price watch: reads the price a shop puts in its page's structured data (the same data
// Google Shopping uses), and spots drops. No AI and no guessing from page text.
import { metaTag } from "./meta.ts";

export interface Price {
  amount: number;
  currency: string;
}

const number = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const currencyOf = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null;

/** Every object in a JSON-LD tree, including inside @graph and arrays. */
function* objects(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) for (const n of node) yield* objects(n);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    yield o;
    for (const v of Object.values(o)) if (v && typeof v === "object") yield* objects(v);
  }
}

const isType = (o: Record<string, unknown>, type: string) =>
  [o["@type"]].flat().some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());

function fromJsonLd(html: string): Price | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const product of [...objects(data)].filter((o) => isType(o, "Product"))) {
      for (const offer of objects(product.offers)) {
        const amount = number(offer.price) ?? number(offer.lowPrice);
        const currency = currencyOf(offer.priceCurrency);
        if (amount && currency) return { amount, currency };
      }
    }
  }
  return null;
}

/** The product's price on this page, or null if the shop doesn't say it in a way we can trust. */
export function parsePrice(html: string): Price | null {
  const fromLd = fromJsonLd(html);
  if (fromLd) return fromLd;
  for (const prefix of ["product:price", "og:price"]) {
    const amount = number(metaTag(html, `${prefix}:amount`));
    const currency = currencyOf(metaTag(html, `${prefix}:currency`));
    if (amount && currency) return { amount, currency };
  }
  const amount = number(html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1]);
  const currency = currencyOf(html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i)?.[1]);
  return amount && currency ? { amount, currency } : null;
}

export async function fetchPrice(url: string): Promise<Price | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
      await res.body?.cancel();
      return null;
    }
    return parsePrice((await res.text()).slice(0, 2_000_000));
  } catch {
    return null;
  }
}

/** True when `now` is at least 5% below `before`, in the same currency. */
export const dropped = (before: Price, now: Price) => before.currency === now.currency && now.amount <= before.amount * 0.95;

/** ₦45,999 or US$12.50. */
export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 })
      .format(amount);
  } catch {
    return `${amount.toLocaleString("en")} ${currency}`;
  }
}
