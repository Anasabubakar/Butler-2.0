// The signed-in website's frame: the header from B2 · 09 (lockup, search, Google status,
// Ring my phone) plus links to Ask Butler, Devices and Settings.
import { api, button, h, icon, lockup, SignedOut, toast } from "./ui";

export type Page = "library" | "ask" | "devices" | "settings";

const PAGES: { page: Page; text: string; icon: string }[] = [
  { page: "library", text: "Library", icon: "library" },
  { page: "ask", text: "Ask Butler", icon: "chat" },
  { page: "devices", text: "Devices", icon: "devices" },
  { page: "settings", text: "Settings", icon: "settings" },
];

export const href = (page: Page) => (page === "library" ? "#/" : `#/${page}`);

interface GoogleStatus { configured: boolean; connected: boolean; email: string | null }

/** The header. `middle` is the library's search box; other pages leave it empty. */
export function topBar(active: Page, middle?: Node): HTMLElement {
  const google = h("a", { class: "top__google", href: href("devices"), hidden: true });
  api<GoogleStatus>("/api/google/status").then((s) => {
    if (!s.configured) return;
    google.hidden = false;
    google.replaceChildren(icon("google"), h("span", {}, s.connected ? "Google connected" : "Connect Google"));
    google.title = s.connected ? `Connected as ${s.email ?? "your Google account"}` : "Connect Google on the Devices page";
  }).catch(() => {});

  // Lost your phone? It rings loudly, even on silent, the next time it checks in.
  const ring = button("Ring my phone", {
    kind: "quiet", icon: "ring", title: "Make your phone ring loudly, even on silent",
    onclick: async () => {
      ring.disabled = true;
      try {
        toast((await api<{ say: string }>("/api/ring", { method: "POST", body: JSON.stringify({ target: "phone" }) })).say);
      } catch (e) {
        if (!(e instanceof SignedOut)) toast(`Couldn't ring your phone: ${(e as Error).message}`);
      } finally {
        ring.disabled = false;
      }
    },
  });
  ring.classList.add("top__ring");

  return h("header", { class: "top" },
    h("a", { class: "brand", href: href("library"), "aria-label": "Butler 2.0 library" }, lockup(34)),
    middle ?? h("span", { class: "top__spacer" }),
    h("nav", { class: "top__nav", "aria-label": "Butler" },
      ...PAGES.map((p) => h("a", {
        href: href(p.page), class: p.page === active ? "top__link active" : "top__link",
        "aria-current": p.page === active ? "page" : false, title: p.text,
      }, icon(p.icon), h("span", {}, p.text))),
    ),
    google,
    ring,
  );
}

/** A page with the header, a title block and its content (for Ask, Devices and Settings). */
export function page(active: Page, title: string, lede: string, ...content: Node[]): HTMLElement {
  return h("div", { class: "shell" },
    topBar(active),
    h("main", { class: "page" },
      h("header", { class: "page__head" },
        h("span", { class: "b2-rule", "aria-hidden": "true" }),
        h("h1", {}, title),
        h("p", {}, lede),
      ),
      ...content,
    ),
  );
}
