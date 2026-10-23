import "./fonts";
import "./b2-tokens.css";
import "./style.css";
import { openConnections } from "./connections";
import { openRecipes } from "./recipes";
import { binMarkup, crumpleIntoBin, fasten, glide, hashOf, layout, makeDraggable, type Spot, unfasten } from "./board";

class SignedOut extends Error {}

/** Calls the Butler server on the same site; the session cookie rides along. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (res.status === 401 && path !== "/api/login") {
    renderSignIn();
    throw new SignedOut();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

interface Item {
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
  board_x: number | null;
  board_y: number | null;
  board_tilt: number | null;
  price?: string | null;
  price_first?: string | null;
  price_currency?: string | null;
  archive_url?: string | null;
  link_dead?: boolean;
  share_token?: string | null;
  details?: string | null;
}

interface Facet { facet: "category" | "platform" | "tag"; value: string; n: number }

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

const app = document.querySelector<HTMLDivElement>("#app")!;

// --- tiny DOM helper: text always goes through textContent, never innerHTML ---
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | EventListener>> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const NAMES: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", github: "GitHub", x: "X",
  web: "Web", none: "Notes & files", unsorted: "Unsorted",
};
const label = (s: string) => NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// --- sign in ---------------------------------------------------------------

function renderSignIn(message = "") {
  const password = h("input", {
    type: "password", placeholder: "Password", required: true, autocomplete: "current-password", "aria-label": "Password",
  });
  const status = h("p", { class: "muted" }, message);
  const form = h("form", { class: "signin" },
    h("h1", {}, butlerLogo()),
    h("p", { class: "muted" }, "Everything you've saved, in one place."),
    password,
    h("button", { type: "submit" }, "Open library"),
    status,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password: password.value }) });
      renderLibrary();
    } catch (err) {
      status.textContent = (err as Error).message;
      password.select();
    }
  });
  app.replaceChildren(form);
  password.focus();
}

// The Butler 2.0 logo masters live in web/public/brand. Use the files as they are:
// dark mark on light surfaces, the ink app tile on dark ones (never invert the art).

/** Mascot and "Butler 2.0" lettering; swaps to the app tile in dark mode. */
function butlerLogo(): HTMLPictureElement {
  return h("picture", { class: "logo" },
    h("source", { srcset: "/brand/butler-app-icon.svg", media: "(prefers-color-scheme: dark)" }),
    h("img", { src: "/brand/butler-primary.svg", alt: "Butler 2.0" }),
  );
}

/** The app tile alone, for small spots like the header. */
function butlerTile(label: string): HTMLImageElement {
  return h("img", { class: "logo small", src: "/brand/butler-app-icon.svg", alt: label });
}

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
    if (!(err instanceof SignedOut)) showError((err as Error).message);
  } finally {
    state.loading = false;
  }
}

let pollTimer: number | undefined;
function pollWhilePending() {
  clearTimeout(pollTimer);
  if (!state.items.some((i) => i.status === "pending")) return;
  pollTimer = window.setTimeout(async () => {
    const ids = state.items.filter((i) => i.status === "pending").map((i) => i.id);
    const data = await api<Item[]>(`/api/items?ids=${ids.join(",")}`).catch(() => [] as Item[]);
    for (const fresh of data) {
      const i = state.items.findIndex((x) => x.id === fresh.id);
      if (i >= 0) state.items[i] = fresh;
    }
    if (data.some((d) => d.status !== "pending")) { await loadFacets(); renderSidebar(); }
    renderGrid();
    pollWhilePending();
  }, 5000);
}

// --- library -----------------------------------------------------------------

let gridEl: HTMLElement;
let sidebarEl: HTMLElement;
let headingEl: HTMLElement;

