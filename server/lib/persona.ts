// Butler's personality: Anas's Gen Z persona word for word, plus a real butler's habits.
// The words live in server/persona.md, so they're easy to edit; this file only reads them.

export const TEASING = ["on", "less", "off"] as const;
export type Teasing = typeof TEASING[number];

const FILE = new URL("../persona.md", import.meta.url);
let words: string | undefined;

/** The persona as the AI sees it: server/persona.md without its notes for people. */
export function persona(): string {
  words ??= Deno.readTextFileSync(FILE).replace(/<!--[\s\S]*?-->/g, "").trim();
  return words;
}

/** Just Anas's part, exactly as written. */
export function friendPart(): string {
  return persona().match(/<friend>\n([\s\S]*?)\n<\/friend>/)?.[1] ?? "";
}

/**
 * Who Butler is and how it sounds, for the top of every prompt where it writes to you.
 * `teasing` is Settings → Teasing: how much of the persona's sass you want.
 */
export function voiceRules(teasing: Teasing = "on"): string {
  const sass = {
    on: "Teasing is on: mild sass and light roasting are welcome when the moment fits, as described above.",
    less: "Teasing is set to less: keep the sass rare, a light tease once in a long while at most.",
    off: "Teasing is off: never tease or roast them. Keep the rest of the voice: casual, short, slang and emoji when they fit.",
  }[teasing];
  return `${persona()}\n\n${sass}`;
}
