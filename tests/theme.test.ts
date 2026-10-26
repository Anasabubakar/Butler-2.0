import { test } from "node:test";
import assert from "node:assert/strict";

// The colour tokens, read from the stylesheet itself so this test can't drift from it.
const css = await Deno.readTextFile(new URL("../web/src/theme.css", import.meta.url));
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in theme.css`);
  return css.slice(start, css.indexOf("}", start));
};
const themes = { light: block(":root"), dark: block(':root[data-theme="dark"]') };

function token(theme: keyof typeof themes, name: string): string {
  const m = themes[theme].match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`no --${name} colour in the ${theme} theme`);
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

const SURFACES = ["bg", "surface", "surface-2"];
const TINTS = ["tint-lavender", "tint-sky", "tint-mint", "tint-peach", "tint-butter", "tint-rose"];

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: body and muted text are readable on every surface and tint`, () => {
    for (const bg of [...SURFACES, ...TINTS]) {
      assert.ok(contrast(token(theme, "text"), token(theme, bg)) >= 7, `text on ${bg}`);
      assert.ok(contrast(token(theme, "muted"), token(theme, bg)) >= 4.5, `muted on ${bg}`);
    }
  });

  test(`${theme}: status colours are readable on their soft backgrounds`, () => {
    for (const s of ["accent", "danger", "success", "warn"]) {
      assert.ok(contrast(token(theme, s), token(theme, `${s}-soft`)) >= 4.5, `${s} on ${s}-soft`);
      assert.ok(contrast(token(theme, s), token(theme, "surface")) >= 4.5, `${s} on surface`);
    }
  });

  test(`${theme}: primary buttons are readable`, () => {
    assert.ok(contrast(token(theme, "primary"), token(theme, "on-primary")) >= 7);
    assert.ok(contrast(token(theme, "danger"), token(theme, "on-primary")) >= 4.5);
  });
}
