import { test } from "node:test";
import assert from "node:assert/strict";

// The B2 colour tokens, read from the stylesheet itself so this test can't drift from it.
const css = await Deno.readTextFile(new URL("../web/src/b2-tokens.css", import.meta.url));

function token(name: string): string {
  const m = css.match(new RegExp(`--b2-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`no --b2-${name} colour in b2-tokens.css`);
  return m[1].toLowerCase();
}

/** WCAG 2 contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the core colours are the ones in the B2 handoff", () => {
  assert.deepEqual(
    ["ink", "white", "paper", "vermilion", "action-red", "muted", "line", "dark-surface"].map(token),
    ["#111111", "#ffffff", "#f8f7f4", "#e4462d", "#b83120", "#65625e", "#d8d5cf", "#191919"],
  );
});

test("the sticky-note materials are the ones observed in the live app", () => {
  assert.deepEqual(
    ["material-shell", "material-cork", "material-paper-pink", "material-paper-green", "material-paper-ink"].map(token),
    ["#15131c", "#5d4630", "#e9a6c0", "#add58f", "#2a2220"],
  );
});

test("white small text is only readable on the darker action red, not on vermilion", () => {
  assert.ok(contrast("#ffffff", token("vermilion")) < 4.5);
  assert.ok(contrast("#ffffff", token("action-red")) >= 4.5);
  assert.ok(contrast(token("ink"), token("vermilion")) >= 4.5); // ink is fine on vermilion
});

test("body and muted text are readable on their surfaces", () => {
  assert.ok(contrast(token("ink"), token("paper")) >= 4.5);
  assert.ok(contrast(token("muted"), token("paper")) >= 4.5);
  assert.ok(contrast(token("muted"), token("white")) >= 4.5);
  assert.ok(contrast(token("text-muted"), token("dark-surface")) >= 4.5);
  assert.ok(contrast(token("material-paper-ink"), token("material-paper-pink")) >= 4.5);
  assert.ok(contrast(token("material-paper-ink"), token("material-paper-green")) >= 4.5);
});

test("no blue or purple brand accent sneaks in", () => {
  const core = ["ink", "white", "paper", "vermilion", "action-red", "muted", "line", "dark-surface"].map(token);
  for (const hex of core) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(!(b > r + 24 && b > g + 24), `${hex} reads as blue or purple`);
  }
});
