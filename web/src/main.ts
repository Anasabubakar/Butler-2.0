import "./fonts";
import "./theme.css";
import "./app.css";
import "./library.css";
import "./pages.css";
import "./landing.css";
import { renderAsk } from "./ask";
import { renderAutomations } from "./automations";
import { renderDevices } from "./devices";
import { renderHome } from "./home";
import { renderInbox } from "./inbox";
import { renderIntegrations } from "./integrations";
import { renderLanding, renderSignIn } from "./landing";
import { renderLibrary } from "./library";
import { applyMotion, applyTheme } from "./local";
import { renderRecipes } from "./recipes";
import { renderSettings } from "./settings";
import { api, whenSignedOut } from "./ui";

const app = document.querySelector<HTMLDivElement>("#app")!;

const PAGES: Record<string, (app: HTMLElement) => unknown> = {
  "": renderHome,
  library: renderLibrary,
  ask: renderAsk,
  recipes: renderRecipes,
  automations: renderAutomations,
  integrations: renderIntegrations,
  inbox: renderInbox,
  devices: renderDevices,
  settings: renderSettings,
};

/** Shows the page the address asks for, like #/library or #/inbox. #/ is Home. */
function route() {
  document.querySelectorAll(".snooze, .sheet").forEach((el) => el.remove());
  const where = location.hash.replace(/^#\/?/, "").split("?")[0];
  (PAGES[where] ?? renderHome)(app);
  scrollTo({ top: 0 });
}

function signIn(message = "") {
  renderSignIn(() => route(), () => renderLanding(() => signIn()), message);
}

applyTheme();
applyMotion();
whenSignedOut(() => signIn("Your session ended. Sign in again to carry on."));
addEventListener("hashchange", () => api("/api/me").then(route, () => {}));
// Coming back from connecting Google lands on Integrations, where the result shows.
if (new URLSearchParams(location.search).has("google")) location.hash = "#/integrations";
fetch("/api/me").then((res) => (res.ok ? route() : renderLanding(() => signIn())), () => renderLanding(() => signIn()));
