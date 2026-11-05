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
// Coming back from connecting Google, or signing in to a connection, lands on Integrations,
// where the result shows.
if (["google", "mcp"].some((k) => new URLSearchParams(location.search).has(k))) location.hash = "#/integrations";

/**
 * Opened from the Butler Library button in Telegram: Telegram puts what it signed about who
 * opened it after the # (tgWebAppData). The server checks it's you and signs you in, so the
 * library opens without a password. Then the address is tidied and the library shown.
 */
async function telegramSignIn(): Promise<boolean> {
  const data = new URLSearchParams(location.hash.slice(1)).get("tgWebAppData");
  if (!data) return false;
  document.documentElement.classList.add("in-telegram");
  history.replaceState(null, "", `${location.pathname}#/library`);
  const res = await fetch("/api/telegram/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: data }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

telegramSignIn()
  .then(() => fetch("/api/me"))
  .then((res) => (res.ok ? route() : renderLanding(() => signIn())), () => renderLanding(() => signIn()));
