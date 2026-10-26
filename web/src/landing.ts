// The signed-out website: what Butler does, as a Bento grid, and the sign-in card.
// Claims only describe what Butler does today.
import { api, button, field, h, icon, inlineError, lockup, busy } from "./ui";

const app = () => document.querySelector<HTMLDivElement>("#app")!;

const FEATURES: [string, string, string, string][] = [
  ["library", "Save what matters", "Share a link, a post or a screenshot from your phone. Butler keeps the source, writes a summary and files it in a collection.", "lavender"],
  ["search", "Find it again", "Search by words or by meaning, or just ask: “that jollof recipe I saved last week.”", "sky"],
  ["recipe", "Recipes", "Write an instruction once and run it by name, on a schedule, or when an email arrives.", "mint"],
  ["devices", "Across your devices", "Your phone and laptop share one Butler: send things between them and ring a lost phone.", "peach"],
  ["inbox", "Nothing without your yes", "Anything that sends, changes or deletes waits for you to say yes.", "butter"],
  ["plug", "Integrations", "Google Calendar and Gmail, plus any MCP service like Zapier or Notion.", "rose"],
];

/** The landing page. `signIn` opens the sign-in card. */
export function renderLanding(signIn: () => void) {
  document.title = "Butler · Already handled, sir.";
  app().replaceChildren(h("div", { class: "landing" },
    h("header", { class: "landing-nav" },
      h("a", { href: "/", class: "landing-nav__brand", "aria-label": "Butler home" }, lockup(34)),
      h("nav", { class: "landing-nav__links", "aria-label": "Site" }, h("a", { href: "#explore" }, "What it does")),
      button("Sign in", { kind: "primary", onclick: signIn }),
    ),
    h("main", {},
      h("section", { class: "landing-hero" },
        h("p", { class: "landing-eyebrow" }, icon("sparkle"), "Your personal assistant, everywhere"),
        h("h1", {}, "Already handled, sir."),
        h("p", { class: "landing-lede" }, "Save what matters, find it when you need it, and let Butler handle the little things across your phone and laptop."),
        h("div", { class: "landing-actions" },
          button("Open Butler", { kind: "primary", onclick: signIn }),
          button("See what it does", { kind: "secondary", onclick: () => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" }) }),
        ),
      ),
      h("section", { class: "landing-bento", id: "explore", "aria-label": "What Butler does" },
        ...FEATURES.map(([iconName, title, text, tint], i) =>
          h("article", { class: `landing-tile tile--${tint}${i === 0 ? " landing-tile--wide" : ""}` },
            h("span", { class: "landing-tile__icon" }, icon(iconName)),
            h("h2", {}, title),
            h("p", {}, text))),
      ),
    ),
    h("footer", { class: "landing-footer" },
      h("img", { src: "/brand/butler-app-icon.svg", alt: "", width: "28", height: "28" }),
      h("p", {}, "Butler. At your service, with opinions."),
    ),
  ));
}

/** The sign-in card. Calls `done` once the session cookie is set. */
export function renderSignIn(done: () => void, back?: () => void, message = "") {
  document.title = "Butler · Sign in";
  const password = h("input", {
    type: "password", required: true, autocomplete: "current-password", placeholder: "Your Butler password",
  });
  const errorSlot = h("div", { "aria-live": "polite" }, message ? inlineError(message) : null);
  const submit = button("Continue", { kind: "primary", type: "submit" });
  const form = h("form", { class: "signin-card b2-card" },
    h("img", { class: "signin-card__tile", src: "/brand/butler-app-icon.svg", alt: "Butler", width: "64", height: "64" }),
    h("h1", {}, "Welcome, sir."),
    h("p", { class: "signin-card__lede" }, "Let’s open your library."),
    field("Password", password),
    errorSlot,
    submit,
    h("p", { class: "signin-card__note" }, "Private server. Your devices."),
    back ? h("button", { type: "button", class: "signin-card__back", onclick: back }, "Back to the start") : null,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();
    try {
      await busy(submit, () => api("/api/login", { method: "POST", body: JSON.stringify({ password: password.value }) }));
      done();
    } catch (err) {
      errorSlot.replaceChildren(inlineError((err as Error).message));
      password.select();
    }
  });
  app().replaceChildren(h("main", { class: "signin" }, form));
  password.focus();
}
