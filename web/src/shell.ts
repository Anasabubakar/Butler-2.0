// The signed-in website's frame: a sidebar on a wide screen, an icon rail on a tablet, and a
// top bar with a tab bar along the bottom on a phone. Every page sits inside it.
import { applyTheme, local } from "./local";
import { api, button, h, icon, lockup, SignedOut, toast } from "./ui";

export type Page = "home" | "library" | "ask" | "recipes" | "automations" | "integrations" | "inbox" | "devices" | "settings";

interface Link { page: Page; text: string; icon: string }

const MAIN: Link[] = [
  { page: "home", text: "Home", icon: "home" },
  { page: "library", text: "Library", icon: "library" },
  { page: "ask", text: "Ask Butler", icon: "chat" },
  { page: "recipes", text: "Recipes", icon: "recipe" },
  { page: "automations", text: "Automations", icon: "bolt" },
  { page: "integrations", text: "Integrations", icon: "plug" },
  { page: "inbox", text: "Inbox", icon: "inbox" },
];
const FOOT: Link[] = [
  { page: "devices", text: "Devices", icon: "devices" },
  { page: "settings", text: "Settings", icon: "settings" },
];
/** The phone's tab bar: the four used most, and More for the rest. */
const TABS: Page[] = ["home", "library", "ask", "inbox"];

export const TITLES: Record<Page, string> = Object.fromEntries([...MAIN, ...FOOT].map((l) => [l.page, l.text])) as Record<Page, string>;

export const href = (page: Page) => (page === "home" ? "#/" : `#/${page}`);

// How many steps wait for your yes, shown on Inbox. Asked at most every 30 seconds.
let waiting = { n: 0, at: 0 };
async function waitingCount(): Promise<number> {
  if (Date.now() - waiting.at < 30_000) return waiting.n;
  const s = await api<{ waiting: unknown[] }>("/api/recipes").catch(() => ({ waiting: [] }));
  waiting = { n: s.waiting.length, at: Date.now() };
  return waiting.n;
}
/** Forget the count, after you answer one. */
export const recount = () => { waiting.at = 0; };

function navLink(l: Link, active: Page, cls: string): HTMLAnchorElement {
  const a = h("a", {
    href: href(l.page), class: l.page === active ? `${cls} active` : cls,
    "aria-current": l.page === active ? "page" : false, title: l.text,
  }, icon(l.icon), h("span", {}, l.text));
  if (l.page === "inbox") {
    waitingCount().then((n) => {
      if (n) a.append(h("span", { class: "badge", "aria-label": `${n} waiting for your yes` }, String(n)));
    });
  }
  return a;
}

/** Light or dark, flipped from wherever you are. */
function themeButton(cls: string): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls });
  const draw = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    b.replaceChildren(icon(dark ? "sun" : "moon"), h("span", {}, dark ? "Light mode" : "Dark mode"));
    b.title = dark ? "Switch to light mode" : "Switch to dark mode";
    b.setAttribute("aria-label", b.title);
  };
  b.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    local.set("theme", next);
    applyTheme(next);
    draw();
  });
  draw();
  return b;
}

/** Lost your phone? It rings loudly, even on silent, the next time it checks in. */
export async function ringPhone(b?: HTMLButtonElement) {
  if (b) b.disabled = true;
  try {
    toast((await api<{ say: string }>("/api/ring", { method: "POST", body: JSON.stringify({ target: "phone" }) })).say);
  } catch (e) {
    if (!(e instanceof SignedOut)) toast(`Couldn't ring your phone: ${(e as Error).message}`);
  } finally {
    if (b) b.disabled = false;
  }
}

/** The rest of the pages, in a sheet that rises from the tab bar. */
function moreSheet(active: Page) {
  const sheet = h("dialog", { class: "sheet", "aria-label": "More" },
    h("span", { class: "sheet__grabber", "aria-hidden": "true" }),
    h("nav", { class: "sheet__nav" },
      ...[...MAIN, ...FOOT].filter((l) => !TABS.includes(l.page)).map((l) => navLink(l, active, "sheet__link"))),
  );
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || (e.target as Element).closest("a")) sheet.close();
  });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

/** The frame around a page's content. */
export function shell(active: Page, ...content: Node[]): HTMLElement {
  document.title = `${TITLES[active]} · Butler`;
  const ring = button("Ring my phone", { kind: "quiet", icon: "ring", onclick: (e) => ringPhone(e.currentTarget as HTMLButtonElement) });
  ring.classList.add("side__link");

  const side = h("aside", { class: "side" },
    h("a", { class: "side__brand", href: href("home"), "aria-label": "Butler home" }, lockup(30)),
    h("nav", { class: "side__nav", "aria-label": "Butler" }, ...MAIN.map((l) => navLink(l, active, "side__link"))),
    h("div", { class: "side__foot" },
      ...FOOT.map((l) => navLink(l, active, "side__link")),
      ring,
      themeButton("side__link"),
    ),
  );

  const more = !TABS.includes(active);
  const tabbar = h("nav", { class: "tabbar", "aria-label": "Butler" },
    ...MAIN.filter((l) => TABS.includes(l.page)).map((l) => navLink(l, active, "tabbar__link")),
    h("button", { type: "button", class: more ? "tabbar__link active" : "tabbar__link", onclick: () => moreSheet(active) },
      icon("more"), h("span", {}, more ? TITLES[active] : "More")),
  );

  const top = h("header", { class: "phone-top" },
    h("a", { href: href("home"), "aria-label": "Butler home" }, h("img", { src: "/brand/butler-app-icon.svg", alt: "", width: "30", height: "30" })),
    h("span", { class: "phone-top__title" }, TITLES[active]),
    themeButton("icon-button phone-top__theme"),
  );

  return h("div", { class: "app" }, side, top, h("main", { class: "main", id: "main" }, ...content), tabbar);
}

/** A page's title block: a big serif title, a line under it, and actions on the right. */
export function head(title: string, lede?: string, ...actions: Node[]): HTMLElement {
  return h("header", { class: "page-head" },
    h("div", { class: "page-head__text" }, h("h1", {}, title), lede ? h("p", {}, lede) : null),
    actions.length ? h("div", { class: "page-head__actions" }, ...actions) : null,
  );
}

/** A page with a title block and its content. */
export function page(active: Page, title: string, lede: string, ...content: Node[]): HTMLElement {
  return shell(active, head(title, lede), ...content);
}
