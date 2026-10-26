// The library: every save as a card in a Bento grid, with search (by words and by meaning),
// collection filters, and each card's actions: find similar, share, remind me later, delete.
import { href, head, shell } from "./shell";
import { ago, api, button, fill, h, icon, iconButton, SignedOut, toast } from "./ui";

export interface Item {
  id: string;
  created_at: string;
  device: string;
  kind: "link" | "image" | "video" | "text" | "file";
  url: string | null;
  body: string | null;
  note: string | null;
  file_path: string | null;
  mime: string | null;
  thumbnail: string | null;
  platform: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
  category: string | null;
  status: "pending" | "organized" | "failed";
  price?: string | null;
  price_first?: string | null;
  price_currency?: string | null;
  archive_url?: string | null;
  link_dead?: boolean;
  share_token?: string | null;
  details?: string | null;
}

export interface Facet { facet: "category" | "platform" | "tag"; value: string; n: number }

type Filter = { facet: Facet["facet"]; value: string } | null;

const PAGE = 40;
const state = {
  q: "",
  filter: null as Filter,
  items: [] as Item[],
  facets: [] as Facet[],
  done: false,
  loading: false,
  meaning: [] as Item[], // close in meaning to the search, without the exact words
};

const NAMES: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", github: "GitHub", x: "X",
  web: "Web", none: "Notes & files", unsorted: "Unsorted",
};
export const label = (s: string) => NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

/** A small, steady number from text, so a collection keeps its colour. */
export function hashOf(s: string): number {
  let n = 0;
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}
export const TINTS = 6;
export const tintOf = (item: Pick<Item, "category" | "kind">) => hashOf(item.category ?? item.kind) % TINTS;

// --- data --------------------------------------------------------------------

async function loadFacets() {
  state.facets = await api<Facet[]>("/api/facets").catch(() => []);
}

async function loadItems(reset: boolean) {
  if (state.loading) return;
  state.loading = true;
  if (reset) { state.items = []; state.done = false; }

  const params = new URLSearchParams({ limit: String(PAGE) });
  const last = state.items.at(-1);
  if (last) params.set("before", last.created_at);
  if (state.q) params.set("q", state.q);
  if (state.filter) params.set(state.filter.facet, state.filter.value);

  try {
    const rows = await api<Item[]>(`/api/items?${params}`);
    state.items.push(...rows);
    state.done = rows.length < PAGE;
  } catch (err) {
    if (!(err instanceof SignedOut)) toast((err as Error).message);
  } finally {
    state.loading = false;
  }
}

let pollTimer: number | undefined;
function pollWhilePending() {
  clearTimeout(pollTimer);
  if (!state.items.some((i) => i.status === "pending")) return;
  pollTimer = window.setTimeout(async () => {
    if (!gridEl?.isConnected) return; // you left the library
    const ids = state.items.filter((i) => i.status === "pending").map((i) => i.id);
    const data = await api<Item[]>(`/api/items?ids=${ids.join(",")}`).catch(() => [] as Item[]);
    for (const fresh of data) {
      const i = state.items.findIndex((x) => x.id === fresh.id);
      if (i >= 0) state.items[i] = fresh;
    }
    if (data.some((d) => d.status !== "pending")) { await loadFacets(); renderFilters(); }
    renderGrid();
    pollWhilePending();
  }, 5000);
}

// --- the page ------------------------------------------------------------------

let gridEl: HTMLElement;
let filtersEl: HTMLElement;
let headingEl: HTMLElement;

