import { createClient, type Session } from "@supabase/supabase-js";
import "./style.css";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

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
}

interface Facet { facet: "category" | "platform" | "tag"; value: string; n: number }

type Filter = { facet: Facet["facet"]; value: string } | null;

const PAGE = 40;
const state = {
  q: "",
  filter: null as Filter,
  items: [] as Item[],
  facets: [] as Facet[],
  signed: new Map<string, string>(),
  done: false,
  loading: false,
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
  const email = h("input", { type: "email", placeholder: "you@example.com", required: true, autocomplete: "email" });
  const status = h("p", { class: "muted" }, message);
  const form = h("form", { class: "signin" },
    h("div", { class: "logo" }, butlerMark()),
    h("h1", {}, "Butler"),
    h("p", { class: "muted" }, "Everything you've saved, in one place."),
    email,
    h("button", { type: "submit" }, "Email me a sign-in link"),
    status,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({
      email: email.value.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    status.textContent = error ? error.message : "Check your email for the link.";
  });
  app.replaceChildren(form);
}

function butlerMark(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.innerHTML =
    '<path d="M8 40a16 16 0 0 1 32 0z" fill="var(--accent)"/>' +
    '<circle cx="19" cy="32" r="2" fill="var(--bg)"/><circle cx="29" cy="32" r="2" fill="var(--bg)"/>';
  return svg;
}

// --- data --------------------------------------------------------------------

async function loadFacets() {
  const { data, error } = await supabase.rpc("item_facets");
  state.facets = error ? [] : (data as Facet[]);
}

async function loadItems(reset: boolean) {
  if (state.loading) return;
  state.loading = true;
  if (reset) { state.items = []; state.done = false; }

  let query = supabase.from("items").select("*").order("created_at", { ascending: false }).limit(PAGE);
  const last = state.items.at(-1);
  if (last) query = query.lt("created_at", last.created_at);
  if (state.q) query = query.textSearch("search", state.q, { type: "websearch", config: "simple" });
  const f = state.filter;
  if (f?.facet === "category") query = f.value === "unsorted" ? query.is("category", null) : query.eq("category", f.value);
  if (f?.facet === "platform") query = f.value === "none" ? query.is("platform", null) : query.eq("platform", f.value);
  if (f?.facet === "tag") query = query.contains("tags", [f.value]);

  const { data, error } = await query;
  state.loading = false;
  if (error) { showError(error.message); return; }
  const rows = data as Item[];
  state.items.push(...rows);
  state.done = rows.length < PAGE;
  await signFiles(rows);
}

async function signFiles(rows: Item[]) {
  const paths = rows.map((r) => r.file_path).filter((p): p is string => !!p && !state.signed.has(p));
  if (!paths.length) return;
  const { data } = await supabase.storage.from("items").createSignedUrls(paths, 60 * 60);
  for (const s of data ?? []) if (s.path && s.signedUrl) state.signed.set(s.path, s.signedUrl);
}

let pollTimer: number | undefined;
function pollWhilePending() {
  clearTimeout(pollTimer);
  if (!state.items.some((i) => i.status === "pending")) return;
  pollTimer = window.setTimeout(async () => {
    const ids = state.items.filter((i) => i.status === "pending").map((i) => i.id);
    const { data } = await supabase.from("items").select("*").in("id", ids);
    for (const fresh of (data ?? []) as Item[]) {
      const i = state.items.findIndex((x) => x.id === fresh.id);
      if (i >= 0) state.items[i] = fresh;
    }
    if (data?.some((d) => d.status !== "pending")) { await loadFacets(); renderSidebar(); }
    renderGrid();
    pollWhilePending();
  }, 5000);
}

// --- library -----------------------------------------------------------------

let gridEl: HTMLElement;
let sidebarEl: HTMLElement;
let headingEl: HTMLElement;

function renderLibrary(session: Session) {
  const search = h("input", {
    type: "search", class: "search", placeholder: "Search titles, notes, tags, links…", "aria-label": "Search",
  });
  let debounce: number | undefined;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => { state.q = search.value.trim(); refresh(); }, 250);
  });

  const signOut = h("button", { class: "ghost", onclick: () => supabase.auth.signOut() }, "Sign out");
  signOut.title = session.user.email ?? "";

  sidebarEl = h("nav", { class: "sidebar", "aria-label": "Collections" });
  headingEl = h("h2", { class: "heading" });
  gridEl = h("section", { class: "grid" });

  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "#", onclick: (e) => { e.preventDefault(); setFilter(null); } },
        h("span", { class: "logo small" }, butlerMark()), "Butler"),
      search,
      signOut,
    ),
    h("main", { class: "layout" }, sidebarEl, h("div", { class: "content" }, headingEl, gridEl)),
  );
  refresh(true);
}

