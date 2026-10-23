// The signed-out website: the first impression (Figma B2 · 08 Website & landing) and the
// sign-in (B2 · 10 Auth & onboarding). Claims only describe what Butler does today.
import { api, button, field, h, inlineError, lockup, busy } from "./ui";

const app = () => document.querySelector<HTMLDivElement>("#app")!;

/** The landing page. `signIn` opens the sign-in card. */
export function renderLanding(signIn: () => void) {
  document.title = "Butler 2.0 · Already handled, sir.";
  const features = h("section", { class: "landing-features", id: "explore", "aria-labelledby": "explore-title" },
    h("span", { class: "b2-rule", "aria-hidden": "true" }),
    h("h2", { id: "explore-title" }, "A little less doing.", h("br"), "A little more done."),
    h("div", { class: "landing-features__grid" },
      feature("Save what matters", "Share a link, a post or a screenshot from your phone. Butler keeps the source, writes a summary and pins it to your board."),
      feature("Find it again", "Search your library by words or by meaning, or ask: “that jollof recipe I saved last week.”"),
      feature("Across your devices", "Your phone and laptop share one Butler: send things between them, ring a lost phone, and see what each is doing."),
    ),
  );

  app().replaceChildren(h("div", { class: "landing" },
    h("header", { class: "landing-nav" },
      h("a", { href: "/", class: "landing-nav__brand", "aria-label": "Butler 2.0 home" }, lockup(48)),
      h("nav", { class: "landing-nav__links", "aria-label": "Site" },
        h("a", { href: "#explore" }, "Library"),
        h("a", { href: "#explore" }, "Devices"),
      ),
      button("Open Butler", { kind: "primary", onclick: signIn }),
    ),
    h("main", { class: "landing-hero" },
      h("div", { class: "landing-hero__copy" },
        h("p", { class: "landing-eyebrow" }, "Your personal assistant. Everywhere."),
        h("h1", {}, "Already handled,", h("br"), "sir."),
        h("p", { class: "landing-lede" }, "Save what matters. Find it when you need it.", h("br"),
          "Let Butler handle the little things across your devices."),
        h("div", { class: "landing-actions" },
          button("Explore Butler", { kind: "primary", onclick: () => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" }) }),
          button("View your library", { kind: "secondary", onclick: signIn }),
        ),
      ),
      h("aside", { class: "landing-hero__card b2-card b2-card--ink", "aria-label": "Butler at work" },
        h("img", { class: "landing-hero__tile", src: "/brand/butler-app-icon.svg", alt: "", width: "168", height: "168" }),
        h("p", { class: "landing-hero__state" }, "Laptop • Working"),
        h("p", { class: "landing-hero__result" }, "Saved and organised."),
        h("p", { class: "landing-hero__aside" }, "Naturally, sir."),
      ),
    ),
    h("p", { class: "landing-tagline" }, "One companion. Connected devices. Your own space."),
    features,
    h("footer", { class: "landing-footer" },
      h("img", { src: "/brand/butler-primary.svg", class: "landing-footer__logo landing-footer__logo--light", alt: "Butler 2.0" }),
      h("img", { src: "/brand/butler-app-icon.svg", class: "landing-footer__logo landing-footer__logo--dark", alt: "Butler 2.0" }),
      h("p", {}, "At your service. With opinions."),
    ),
  ));
}

function feature(title: string, text: string): HTMLElement {
  return h("article", { class: "b2-card landing-feature" }, h("h3", {}, title), h("p", {}, text));
}

/** The sign-in card. Calls `done` once the session cookie is set. */
export function renderSignIn(done: () => void, back?: () => void, message = "") {
  document.title = "Butler 2.0 · Sign in";
  const password = h("input", {
    type: "password", required: true, autocomplete: "current-password", placeholder: "Your Butler password",
  });
  const errorSlot = h("div", { "aria-live": "polite" }, message ? inlineError(message) : null);
  const submit = button("Continue", { kind: "primary", type: "submit" });
  const form = h("form", { class: "signin-card b2-card" },
    h("span", { class: "signin-card__grabber", "aria-hidden": "true" }),
    h("img", { class: "signin-card__tile", src: "/brand/butler-app-icon.svg", alt: "Butler 2.0", width: "100", height: "100" }),
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