export function renderLibrary(app: HTMLElement) {
  const wanted = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const category = wanted.get("collection");
  if (category) state.filter = { facet: "category", value: category };
  if (wanted.has("q")) state.q = wanted.get("q") ?? "";

  const search = h("input", {
    type: "search", class: "search__input", placeholder: "Search titles, notes, tags and links, or describe what you mean…",
    "aria-label": "Search your library", value: state.q,
  });
  let debounce: number | undefined;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => { state.q = search.value.trim(); refresh(); }, 250);
  });

  filtersEl = h("div", { class: "filters" });
  headingEl = h("div", { class: "section-title" });
  gridEl = h("section", { class: "saves-wrap", "aria-live": "polite" });

  app.replaceChildren(shell("library",
    head("Library", "Everything you've saved, organised by Butler. Search by words or by meaning.",
      h("a", { class: "b2-button b2-button--secondary", href: href("ask") }, icon("chat"), h("span", {}, "Ask about your saves"))),
    h("label", { class: "search" }, icon("search"), search),
    filtersEl,
    headingEl,
    gridEl,
  ));
  refresh(true);
}

async function refresh(withFacets = false) {
  gridEl.replaceChildren(skeleton());
  state.meaning = [];
  const q = state.q;
  await Promise.all([
    loadItems(true),
    withFacets ? loadFacets() : null,
    q ? api<Item[]>(`/api/meaning?q=${encodeURIComponent(q)}`).then((found) => {
      if (state.q === q) state.meaning = found;
    }).catch(() => {}) : null,
  ]);
  renderFilters();
  renderGrid();
  pollWhilePending();
}

/** Grey cards while the first page loads. */
function skeleton(): HTMLElement {
  return h("div", { class: "saves-skeleton", "aria-hidden": "true" }, ...Array.from({ length: 6 }, () => h("div", { class: "save save--ghost" })));
}

const TOP_COLLECTIONS = 12;
let showAllCollections = false;

function setFilter(f: Filter) {
  state.filter = state.filter && f && state.filter.facet === f.facet && state.filter.value === f.value ? null : f;
  refresh();
}

function renderFilters() {
  const rows = (facet: Facet["facet"]) => state.facets.filter((f) => f.facet === facet).sort((a, b) => b.n - a.n);
  const pill = (facet: Facet["facet"], value: string, n: number) => {
    const active = state.filter?.facet === facet && state.filter.value === value;
    return h("button", { type: "button", class: "pill", "aria-pressed": String(active), onclick: () => setFilter({ facet, value }) },
      facet === "tag" ? `#${value}` : label(value), h("span", { class: "count" }, String(n)));
  };
  const collections = rows("category");
  const total = collections.reduce((sum, r) => sum + r.n, 0);
  const tag = state.filter?.facet === "tag" ? state.filter.value : null;
  // Collections are specific ("AI CRM", "Nigerian Recipes"), so there can be dozens:
  // the biggest show first, and the rest wait behind "more" (the one you picked always shows).
  const picked = (r: Facet) => state.filter?.facet === "category" && state.filter.value === r.value;
  const hidden = showAllCollections ? [] : collections.slice(TOP_COLLECTIONS).filter((r) => !picked(r));
  const more = hidden.length
    ? h("button", { type: "button", class: "pill pill--dashed", onclick: () => { showAllCollections = true; renderFilters(); } },
      `${hidden.length} more`)
    : null;
  fill(filtersEl,
    h("div", { class: "pills pills--wrap", role: "group", "aria-label": "Collections" },
      h("button", { type: "button", class: "pill", "aria-pressed": String(!state.filter), onclick: () => { state.filter = null; refresh(); } },
        "All", total ? h("span", { class: "count" }, String(total)) : null),
      ...collections.filter((r) => !hidden.includes(r)).map((r) => pill("category", r.value, r.n)),
      more,
    ),
    rows("platform").length || tag
      ? h("div", { class: "pills pills--scroll pills--quiet", role: "group", "aria-label": "Where from" },
        h("span", { class: "filters__label" }, "From"),
        ...rows("platform").map((r) => pill("platform", r.value, r.n)),
        tag ? h("button", { type: "button", class: "pill active", onclick: () => setFilter(null), title: "Clear this tag" },
          `#${tag}`, icon("close")) : null)
      : null,
  );
}

