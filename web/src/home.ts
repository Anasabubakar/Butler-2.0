// Home: a Bento dashboard. Ask Butler first, then what's new: recent saves, your inbox,
// collections, automations and devices, each linking to its own page.
import { deviceTitle } from "./devices";
import { type Facet, type Item, label, media, openItem, openTarget, tintOf } from "./library";
import { href, ringPhone, shell } from "./shell";
import { ago, api, button, h, icon, status } from "./ui";

interface Device { name: string; kind: "phone" | "laptop"; last_seen: string }
interface RecipeRow { id: string; name: string; schedule: string; run_at: string | null; email_query: string | null; has_hook: boolean; last_run_at: string | null }
interface Recipes { recipes: RecipeRow[]; waiting: unknown[] }
export interface Sent {
  id: string;
  from_device: string;
  kind: "reminder" | "note" | "link" | "file";
  body: string | null;
  url: string | null;
  due_at: string;
  to_devices: string[];
}

const ONLINE_MS = 2 * 60_000;

/** "Good morning" by this browser's clock. */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 5 ? "Up late, sir?" : hour < 12 ? "Good morning, sir." : hour < 18 ? "Good afternoon, sir." : "Good evening, sir.";
}

const IDEAS = ["What did I save this week?", "Remind me at 6pm to call Mum", "Find that jollof recipe", "What's on my calendar today?"];

export async function renderHome(app: HTMLElement) {
  const input = h("input", { type: "text", placeholder: "Ask Butler, or tell him what to do…", "aria-label": "Ask Butler", autocomplete: "off" });
  const ask = h("form", { class: "home-ask__box" }, icon("sparkle"), input,
    button("", { kind: "primary", type: "submit", icon: "send", label: "Send" }));
  ask.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    location.hash = q ? `#/ask?q=${encodeURIComponent(q)}` : "#/ask";
  });

  const stats = h("div", { class: "stats" }, ...["Saves", "Collections", "Devices online", "Automations"].map((t) => stat("…", t)));
  const recent = slot("recent");
  const inbox = slot("inbox");
  const collections = slot("collections");
  const automations = slot("automations");
  const devices = slot("devices");

  app.replaceChildren(shell("home",
    h("section", { class: "bento" },
      h("div", { class: "tile tile--8 tile--lavender home-ask" },
        h("p", { class: "home-ask__date" }, new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })),
        h("h1", { class: "home-ask__title" }, greeting()),
        ask,
        h("div", { class: "pills" }, ...IDEAS.map((idea) =>
          h("button", { type: "button", class: "pill", onclick: () => { input.value = idea; input.focus(); } }, idea))),
      ),
      h("div", { class: "tile tile--4" }, tileHead("At a glance", "sparkle"), stats),
      h("div", { class: "tile tile--8" }, tileHead("Recently saved", "library", { text: "Library", to: href("library") }), recent),
      h("div", { class: "tile tile--4 tile--butter" }, tileHead("Inbox", "inbox", { text: "Open", to: href("inbox") }), inbox),
      h("div", { class: "tile tile--4" }, tileHead("Collections", "filter", { text: "All", to: href("library") }), collections),
      h("div", { class: "tile tile--4 tile--mint" }, tileHead("Automations", "bolt", { text: "Manage", to: href("automations") }), automations),
      h("div", { class: "tile tile--4 tile--sky" }, tileHead("Devices", "devices", { text: "Details", to: href("devices") }), devices),
    ),
  ));

  const [items, facets, recipes, sent, devs] = await Promise.all([
    api<Item[]>("/api/items?limit=8").catch(() => null),
    api<Facet[]>("/api/facets").catch(() => [] as Facet[]),
    api<Recipes>("/api/recipes").catch(() => null),
    api<Sent[]>("/api/messages").catch(() => [] as Sent[]),
    api<Device[]>("/api/devices").catch(() => [] as Device[]),
  ]);

  const cats = facets.filter((f) => f.facet === "category").sort((a, b) => b.n - a.n);
  const online = devs.filter((d) => Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS);
  stats.replaceChildren(
    stat(String(cats.reduce((s, f) => s + f.n, 0)), "Saves"),
    stat(String(cats.length), "Collections"),
    stat(devs.length ? `${online.length}/${devs.length}` : "0", "Devices online"),
    stat(String(recipes?.recipes.length ?? 0), "Automations"),
  );

  recent.replaceChildren(items?.length
    ? h("div", { class: "minis" }, ...items.map(mini))
    : empty("Nothing saved yet. On your phone, use Share → Save to Butler from any app."));

  const waiting = recipes?.waiting.length ?? 0;
  inbox.replaceChildren(
    waiting ? h("a", { class: "home-waiting", href: href("inbox") }, icon("alert"),
      h("span", {}, `${waiting} ${waiting === 1 ? "step waits" : "steps wait"} for your yes`), icon("chevron")) : null,
    sent.length
      ? h("ul", { class: "rows" }, ...sent.slice(0, waiting ? 3 : 4).map(sentRow))
      : waiting ? null : empty("Notes and reminders Butler sends your devices show up here."),
  );

  collections.replaceChildren(cats.length
    ? h("div", { class: "pills" }, ...cats.slice(0, 10).map((c) =>
      h("a", { class: "pill", href: `#/library?collection=${encodeURIComponent(c.value)}` }, label(c.value), h("span", { class: "count" }, String(c.n)))))
    : empty("Butler sorts each save into a collection as it comes in."));

  automations.replaceChildren(recipes?.recipes.length
    ? h("ul", { class: "rows" }, ...recipes.recipes.slice(0, 4).map((r) =>
      h("li", { class: "row" },
        h("span", { class: "row__icon" }, icon(r.email_query ? "mail" : r.run_at ? "clock" : r.has_hook ? "link" : "play")),
        h("span", { class: "row__text" },
          h("span", { class: "row__title" }, r.name),
          h("span", { class: "row__sub" }, [r.run_at ? r.schedule : r.email_query ? "On new email" : r.has_hook ? "From its link" : "When you ask",
            r.last_run_at ? `ran ${ago(r.last_run_at)}` : "not run yet"].join(" · "))),
      )))
    : h("div", { class: "tile__cta" }, empty("Save an instruction once and Butler runs it on a schedule, on email, or when you ask."),
      h("a", { class: "b2-button b2-button--secondary b2-button--small", href: href("recipes") }, icon("plus"), h("span", {}, "Create a recipe"))));

  const phone = devs.find((d) => d.kind === "phone");
  devices.replaceChildren(devs.length
    ? h("ul", { class: "rows" }, ...devs.slice(0, 3).map((d) => {
      const on = online.includes(d);
      return h("li", { class: "row" },
        h("span", { class: "row__icon" }, icon(d.kind)),
        h("span", { class: "row__text" }, h("span", { class: "row__title" }, deviceTitle(d, devs)), h("span", { class: "row__sub" }, on ? "Online now" : `Seen ${ago(d.last_seen)}`)),
        status(on ? "connected" : "offline", on ? "Online" : "Offline"));
    }))
    : empty("Open Butler on your phone or laptop once and it appears here."));
  if (phone) devices.append(button("Ring my phone", { kind: "secondary", small: true, icon: "ring", onclick: (e) => ringPhone(e.currentTarget as HTMLButtonElement) }));
}

