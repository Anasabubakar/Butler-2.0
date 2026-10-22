// Butler 2.0 building blocks for the website (Figma B2 · 06 Visual language & controls).
// Components use the B2 names from the brand guide: B2/Button, B2/Field, B2/Card, B2/Status,
// B2/Device, B2/Toggle. Styles live in b2-components.css and read the --b2-* tokens.

export class SignedOut extends Error {}

let onSignedOut: () => void = () => {};
/** What to show when the server says the session has ended. */
export function whenSignedOut(fn: () => void) { onSignedOut = fn; }

/** Calls the Butler server on the same site; the session cookie rides along. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = init.body && !(init.body instanceof FormData);
  const res = await fetch(path, {
    ...init,
    headers: json ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (res.status === 401 && path !== "/api/login") {
    onSignedOut();
    throw new SignedOut();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

type Child = Node | string | null | undefined | false;

/** Tiny DOM helper: text always goes through textContent, never innerHTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | EventListener>> = {},
  ...children: Child[]
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

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "Last seen" in words, for devices (B2 · 12). */
export function lastSeen(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "Last seen just now";
  if (s < 3600) return `Last seen ${Math.round(s / 60)} minutes ago`;
  if (s < 86400) {
    const hours = Math.round(s / 3600);
    return `Last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return `Last seen ${ago(iso)}`;
}

export const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- icons: one coherent line set, 1.75 px strokes (B2 · 06) ---------------------------------

const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  similar: '<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 0 0 2-2V9"/>',
  share: '<path d="M10 14 20 4M14 4h6v6"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  remind: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M5 4 3 6m16-2 2 2"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8v5m0 3.5v.01"/><circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M8 16 16 8M10 8h6v6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2Z"/>',
  devices: '<rect x="3" y="5" width="13" height="10" rx="1.5"/><path d="M1.5 18h16"/><rect x="17" y="9" width="5.5" height="11" rx="1.2"/>',
  chat: '<path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5Z"/>',
  library: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 4v16M3.5 9H8"/>',
  ring: '<path d="M6 8a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 14 6 8Z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>',
  google: '<circle cx="12" cy="12" r="9"/><path d="M12 12h5.5a5.5 5.5 0 1 1-1.6-3.9"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M15 6 9 12l6 6"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>',
};

export function icon(name: keyof typeof ICONS | string, label?: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "b2-icon");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? ""; // our own constant markup, never user text
  return svg;
}

// --- B2/Button ---------------------------------------------------------------------------------

export type ButtonKind = "primary" | "secondary" | "danger" | "ghost" | "quiet";

export function button(
  text: string,
  opts: { kind?: ButtonKind; icon?: string; onclick?: (e: MouseEvent) => unknown; type?: "button" | "submit"; title?: string; label?: string } = {},
): HTMLButtonElement {
  const b = h("button", {
    class: `b2-button b2-button--${opts.kind ?? "secondary"}`,
    type: opts.type ?? "button",
    title: opts.title,
    "aria-label": opts.label,
  }, opts.icon ? icon(opts.icon) : null, text ? h("span", {}, text) : null);
  if (opts.onclick) b.addEventListener("click", (e) => opts.onclick!(e));
  return b;
}

/** Shows a button as loading (B2 · 06 loading state) while `work` runs. */
export async function busy<T>(b: HTMLButtonElement, work: () => Promise<T>): Promise<T> {
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  try {
    return await work();
  } finally {
    b.disabled = false;
    b.removeAttribute("aria-busy");
  }
}

// --- B2/Field ------------------------------------------------------------------------------------

export function field(labelText: string, input: HTMLInputElement | HTMLTextAreaElement, hint?: string): HTMLLabelElement {
  input.classList.add("b2-input");
  return h("label", { class: "b2-field" },
    h("span", { class: "b2-field__label" }, labelText),
    input,
    hint ? h("span", { class: "b2-field__hint" }, hint) : null,
  );
}

/** An inline error that says how to recover (B2 · 06 Focus and feedback). */
export function inlineError(message: string): HTMLElement {
  return h("p", { class: "b2-error", role: "alert" }, icon("alert"), h("span", {}, message));
}

// --- B2/Card -------------------------------------------------------------------------------------

export function card(...children: Child[]): HTMLElement {
  return h("section", { class: "b2-card" }, ...children);
}

// --- B2/Status: states always pair a label with an icon (B2 · 02, B2 · 13) ---------------------

export type State = "connected" | "offline" | "queued" | "working" | "review" | "complete" | "failed" | "stopped";

const STATES: Record<State, { text: string; icon: string }> = {
  connected: { text: "Connected", icon: "check" },
  offline: { text: "Offline", icon: "clock" },
  queued: { text: "Queued", icon: "clock" },
  working: { text: "Working", icon: "clock" },
  review: { text: "Needs review", icon: "alert" },
  complete: { text: "Complete", icon: "check" },
  failed: { text: "Failed", icon: "alert" },
  stopped: { text: "Stopped", icon: "stop" },
};

export function status(state: State, text = STATES[state].text): HTMLElement {
  return h("span", { class: `b2-status b2-status--${state}`, role: "status" }, icon(STATES[state].icon), h("span", {}, text));
}

// --- B2/Toggle -------------------------------------------------------------------------------------

export function toggle(
  title: string, description: string, on: boolean, change: (on: boolean) => Promise<unknown> | void, scope?: string,
): HTMLElement {
  const input = h("input", { type: "checkbox", role: "switch", class: "b2-toggle__input" });
  input.checked = on;
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      await change(input.checked);
    } catch {
      input.checked = !input.checked; // it didn't save: show the real state
    } finally {
      input.disabled = false;
    }
  });
  return h("label", { class: "b2-toggle" },
    h("span", { class: "b2-toggle__text" },
      h("span", { class: "b2-toggle__title" }, title),
      h("span", { class: "b2-toggle__description" }, description),
      scope ? h("span", { class: "b2-toggle__scope" }, scope) : null,
    ),
    input,
    h("span", { class: "b2-toggle__track", "aria-hidden": "true" }, h("span", { class: "b2-toggle__thumb" })),
  );
}

// --- the brand lockup used in product headers (B2 · 08, 09) ------------------------------------

/** The app tile beside the product name, as the B2 screens show it in headers. */
export function lockup(size = 34): HTMLElement {
  return h("span", { class: "b2-lockup" },
    h("img", { class: "b2-lockup__tile", src: "/brand/butler-app-icon.svg", alt: "", width: String(size), height: String(size) }),
    h("span", { class: "b2-lockup__name" }, "Butler", h("small", {}, "2.0")),
  );
}

// --- toasts --------------------------------------------------------------------------------------

export function toast(message: string, action?: { text: string; run: () => void }, ms = 5000): HTMLElement {
  const t = h("div", { class: "b2-toast", role: action ? "status" : "alert" }, h("span", {}, message));
  if (action) {
    t.append(h("button", { onclick: () => { t.remove(); action.run(); } }, action.text));
  }
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