async function refresh(withFacets = false) {
  gridEl.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  await Promise.all([loadItems(true), withFacets ? loadFacets() : null]);
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

function renderGrid() {
  const f = state.filter;
  const what = f ? (f.facet === "tag" ? `#${f.value}` : label(f.value)) : "Everything";
  headingEl.textContent = state.q ? `${what} matching “${state.q}”` : what;

  if (!state.items.length) {
    gridEl.replaceChildren(
      h("div", { class: "empty" },
        h("p", {}, state.q || f ? "Nothing matches that yet." : "Nothing saved yet."),
        h("p", { class: "muted" }, "On your phone, use Share → Save to Butler from any app."),
      ),
    );
    return;
  }
  const cards = state.items.map(card);
  if (!state.done) {
    cards.push(h("button", {
      class: "more",
      onclick: async () => { await loadItems(false); renderGrid(); pollWhilePending(); },
    }, "Load more"));
  }
  gridEl.replaceChildren(...cards);
}

function openTarget(item: Item): string | null {
  if (item.url) return item.url;
  if (item.file_path) return state.signed.get(item.file_path) ?? null;
  return null;
}

function media(item: Item): HTMLElement | null {
  const file = item.file_path ? state.signed.get(item.file_path) : undefined;
  if (item.kind === "image" && file) return h("img", { src: file, alt: item.title ?? "", loading: "lazy" });
  if (item.kind === "video" && file) {
    return h("video", { src: file + "#t=0.1", preload: "metadata", muted: true, playsinline: true });
  }
  if (item.thumbnail) {
    return h("img", { src: item.thumbnail, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  }
  return null;
}

function card(item: Item): HTMLElement {
  const target = openTarget(item);
  const pic = media(item);
  const title = item.title ?? item.url ?? item.body?.slice(0, 80) ?? "Untitled";

  const del = h("button", {
    class: "icon",
    "aria-label": "Delete",
    title: "Delete",
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`Delete “${title}”?`)) return;
      const { error } = await supabase.from("items").delete().eq("id", item.id);
      if (error) return showError(error.message);
      if (item.file_path) await supabase.storage.from("items").remove([item.file_path]);
      state.items = state.items.filter((i) => i.id !== item.id);
      renderGrid();
      loadFacets().then(renderSidebar);
    },
  }, "×");

  const body = h("div", { class: "card-body" },
    h("div", { class: "meta" },
      item.platform ? h("span", { class: "badge" }, label(item.platform)) : h("span", { class: "badge" }, label(item.kind)),
      h("span", { class: "muted" }, ago(item.created_at)),
      del,
    ),
    h("h4", {}, title),
    item.status === "pending" ? h("p", { class: "muted pending" }, "Organizing…") : null,
    item.status === "failed" ? h("p", { class: "muted" }, "Couldn't organize this one.") : null,
    item.summary ? h("p", { class: "summary" }, item.summary) : null,
    item.note ? h("p", { class: "note" }, item.note) : null,
    !item.summary && item.body ? h("p", { class: "summary" }, item.body.slice(0, 240)) : null,
    item.tags.length
      ? h("div", { class: "tags" }, ...item.tags.map((t) =>
          h("button", { class: "tag", onclick: (e) => { e.preventDefault(); e.stopPropagation(); setFilter({ facet: "tag", value: t }); } }, `#${t}`)))
      : null,
  );

  const inner = [pic ? h("div", { class: "media" }, pic) : null, body];
  return target
    ? h("a", { class: "card", href: target, target: "_blank", rel: "noopener noreferrer" }, ...inner)
    : h("article", { class: "card" }, ...inner);
}

function showError(message: string) {
  const toast = h("div", { class: "toast", role: "alert" }, message);
  document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}

// --- boot ----------------------------------------------------------------------

let current: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user.id ?? null;
  if (id === current && app.childElementCount) return;
  current = id;
  if (session) renderLibrary(session);
  else renderSignIn();
});
