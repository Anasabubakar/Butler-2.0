// Settings & preferences (Figma B2 · 16): "Your Butler. Your boundaries."
// Every control says where it applies: this browser, or all your devices.
import { href, page } from "./shell";
import { api, busy, button, card, h, inlineError, SignedOut, toast, toggle } from "./ui";

interface Prefs { teasing: "on" | "less" | "off"; quiet: boolean }

/** Per-browser switches, kept in this browser only. */
export const local = {
  get(key: string, fallback: string): string {
    try { return localStorage.getItem(`butler.${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(`butler.${key}`, value); } catch { /* private window: it lasts this visit */ }
  },
};

/** Applies the theme now: light, dark, or whatever the system says. */
export function applyTheme(choice = local.get("theme", "system")) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());

export function applyMotion(choice = local.get("motion", "system")) {
  if (choice === "reduce") document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}

export async function renderSettings(app: HTMLElement) {
  const shared = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  const thisBrowser = "This browser";
  const everywhere = "All your devices";

  const personality = h("section", { class: "b2-card settings-main" },
    h("h2", {}, "Appearance & personality"),
    toggle("Voice replies", "Speak answers aloud on this device.", local.get("voice", "off") === "on",
      (on) => local.set("voice", on ? "on" : "off"), thisBrowser),
    toggle("Microphone", "Allow spoken commands when activated. Butler only listens after you press the microphone.",
      local.get("mic", "off") === "on", (on) => local.set("mic", on ? "on" : "off"), thisBrowser),
    shared,
    toggle("Reduced motion", "Replace movement with subtle state changes.", local.get("motion", "system") === "reduce",
      (on) => { local.set("motion", on ? "reduce" : "system"); applyMotion(); }, thisBrowser),
  );

  app.replaceChildren(page("settings", "Your Butler. Your boundaries.",
    "Clear, calm and in your control. Each setting says whether it applies to this browser or to all your devices.",
    h("div", { class: "settings" }, personality, h("div", { class: "settings-side" }, themeCard(), reachCard(), dataCard())),
  ));

  try {
    let prefs = await api<Prefs>("/api/prefs");
    const save = async (patch: Partial<Prefs>) => {
      prefs = await api<Prefs>("/api/prefs", { method: "PUT", body: JSON.stringify(patch) });
    };
    shared.replaceChildren(
      toggle("Teasing", "Occasional dry remarks between tasks. Never about money, health, private messages or mistakes.",
        prefs.teasing !== "off", (on) => save({ teasing: on ? "on" : "off" }), everywhere),
      toggle("Quiet mode", "Silence non-essential cues and interruptions.", prefs.quiet,
        (on) => save({ quiet: on }), everywhere),
    );
  } catch (e) {
    if (e instanceof SignedOut) return;
    shared.replaceChildren(inlineError(`Couldn't load teasing and quiet mode: ${(e as Error).message}. Refresh to try again.`));
  }
}

function themeCard(): HTMLElement {
  const current = local.get("theme", "system");
  const choices: [string, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "System"]];
  const group = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Theme" },
    ...choices.map(([value, text]) => {
      const input = h("input", { type: "radio", name: "theme", value });
      input.checked = value === current;
      input.addEventListener("change", () => { local.set("theme", value); applyTheme(value); });
      return h("label", { class: "segmented__option" }, input, h("span", {}, text));
    }),
  );
  return card(h("h3", {}, "Theme"), h("p", { class: "muted settings-scope" }, "This browser"), group);
}

function reachCard(): HTMLElement {
  const row = (title: string, where: string, link?: { text: string; to: string }) =>
    h("li", {},
      h("span", { class: "reach__title" }, title),
      h("span", { class: "reach__where" }, where),
      link ? h("a", { href: link.to }, link.text) : null);
  return h("section", { class: "b2-card reach" },
    h("h3", {}, "Always within reach"),
    h("ul", {},
      row("Pet size and screen edge", "Set on each device: hold the pet, then Settings."),
      row("Wake listening", "Off until you opt in on a device. Butler always shows when it's recording."),
      row("Screen-access permissions", "Asked only when you ask Butler to help with a screen."),
      row("Clipboard sync controls", "On each device, in the pet's menu."),
      row("Connected accounts", "Google Calendar, Gmail, Contacts and Drive.", { text: "Open Devices", to: href("devices") }),
      row("Remote task access", "Switched on and off at the laptop itself, never remotely."),
    ),
  );
}

function dataCard(): HTMLElement {
  const exportButton = button("Export your library", {
    kind: "secondary", icon: "download",
    onclick: async (e) => {
      try {
        await busy(e.currentTarget as HTMLButtonElement, exportLibrary);
      } catch (err) {
        if (!(err instanceof SignedOut)) toast(`The export didn't finish: ${(err as Error).message}. Try again.`);
      }
    },
  });
  const signOut = button("Sign out of this browser", {
    kind: "ghost", icon: "signout",
    onclick: async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.hash = "";
      location.reload();
    },
  });
  return h("section", { class: "b2-card" },
    h("h3", {}, "Data export and deletion"),
    h("p", { class: "muted" }, "Download everything you've saved as a file. To delete a note, throw it in the wastebin or use its delete button; you get a few seconds to undo."),
    h("div", { class: "settings-actions" }, exportButton, signOut),
  );
}

/** Downloads every saved item as JSON, page by page. */
async function exportLibrary() {
  const all: { created_at: string }[] = [];
  for (;;) {
    const params = new URLSearchParams({ limit: "100" });
    const last = all.at(-1);
    if (last) params.set("before", last.created_at);
    const rows = await api<{ created_at: string }[]>(`/api/items?${params}`);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `butler-library-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Exported ${all.length} saves.`);
}