function renderLibrary() {
  const search = h("input", {
    type: "search", class: "search", placeholder: "Search titles, notes, tags, links…", "aria-label": "Search",
  });
  let debounce: number | undefined;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => { state.q = search.value.trim(); refresh(); }, 250);
  });

  const signOut = h("button", {
    class: "ghost",
    onclick: async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); renderSignIn(); },
  }, "Sign out");

  const googleButton = h("button", { class: "ghost", hidden: true });
  renderGoogle(googleButton);

  // Lost your phone? It rings loudly, even on silent, the next time it checks in.
  const ringButton = h("button", {
    class: "ghost ring", title: "Make your phone ring loudly, even on silent",
    onclick: async () => {
      ringButton.disabled = true;
      try {
        showError((await api<{ say: string }>("/api/ring", { method: "POST", body: JSON.stringify({ target: "phone" }) })).say);
      } catch (e) {
        if (!(e instanceof SignedOut)) showError(`Couldn't ring your phone: ${(e as Error).message}`);
      } finally {
        ringButton.disabled = false;
      }
    },
  }, "Ring my phone");

  // Other services' tools (MCP) that Ask Butler can use.
  const connectionsButton = h("button", {
    class: "ghost", title: "Connect other services, like Zapier, so Ask Butler can use their tools",
    onclick: () => openConnections(api, h, ago),
  }, "Connections");

  // Saved instructions that Ask Butler runs by name, and steps waiting for your yes.
  const recipesButton = h("button", {
    class: "ghost", title: "Save instructions once and run them by name",
    onclick: () => openRecipes(api, h, ago),
  }, "Recipes");

  sidebarEl = h("nav", { class: "sidebar", "aria-label": "Collections" });
  headingEl = h("h2", { class: "heading" });
  gridEl = h("section", { class: "boards" });
  binEl?.remove();
  binEl = h("div", { class: "bin", title: "Drag a note here to throw it away", "aria-label": "Bin" });
  binEl.innerHTML = binMarkup();
  document.body.append(binEl);

  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "#", onclick: (e) => { e.preventDefault(); setFilter(null); } },
        butlerTile("Butler 2.0 library")),
      search,
      googleButton,
      recipesButton,
      connectionsButton,
      ringButton,
      signOut,
    ),
    h("main", { class: "layout" }, sidebarEl, h("div", { class: "content" }, headingEl, gridEl)),
  );
  refresh(true);
}

// --- Google: lets Ask Butler add calendar events and send email as you ---------------

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  backup: { at: string; ok: boolean; note: string } | null;
}

async function renderGoogle(button: HTMLButtonElement) {
  const result = new URLSearchParams(location.search).get("google");
  if (result) {
    history.replaceState(null, "", location.pathname);
    if (result === "failed") alert("Connecting Google didn't work. Try again.");
  }
  const status = await api<GoogleStatus>("/api/google/status").catch(() => null);
  if (!status?.configured) return; // the server has no Google client set up
  button.hidden = false;
  button.textContent = status.connected ? `Google: ${status.email ?? "connected"}` : "Connect Google";
  const backup = status.backup
    ? `\nBackup ${new Date(status.backup.at).toLocaleString()}: ${status.backup.ok ? "" : "failed, "}${status.backup.note}`
    : "";
  button.title = (status.connected
    ? "Butler can add calendar events, send email you approve, and back up to your Drive. Click to disconnect."
    : "Let Ask Butler add calendar events and send email you approve") + backup;
  if (status.connected && status.backup && !status.backup.ok) button.textContent += " ⚠";
  button.onclick = async () => {
    if (!status.connected) {
      location.href = "/api/google/connect";
      return;
    }
    if (!confirm("Disconnect Google? Ask Butler won't be able to add events or send email.")) return;
    await api("/api/google/disconnect", { method: "POST" }).catch(() => {});
    renderGoogle(button);
  };
}

async function refresh(withFacets = false) {
  gridEl.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  state.meaning = [];
  const q = state.q;
  await Promise.all([
    loadItems(true),
    withFacets ? loadFacets() : null,
    q ? api<Item[]>(`/api/meaning?q=${encodeURIComponent(q)}`).then((found) => {
      if (state.q === q) state.meaning = found;
    }).catch(() => {}) : null,
  ]);
  renderSidebar();
  renderGrid();
  pollWhilePending();
}

function setFilter(f: Filter) {
  state.filter = state.filter && f && state.filter.facet === f.facet && state.filter.value === f.value ? null : f;
  refresh();
}