function renderGrid() {
  const f = state.filter;
  const what = f ? (f.facet === "tag" ? `#${f.value}` : label(f.value)) : "Everything";
  headingEl.replaceChildren(h("span", {}, state.q ? `${what} matching “${state.q}”` : what));
  if (state.items.length) headingEl.append(h("span", { class: "muted" }, `${state.items.length}${state.done ? "" : "+"} saves`));

  const shown = new Set(state.items.map((i) => i.id));
  const alike = state.meaning.filter((i) => !shown.has(i.id));

  if (!state.items.length && !alike.length) {
    gridEl.replaceChildren(
      h("div", { class: "empty" },
        icon(state.q || f ? "search" : "library"),
        h("h3", {}, state.q || f ? "Nothing matches that yet." : "Nothing saved yet, sir."),
        h("p", {}, state.q || f
          ? "Try other words, or ask Butler: it searches by meaning too."
          : "On your phone, use Share → Save to Butler from any app."),
      ),
    );
    return;
  }
  const parts: Node[] = [];
  if (state.items.length) parts.push(grid(state.items));
  if (!state.done) {
    const more = button("Load more", {
      kind: "secondary",
      onclick: async () => { more.disabled = true; await loadItems(false); renderGrid(); pollWhilePending(); },
    });
    more.classList.add("saves-more");
    parts.push(more);
  }
  if (alike.length) parts.push(h("h2", { class: "section-title" }, icon("sparkle"), "Close in meaning"), grid(alike));
  gridEl.replaceChildren(...parts);
}

/**
 * Cards in columns, each card going to the shortest column, so cards of different heights
 * pack tightly. The columns are redone when the width changes how many fit.
 */
function grid(items: Item[]): HTMLElement {
  const cards = items.map(card);
  const el = h("div", { class: "saves" });
  let count = 0;
  const place = () => {
    const width = el.clientWidth;
    if (!width) return;
    const gap = innerWidth < 760 ? 12 : 16;
    const min = innerWidth <= 420 ? width : innerWidth < 760 ? 160 : 272;
    const n = Math.max(1, Math.floor((width + gap) / (min + gap)));
    if (n === count) return;
    count = n;
    const columns = Array.from({ length: n }, () => h("div", { class: "saves__col" }));
    el.replaceChildren(...columns);
    const heights = columns.map(() => 0);
    for (const c of cards) {
      const i = heights.indexOf(Math.min(...heights));
      columns[i].append(c);
      heights[i] = columns[i].offsetHeight;
    }
  };
  new ResizeObserver(place).observe(el);
  return el;
}

/** A save's title, or something short that says what it is while Butler organises it. */
export function titleOf(item: Item): string {
  if (item.title) return item.title;
  if (item.url) {
    try {
      const u = new URL(item.url);
      return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
    } catch { return item.url; }
  }
  return item.body?.slice(0, 80) || "Untitled";
}

// --- sharing by link -------------------------------------------------------------------

/** Makes a link anyone can open to see this one save, and hands it over (share sheet or clipboard). */
async function shareNote(item: Item) {
  let url: string;
  try {
    url = (await api<{ url: string }>(`/api/items/${item.id}/share`, { method: "POST" })).url;
  } catch (e) {
    if (!(e instanceof SignedOut)) toast(`Couldn't make a link: ${(e as Error).message}`);
    return;
  }
  item.share_token = url.split("/").pop() ?? "shared";
  document.querySelector(`.save[data-id="${item.id}"]`)?.classList.add("shared");
  let how = "Link copied.";
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: item.title ?? "A save", url });
      how = "Shared.";
    } catch { /* closed the share sheet: still copy it */ }
  }
  if (how !== "Shared.") {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      how = url; // no clipboard here: show the link itself
    }
  }
  toast(`${how} Anyone with it can see this save.`, {
    text: "Stop sharing",
    run: async () => {
      await api(`/api/items/${item.id}/share`, { method: "DELETE" }).catch(() => {});
      item.share_token = null;
      document.querySelector(`.save[data-id="${item.id}"]`)?.classList.remove("shared");
      toast("Stopped sharing. The link no longer works.");
    },
  }, 8000);
}