function slot(name: string): HTMLElement {
  return h("div", { class: `tile__body home-${name}` }, h("p", { class: "tile__empty" }, "Loading…"));
}

function tileHead(title: string, iconName: string, link?: { text: string; to: string }): HTMLElement {
  return h("div", { class: "tile__head" }, icon(iconName), h("h2", {}, title),
    link ? h("a", { href: link.to }, link.text, icon("chevron")) : null);
}

function stat(value: string, text: string): HTMLElement {
  return h("div", { class: "stat" }, h("strong", {}, value), h("span", {}, text));
}

function empty(text: string): HTMLElement {
  return h("p", { class: "tile__empty" }, text);
}

/** A small card for a recent save. */
function mini(item: Item): HTMLElement {
  const pic = media(item);
  const title = item.title ?? item.url ?? item.body?.slice(0, 80) ?? "Untitled";
  const el = h("button", {
    type: "button", class: `mini t${tintOf(item)}`, title: openTarget(item) ? `Open “${title}”` : title,
    onclick: (e) => openItem(item, e.target as Element),
  },
  pic ? h("span", { class: "mini__media" }, pic) : h("span", { class: "mini__media mini__media--text" }, icon(item.kind === "link" ? "link" : "note")),
  h("span", { class: "mini__title" }, title),
  h("span", { class: "mini__meta" }, `${item.category ? label(item.category) : label(item.platform ?? item.kind)} · ${ago(item.created_at)}`),
  );
  return el;
}

const SENT_ICONS: Record<Sent["kind"], string> = { reminder: "clock", note: "note", link: "link", file: "download" };

export function sentRow(m: Sent): HTMLElement {
  const later = new Date(m.due_at).getTime() > Date.now();
  const when = later
    ? `Due ${new Date(m.due_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
    : ago(m.due_at);
  const text = m.body?.trim() || m.url || "A file";
  return h("li", { class: "row" },
    h("span", { class: "row__icon" }, icon(SENT_ICONS[m.kind] ?? "note")),
    h("span", { class: "row__text" }, h("span", { class: "row__title" }, text), h("span", { class: "row__sub" }, when)),
  );
}