function renderSidebar() {
  const group = (facet: Facet["facet"], title: string) => {
    const rows = state.facets.filter((f) => f.facet === facet).sort((a, b) => b.n - a.n);
    if (!rows.length) return null;
    return h("div", { class: "group" },
      h("h3", {}, title),
      h("ul", {}, ...rows.map((r) => {
        const active = state.filter?.facet === facet && state.filter.value === r.value;
        return h("li", {},
          h("button", { class: active ? "chip active" : "chip", onclick: () => setFilter({ facet, value: r.value }) },
            facet === "tag" ? `#${r.value}` : label(r.value),
            h("span", { class: "count" }, String(r.n)),
          ),
        );
      })),
    );
  };
  sidebarEl.replaceChildren(
    ...[group("category", "Collections"), group("platform", "From"), group("tag", "Tags")].filter(Boolean) as Node[],
  );
}

// --- the board: every save is a sticky note -----------------------------------------------

let binEl: HTMLElement;
interface Board { el: HTMLElement; notes: { el: HTMLElement; item: Item }[]; movable: boolean }
let boards: Board[] = [];

/** Notes only stay where you stuck them on the full board; searches and filters line them up. */
const onFullBoard = () => !state.q && !state.filter;

const spotOf = (item: Item): Spot | null =>
  item.board_x === null || item.board_y === null ? null : { x: item.board_x, y: item.board_y, tilt: item.board_tilt ?? 0 };

function relayout(animate = false) {
  const all = boards.flatMap((b) => b.notes.map((n) => n.el));
  const before = animate ? new Map(all.map((el) => [el, el.getBoundingClientRect()])) : null;
  for (const b of boards) layout(b.el, b.notes.map((n) => ({ el: n.el, spot: b.movable ? spotOf(n.item) : null })));
  if (before) glide(all, before);
}

let relayoutSoon = 0;
function relayoutLater() {
  cancelAnimationFrame(relayoutSoon);
  relayoutSoon = requestAnimationFrame(() => relayout());
}
addEventListener("resize", relayoutLater);

function renderGrid() {
  const f = state.filter;
  const what = f ? (f.facet === "tag" ? `#${f.value}` : label(f.value)) : "Everything";
  const anyStuck = onFullBoard() && state.items.some((i) => i.board_x !== null);
  headingEl.replaceChildren(state.q ? `${what} matching “${state.q}”` : what);
  if (anyStuck) headingEl.append(h("button", { class: "ghost tidy", onclick: tidyUp, title: "Put every note back in rows" }, "Tidy up"));

  const shown = new Set(state.items.map((i) => i.id));
  const alike = state.meaning.filter((i) => !shown.has(i.id));
  boards = [];

  if (!state.items.length && !alike.length) {
    gridEl.replaceChildren(
      h("div", { class: "empty" },
        h("p", {}, state.q || f ? "Nothing matches that yet." : "Nothing saved yet."),
        h("p", { class: "muted" }, "On your phone, use Share → Save to Butler from any app."),
      ),
    );
    return;
  }
  const parts: Node[] = [];
  if (state.items.length) parts.push(makeBoard(state.items, onFullBoard()));
  if (!state.done) {
    parts.push(h("button", {
      class: "more",
      onclick: async () => { await loadItems(false); renderGrid(); pollWhilePending(); },
    }, "Load more"));
  }
  if (alike.length) parts.push(h("h3", { class: "section" }, "Close in meaning"), makeBoard(alike, false));
  gridEl.replaceChildren(...parts);
  relayout();
}

