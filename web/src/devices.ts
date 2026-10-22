// Devices & integrations (Figma B2 · 12). Connection states stay explicit:
// "Connected" never means unlimited access, and an offline device shows when it was last seen.
import { page } from "./shell";
import { api, busy, button, card, h, icon, inlineError, lastSeen, SignedOut, status, toast } from "./ui";

interface Device { name: string; kind: "phone" | "laptop"; last_seen: string }
interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  backup: { at: string; ok: boolean; note: string } | null;
}

/** Devices check in every few seconds while Butler runs on them. */
const ONLINE_MS = 2 * 60_000;
const PLATFORM = { phone: "Android", laptop: "Linux" } as const;

/** "My phone" when there's one phone; the device's own name when there are several. */
export function deviceTitle(d: Device, all: Device[]): string {
  const same = all.filter((x) => x.kind === d.kind).length;
  return same > 1 ? d.name : d.kind === "phone" ? "My phone" : "My laptop";
}

export async function renderDevices(app: HTMLElement) {
  const list = h("div", { class: "devices-grid" }, h("p", { class: "muted" }, "Checking your devices…"));
  const google = h("div");
  app.replaceChildren(page("devices", "One Butler. Your devices.",
    "Each device shows when it last checked in. Anything sent to an offline device waits in the queue until it reconnects.",
    list, google,
    h("ul", { class: "page__rules" },
      h("li", {}, "Remote actions name their destination, like “Run on My laptop”."),
      h("li", {}, "A queued action is never reported as complete."),
    ),
  ));

  try {
    const devices = await api<Device[]>("/api/devices");
    list.replaceChildren(...(devices.length ? devices.map((d) => deviceCard(d, devices)) : [
      card(h("h3", {}, "No devices yet"),
        h("p", { class: "muted" }, "Open Butler on your phone or laptop once and it will appear here.")),
    ]));
  } catch (e) {
    if (e instanceof SignedOut) return;
    list.replaceChildren(inlineError(`Couldn't load your devices: ${(e as Error).message}. Refresh to try again.`));
  }
  renderGoogle(google);
}

function deviceCard(d: Device, all: Device[]): HTMLElement {
  const online = Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;
  const title = deviceTitle(d, all);
  const action = d.kind === "phone"
    ? button(`Ring ${title}`, {
      kind: "secondary", icon: "ring",
      onclick: async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        try {
          toast((await busy(b, () => api<{ say: string }>("/api/ring", { method: "POST", body: JSON.stringify({ target: d.name }) }))).say);
        } catch (err) {
          if (!(err instanceof SignedOut)) toast(`Couldn't ring it: ${(err as Error).message}`);
        }
      },
    })
    : h("a", { class: "b2-button b2-button--secondary", href: `#/ask?target=${encodeURIComponent(d.name)}` }, icon("chat"), h("span", {}, `Run on ${title}`));
  return h("article", { class: "b2-card device" },
    h("div", { class: "device__head" },
      h("span", { class: "device__icon" }, icon(d.kind === "phone" ? "phone" : "laptop")),
      h("h2", {}, title),
      status(online ? "connected" : "offline"),
    ),
    h("p", { class: "device__meta" }, `${PLATFORM[d.kind]} • ${lastSeen(d.last_seen)}`),
    title !== d.name ? h("p", { class: "device__name" }, `Device name: ${d.name}`) : null,
    action,
  );
}

async function renderGoogle(slot: HTMLElement) {
  const result = new URLSearchParams(location.search).get("google");
  if (result) history.replaceState(null, "", location.pathname + location.hash);
  const s = await api<GoogleStatus>("/api/google/status").catch(() => null);
  if (!s?.configured) {
    slot.replaceChildren(card(h("h2", {}, "Connect an integration"),
      h("p", { class: "muted" }, "Google isn't set up on this server yet. Add a Google client to the server to connect Calendar and Gmail.")));
    return;
  }
  const scopes = h("ul", { class: "integration__scopes" },
    h("li", {}, "Calendar: add events you ask for, and read today's for your brief."),
    h("li", {}, "Gmail: send only the emails you confirm. Nothing is sent without your yes."),
    h("li", {}, "Contacts: look up who you mean when you ask to email someone."),
    h("li", {}, "Drive: a daily backup of your library."),
  );
  const backup = s.backup
    ? h("p", { class: "integration__sync" }, status(s.backup.ok ? "complete" : "failed",
      s.backup.ok ? "Backup complete" : "Backup failed"), ` ${new Date(s.backup.at).toLocaleString()}${s.backup.note ? ` · ${s.backup.note}` : ""}`)
    : null;
  const action = s.connected
    ? button("Disconnect Google", {
      kind: "secondary",
      onclick: async (e) => {
        if (!confirm("Disconnect Google? Butler will stop adding calendar events, sending email you approve and backing up to Drive. Your saved library stays.")) return;
        await busy(e.currentTarget as HTMLButtonElement, () => api("/api/google/disconnect", { method: "POST" }).catch(() => {}));
        renderGoogle(slot);
      },
    })
    : button("Connect Google", { kind: "primary", icon: "google", onclick: () => { location.href = "/api/google/connect"; } });

  slot.replaceChildren(h("section", { class: "b2-card integration" },
    h("h2", {}, "Connect an integration"),
    h("div", { class: "integration__row" },
      h("div", {},
        h("h3", {}, "Google Calendar and Gmail"),
        s.connected
          ? h("p", { class: "integration__account" }, status("connected"), ` ${s.email ?? "Your Google account"}`)
          : h("p", { class: "muted" }, "Choose what Butler may do. You can disconnect at any time."),
      ),
      action,
    ),
    result === "failed" ? inlineError("Connecting Google didn't go through. Try again, and allow the access Butler asks for.") : null,
    scopes,
    backup,
  ));
}
