// Butler's personality: Anas's Gen Z persona word for word, plus a real butler's habits.
// The words live in server/persona.md, so they're easy to edit; this file only reads them.

export const TEASING = ["on", "less", "off"] as const;
export type Teasing = typeof TEASING[number];

const FILE = new URL("../persona.md", import.meta.url);
let words: string | undefined;

/** What Butler calls its owner now and then (BUTLER_TITLE): "ser" unless set, "" for none. */
export function title(): string {
  const set = (Deno.env.get("BUTLER_TITLE") ?? "ser").trim().slice(0, 30);
  return set.toLowerCase() === "none" ? "" : set;
}

/** `text` with the owner's title on the end, like "morning, ser", or as it is when there's none. */
export const addressed = (text: string) => title() ? `${text}, ${title()}` : text;

/** The persona as the AI sees it: server/persona.md without its notes for people, title filled in. */
export function persona(): string {
  words ??= Deno.readTextFileSync(FILE).replace(/<!--[\s\S]*?-->/g, "").trim();
  const t = title();
  return t ? words.replaceAll("{title}", t) : words.split("\n").filter((line) => !line.includes("{title}")).join("\n");
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