function makeBoard(items: Item[], movable: boolean): HTMLElement {
  const el = h("div", { class: movable ? "board movable" : "board" });
  const board: Board = { el, notes: [], movable };
  for (const item of items) {
    const n = note(item);
    makeDraggable(n, el, binEl, {
      canDrag: () => movable,
      onPlace: (_note, spot) => {
        Object.assign(item, { board_x: spot.x, board_y: spot.y, board_tilt: spot.tilt });
        api(`/api/items/${item.id}/place`, { method: "PUT", body: JSON.stringify(spot) })
          .catch((err) => { if (!(err instanceof SignedOut)) showError((err as Error).message); });
        if (!headingEl.querySelector(".tidy")) renderGrid();
      },
      onTrash: () => throwAway(item),
      onOpen: (_note, tapped) => {
        // A saved picture opens right here; a screenshot that came with a link opens the
        // link, unless you tapped the picture itself.
        if (item.kind === "image" && item.file_path && (!item.url || tapped.closest(".media"))) {
          viewPicture(item);
          return;
        }
        const target = openTarget(item);
        if (target) window.open(target, "_blank", "noopener,noreferrer");
      },
    });
    board.notes.push({ el: n, item });
    el.append(n);
  }
  boards.push(board);
  return el;
}

/** Puts every note back in rows: the pins come out, they glide home, and get stuck again. */
async function tidyUp() {
  const notes = boards.flatMap((b) => b.notes.map((n) => n.el));
  notes.forEach(unfasten);
  try {
    await api("/api/board/tidy", { method: "POST" });
  } catch (err) {
    if (!(err instanceof SignedOut)) showError((err as Error).message);
    notes.forEach(fasten);
    return;
  }
  for (const i of state.items) Object.assign(i, { board_x: null, board_y: null, board_tilt: null });
  headingEl.querySelector(".tidy")?.remove();
  relayout(true);
  notes.forEach((el, i) => setTimeout(() => fasten(el), 500 + Math.min(i, 30) * 25));
}

// --- public links ------------------------------------------------------------------------

/** Makes a link anyone can open to see this one note, and hands it over (share sheet or clipboard). */
async function shareNote(item: Item) {
  let url: string;
  try {
    url = (await api<{ url: string }>(`/api/items/${item.id}/share`, { method: "POST" })).url;
  } catch (e) {
    if (!(e instanceof SignedOut)) showError(`Couldn't make a link: ${(e as Error).message}`);
    return;
  }
  item.share_token = url.split("/").pop() ?? "shared";
  document.querySelector(`.note[data-id="${item.id}"]`)?.classList.add("shared");
  let how = "Link copied.";
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: item.title ?? "A note", url });
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
  const toast = h("div", { class: "toast undo", role: "status" },
    `${how} Anyone with it can see this note.`,
    h("button", {
      onclick: async () => {
        toast.remove();
        await api(`/api/items/${item.id}/share`, { method: "DELETE" }).catch(() => {});
        item.share_token = null;
        document.querySelector(`.note[data-id="${item.id}"]`)?.classList.remove("shared");
        showError("Stopped sharing. The link no longer works.");
      },
    }, "Stop sharing"),
  );
  document.body.append(toast);
  setTimeout(() => toast.remove(), 8000);
}

// --- snooze: bring a note back later as a reminder -------------------------------------

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