// --- remind me later ------------------------------------------------------------------

/** Sensible "later"s from now, in this browser's time zone. */
function laterTimes(now = new Date()): [string, Date][] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  const times: [string, Date][] = [["In an hour", new Date(now.getTime() + 3_600_000)]];
  if (now.getHours() < 19) times.push(["This evening", at(0, 20)]);
  times.push(["Tomorrow morning", at(1, 9)]);
  times.push([day === 6 || day === 0 ? "Next weekend" : "This weekend", at((6 - day + 7) % 7 || 7, 10)]);
  times.push(["Next week", at((8 - day) % 7 || 7, 9)]);
  return times;
}

function snooze(item: Item, from: HTMLElement) {
  document.querySelector(".snooze")?.remove();
  const close = () => {
    menu.remove();
    removeEventListener("pointerdown", outside, true);
    removeEventListener("keydown", onKey);
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const menu = h("div", { class: "snooze", role: "menu" },
    h("p", {}, "Remind me…"),
    ...laterTimes().map(([text, time]) =>
      h("button", {
        role: "menuitem",
        onclick: async () => {
          close();
          try {
            await api(`/api/items/${item.id}/remind`, { method: "POST", body: JSON.stringify({ at: time.toISOString() }) });
            toast(`I'll bring “${item.title ?? "this"}” back ${when.format(time)} on all your devices.`);
          } catch (e) {
            if (!(e instanceof SignedOut)) toast(`Couldn't set that: ${(e as Error).message}`);
          }
        },
      }, h("span", {}, text), h("small", {}, when.format(time)))),
  );
  document.body.append(menu);
  const r = from.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
  menu.style.top = `${r.bottom + menu.offsetHeight + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - menu.offsetHeight - 6)}px`;
  (menu.querySelector("button") as HTMLButtonElement).focus();
  addEventListener("pointerdown", outside, true);
  addEventListener("keydown", onKey);
}

/** Takes the save away now; it's really deleted a few seconds later, unless you press Undo. */
function throwAway(item: Item, el: HTMLElement) {
  el.classList.add("leaving");
  const at = state.items.findIndex((i) => i.id === item.id);
  setTimeout(() => {
    if (at >= 0) state.items.splice(state.items.indexOf(item), 1);
    state.meaning = state.meaning.filter((i) => i.id !== item.id);
    if (gridEl.contains(el)) renderGrid();
  }, 180);

  let undone = false;
  const forget = () => {
    clearTimeout(timer);
    removeEventListener("pagehide", forget);
    bar.remove();
    if (undone) return;
    fetch(`/api/items/${item.id}`, { method: "DELETE", keepalive: true })
      .then(() => loadFacets().then(renderFilters))
      .catch(() => toast("That didn't delete. Try again."));
  };
  const bar = toast(`“${item.title ?? "Save"}” deleted.`, {
    text: "Undo",
    run: () => {
      undone = true;
      forget();
      if (!state.items.includes(item)) state.items.splice(Math.max(0, at), 0, item);
      renderGrid();
    },
  }, 60_000);
  const timer = setTimeout(forget, 5000);
  addEventListener("pagehide", forget);
}

/** Shows the saves closest in meaning to `item`. */
async function showSimilar(item: Item) {
  headingEl.replaceChildren(
    button("Back", { kind: "ghost", small: true, icon: "back", onclick: () => renderGrid() }),
    h("span", {}, `Like “${item.title ?? "this"}”`),
  );
  gridEl.replaceChildren(skeleton());
  scrollTo({ top: 0, behavior: "smooth" });
  try {
    const found = await api<Item[]>(`/api/items/${item.id}/similar`);
    gridEl.replaceChildren(found.length ? grid(found) : h("div", { class: "empty" }, h("p", {}, "Nothing close to this yet.")));
  } catch (err) {
    if (!(err instanceof SignedOut)) toast((err as Error).message);
  }
}

export function openTarget(item: Item): string | null {
  if (item.link_dead && item.archive_url) return item.archive_url; // the original is gone
  if (item.url) return item.url;
  if (item.file_path) return `/files/${item.id}`;
  return null;
}

/** Opens a save: a picture here, anything else in a new tab. */
export function openItem(item: Item, tapped?: Element) {
  // A screenshot that came with a link opens the link, unless you tapped the picture itself.
  if (item.kind === "image" && item.file_path && (!item.url || tapped?.closest(".save__media"))) {
    viewPicture(item);
    return;
  }
  const target = openTarget(item);
  if (target) window.open(target, "_blank", "noopener,noreferrer");
}

/** Shows a saved picture as big as fits. Esc, ×, or a tap outside it closes it. */
export function viewPicture(item: Item) {
  const src = `/files/${item.id}`;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    view.classList.add("leaving");
    setTimeout(() => view.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 130);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const img = h("img", { src, alt: item.title ?? "", draggable: "false" });
  // Tap the picture to see it at full size (and scroll around), tap again to fit it back.
  img.addEventListener("click", (e) => { e.stopPropagation(); view.classList.toggle("zoomed"); });
  const view = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": item.title ?? "Picture" },
    h("div", { class: "viewer-bar" },
      h("span", { class: "viewer-title" }, item.title ?? ""),
      item.url ? h("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", title: "Open the post" }, "Open post") : null,
      h("a", { href: src, download: "", title: "Download" }, "Download"),
      h("button", { class: "viewer-close", "aria-label": "Close", title: "Close (Esc)" }, icon("close")),
    ),
    h("div", { class: "viewer-stage" }, img),
  );
  view.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t === view || t.classList.contains("viewer-stage") || t.closest(".viewer-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(view);
  view.querySelector<HTMLButtonElement>(".viewer-close")?.focus();
}

export function media(item: Item): HTMLElement | null {
  const file = item.file_path ? `/files/${item.id}` : undefined;
  let el: HTMLElement | null = null;
  if (item.kind === "image" && file) el = h("img", { src: file, alt: item.title ?? "", loading: "lazy", draggable: "false" });
  else if (item.kind === "video" && file) {
    el = h("video", { src: file + "#t=0.1", preload: "metadata", muted: true, playsinline: true, controls: true });
  } else if (item.thumbnail) {
    el = h("img", { src: item.thumbnail, alt: "", loading: "lazy", referrerpolicy: "no-referrer", draggable: "false" });
  }
  // A missing file or a dead thumbnail shouldn't leave a broken picture on the card.
  el?.addEventListener("error", () => {
    const box = el?.closest(".save__media, .mini__media");
    box?.closest(".save")?.classList.add("save--text");
    box?.remove();
  }, { once: true });
  return el;
}

/** The post's own link on a saved screenshot or file, so you can see it was kept and open it. */
function sourceLink(item: Item): HTMLElement | null {
  if (!item.url || item.kind === "link" || item.kind === "text") return null;
  let shown = item.url;
  try {
    const u = new URL(item.url);
    shown = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
  } catch { /* keep it as saved */ }
  return h("a", {
    class: "save__source", href: item.url, target: "_blank", rel: "noopener noreferrer", title: item.url,
    onclick: (e) => e.stopPropagation(),
  }, icon("link"), h("span", {}, shown));
}

/** A saved product's price, with what it was when you saved it if it has dropped. */
function priceTag(item: Item): HTMLElement | null {
  if (!item.price || !item.price_currency) return null;
  const fmt = (v: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: item.price_currency!, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 })
        .format(Number(v));
    } catch {
      return `${Number(v).toLocaleString()} ${item.price_currency}`;
    }
  };
  const was = item.price_first && Number(item.price_first) > Number(item.price) ? item.price_first : null;
  return h("p", { class: `save__price${was ? " down" : ""}`, title: "Butler checks this price twice a day" },
    fmt(item.price), was ? h("s", {}, fmt(was)) : null);
}