function snooze(item: Item, button: HTMLElement) {
  document.querySelector(".snooze")?.remove();
  const close = () => {
    menu.remove();
    removeEventListener("pointerdown", outside, true);
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const menu = h("div", { class: "snooze", role: "menu" },
    h("p", {}, "Remind me…"),
    ...laterTimes().map(([label, time]) =>
      h("button", {
        role: "menuitem",
        onclick: async () => {
          close();
          try {
            await api(`/api/items/${item.id}/remind`, { method: "POST", body: JSON.stringify({ at: time.toISOString() }) });
            showError(`I'll bring “${item.title ?? "this"}” back ${when.format(time)} on all your devices.`);
          } catch (e) {
            if (!(e instanceof SignedOut)) showError(`Couldn't set that: ${(e as Error).message}`);
          }
        },
      }, h("span", {}, label), h("small", {}, when.format(time)))),
  );
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
  menu.style.top = `${r.bottom + menu.offsetHeight + 8 < innerHeight ? r.bottom + 6 : r.top - menu.offsetHeight - 6}px`;
  addEventListener("pointerdown", outside, true);
}

/** The note is in the bin. It's really deleted a few seconds later, unless you press Undo. */
function throwAway(item: Item) {
  const at = state.items.findIndex((i) => i.id === item.id);
  if (at >= 0) state.items.splice(at, 1);
  state.meaning = state.meaning.filter((i) => i.id !== item.id);
  for (const b of boards) b.notes = b.notes.filter((n) => n.item.id !== item.id);
  relayout(true);

  let undone = false;
  const forget = () => {
    clearTimeout(timer);
    removeEventListener("pagehide", forget);
    toast.remove();
    if (undone) return;
    fetch(`/api/items/${item.id}`, { method: "DELETE", keepalive: true })
      .then(() => loadFacets().then(renderSidebar))
      .catch(() => showError("Couldn't delete that. Try again."));
  };
  const toast = h("div", { class: "toast undo", role: "status" },
    `“${item.title ?? "Note"}” is in the bin.`,
    h("button", {
      onclick: () => {
        undone = true;
        forget();
        state.items.splice(Math.max(0, at), 0, item);
        renderGrid();
      },
    }, "Undo"),
  );
  document.body.append(toast);
  const timer = setTimeout(forget, 5000);
  addEventListener("pagehide", forget);
}

/** Shows the items closest in meaning to `item`. */
async function showSimilar(item: Item) {
  headingEl.replaceChildren(
    h("button", { class: "ghost back", onclick: () => renderGrid() }, "← Back"),
    ` Like “${item.title ?? "this"}”`,
  );
  gridEl.replaceChildren(h("p", { class: "muted" }, "Looking…"));
  try {
    const found = await api<Item[]>(`/api/items/${item.id}/similar`);
    boards = [];
    gridEl.replaceChildren(found.length ? makeBoard(found, false) : h("p", { class: "muted" }, "Nothing close to this yet."));
    relayout();
  } catch (err) {
    if (!(err instanceof SignedOut)) showError((err as Error).message);
  }
}

function openTarget(item: Item): string | null {
  if (item.link_dead && item.archive_url) return item.archive_url; // the original is gone
  if (item.url) return item.url;
  if (item.file_path) return `/files/${item.id}`;
  return null;
}

/** Shows a saved picture over the board, as big as fits. Esc, ×, or a tap outside it closes it. */
function viewPicture(item: Item) {
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
      h("button", { class: "viewer-close", "aria-label": "Close", title: "Close (Esc)" }, "×"),
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

function media(item: Item): HTMLElement | null {
  const file = item.file_path ? `/files/${item.id}` : undefined;
  let el: HTMLElement | null = null;
  if (item.kind === "image" && file) el = h("img", { src: file, alt: item.title ?? "", loading: "lazy", draggable: "false" });
  else if (item.kind === "video" && file) {
    el = h("video", { src: file + "#t=0.1", preload: "metadata", muted: true, playsinline: true, controls: true });
  } else if (item.thumbnail) {
    el = h("img", { src: item.thumbnail, alt: "", loading: "lazy", referrerpolicy: "no-referrer", draggable: "false" });
  }
  // Pictures change a note's height once they arrive, so the board re-settles.
  el?.addEventListener(el.tagName === "VIDEO" ? "loadedmetadata" : "load", relayoutLater, { once: true });
  // A missing file or a dead thumbnail shouldn't leave a broken picture on the note.
  el?.addEventListener("error", () => {
    el?.closest(".media")?.remove();
    relayoutLater();
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
    class: "source",
    href: item.url,
    target: "_blank",
    rel: "noopener noreferrer",
    title: item.url,
    onclick: (e) => e.stopPropagation(),
  }, `\u2197 ${shown}`);
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
  return h("p", { class: `price${was ? " down" : ""}`, title: "Butler checks this price twice a day" },
    fmt(item.price), was ? h("s", {}, fmt(was)) : null);
}

/** Butler's longer notes (like a video's key points), folded away until you ask. */
function keyPoints(details: string): HTMLElement {
  const [summary, ...points] = details.split("\n").map((l) => l.trim()).filter(Boolean);
  const list = h("div", { class: "points", hidden: true },
    h("p", {}, summary),
    points.length ? h("ul", {}, ...points.map((p) => h("li", {}, p.replace(/^[•\-*]\s*/, "")))) : null,
  );
  const toggle = h("button", {
    class: "points-toggle",
    "aria-expanded": "false",
    onclick: (e) => {
      e.stopPropagation();
      list.hidden = !list.hidden;
      toggle.setAttribute("aria-expanded", String(!list.hidden));
      toggle.textContent = list.hidden ? "▸ Key points" : "▾ Key points";
      relayoutLater();
    },
  }, "▸ Key points");
  return h("div", {}, toggle, list);
}

const COLORS = 6;

function note(item: Item): HTMLElement {
  const pic = media(item);
  const title = item.title ?? item.url ?? item.body?.slice(0, 80) ?? "Untitled";
  const color = hashOf(item.category ?? item.kind) % COLORS; // one color per collection
  const pinned = hashOf(item.id) % 3 === 0; // most get tape, some get a pin
  let el: HTMLElement;

  const del = h("button", {
    class: "icon",
    "aria-label": "Delete",
    title: "Throw away",
    onclick: (e) => {
      e.stopPropagation();
      crumpleIntoBin(el, binEl).then(() => throwAway(item));
    },
  }, "×");

  const paper = h("div", { class: "paper" },
    pic ? h("div", { class: "media" }, pic) : null,
    h("h4", {}, title),
    item.status === "pending" ? h("p", { class: "muted pending" }, "Organizing…") : null,
    item.status === "failed" ? h("p", { class: "muted" }, "Couldn't organize this one.") : null,
    item.summary ? h("p", { class: "summary" }, item.summary) : null,
    item.note ? h("p", { class: "note-text" }, item.note) : null,
    sourceLink(item),
    priceTag(item),
    item.link_dead
      ? h("p", { class: "rescued" }, item.archive_url ? "The original page is gone. This opens a saved copy." : "The original page is gone.")
      : null,
    !item.summary && item.body ? h("p", { class: "summary" }, item.body.slice(0, 240)) : null,
    item.details ? keyPoints(item.details) : null,
    item.tags.length
      ? h("div", { class: "tags" }, ...item.tags.map((t) =>
          h("button", { class: "tag", onclick: (e) => { e.stopPropagation(); setFilter({ facet: "tag", value: t }); } }, `#${t}`)))
      : null,
    h("div", { class: "meta" },
      item.platform ? h("span", { class: "badge" }, label(item.platform)) : h("span", { class: "badge" }, label(item.kind)),
      h("span", { class: "muted" }, ago(item.created_at)),
      h("button", {
        class: "icon",
        "aria-label": "Find similar",
        title: "Find similar",
        onclick: (e) => { e.stopPropagation(); showSimilar(item); },
      }, "≈"),
      h("button", {
        class: "icon",
        "aria-label": "Share a link to this note",
        title: "Share a link to this note",
        onclick: (e) => { e.stopPropagation(); shareNote(item); },
      }, "🔗"),
      h("button", {
        class: "icon",
        "aria-label": "Remind me later",
        title: "Remind me later",
        onclick: (e) => { e.stopPropagation(); snooze(item, e.currentTarget as HTMLElement); },
      }, "⏰"),
      del,
    ),
  );
  const fastener = pinned
    ? h("span", { class: "pin", "aria-hidden": "true" })
    : h("span", { class: "tape", "aria-hidden": "true" }, h("i"), h("i"));
  if (!pinned) fastener.style.setProperty("--tape-tilt", `${(hashOf(item.id + "t") % 16) - 8}deg`);
  el = h("div", {
    class: `note c${color}${openTarget(item) ? " opens" : ""}${item.share_token ? " shared" : ""}`,
    "data-id": item.id,
    role: openTarget(item) ? "link" : "article",
    title: openTarget(item) ? "Click to open · drag to move" : "Drag to move",
  }, fastener, paper);
  return el;
}

function showError(message: string) {
  const toast = h("div", { class: "toast", role: "alert" }, message);
  document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}

// --- boot ----------------------------------------------------------------------

api("/api/me").then(renderLibrary, () => {});