/** Butler's longer notes (like a video's key points), folded away until you ask. */
function keyPoints(details: string): HTMLElement {
  const [summary, ...points] = details.split("\n").map((l) => l.trim()).filter(Boolean);
  const box = h("details", { class: "save__points", onclick: (e) => e.stopPropagation() },
    h("summary", {}, "Key points"),
    h("p", {}, summary),
    points.length ? h("ul", {}, ...points.map((p) => h("li", {}, p.replace(/^[•\-*]\s*/, "")))) : null,
  );
  return box;
}

function card(item: Item): HTMLElement {
  const pic = media(item);
  const title = titleOf(item);
  const opens = Boolean(openTarget(item));
  const el = h("article", {
    class: `save t${tintOf(item)}${pic ? "" : " save--text"}${opens ? " opens" : ""}${item.share_token ? " shared" : ""}`,
    "data-id": item.id,
  });

  const where = label(item.platform ?? item.kind);
  fill(el,
    pic ? h("div", { class: "save__media" }, pic, h("span", { class: "save__badge" }, where)) : null,
    h("div", { class: "save__body" },
      h("div", { class: "save__top" },
        item.category ? h("button", {
          type: "button", class: "save__collection", title: `Show ${label(item.category)}`,
          onclick: (e) => { e.stopPropagation(); setFilter({ facet: "category", value: item.category! }); },
        }, label(item.category)) : null,
        h("span", { class: "save__shared", title: "Shared by link" }, icon("link")),
      ),
      // The title opens the save, so keyboards and screen readers can open it too.
      h("h3", { class: "save__title" }, opens
        ? h("a", { href: openTarget(item)!, target: "_blank", rel: "noopener noreferrer", onclick: (e) => { e.preventDefault(); e.stopPropagation(); openItem(item); } }, title)
        : title),
      item.status === "pending" ? h("p", { class: "save__pending" }, icon("sparkle"), "Organising…") : null,
      item.status === "failed" ? h("p", { class: "muted small" }, "Couldn't organise this one. It's still saved.") : null,
      // Summaries are labelled as Butler's, so they're never mistaken for your own words.
      item.summary ? h("p", { class: "save__summary", title: "Summary written by Butler" }, h("span", { class: "b2-sr" }, "Butler's summary: "), item.summary) : null,
      !item.summary && item.body ? h("p", { class: "save__summary" }, item.body.slice(0, 240)) : null,
      item.note ? h("p", { class: "save__note" }, item.note) : null,
      sourceLink(item),
      priceTag(item),
      item.link_dead
        ? h("p", { class: "save__rescued" }, item.archive_url ? "The original page is gone. This opens a saved copy." : "The original page is gone.")
        : null,
      item.details ? keyPoints(item.details) : null,
      item.tags.length
        ? h("div", { class: "save__tags" }, ...item.tags.slice(0, 6).map((t) =>
          h("button", { type: "button", class: "save__tag", onclick: (e) => { e.stopPropagation(); setFilter({ facet: "tag", value: t }); } }, `#${t}`)))
        : null,
    ),
    h("footer", { class: "save__foot" },
      h("span", { class: "save__meta" }, pic ? ago(item.created_at) : `${where} · ${ago(item.created_at)}`),
      h("span", { class: "save__actions" },
        iconButton("similar", "Find similar", () => showSimilar(item)),
        iconButton("share", "Share a link to this save", () => shareNote(item)),
        iconButton("remind", "Remind me later", (e) => snooze(item, e.currentTarget as HTMLElement)),
        iconButton("trash", "Delete", () => throwAway(item, el)),
      ),
    ),
  );
  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("a, button, video, details")) return;
    if (getSelection()?.toString()) return; // you were selecting text
    openItem(item, t);
  });
  return el;
}
