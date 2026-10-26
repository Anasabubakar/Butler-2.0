// Devices: each phone and laptop running Butler, when it last checked in, and what you can
// do with it from here. An offline device shows when it was last seen.
import { href, page } from "./shell";
import { api, busy, button, h, icon, inlineError, lastSeen, SignedOut, status, toast } from "./ui";

interface Device { name: string; kind: "phone" | "laptop"; last_seen: string }

/** Devices check in every few seconds while Butler runs on them. */
const ONLINE_MS = 2 * 60_000;
const PLATFORM = { phone: "Android", laptop: "Linux" } as const;

/** "My phone" when there's one phone; the device's own name when there are several. */
export function deviceTitle(d: Device, all: Device[]): string {
  const same = all.filter((x) => x.kind === d.kind).length;
  return same > 1 ? d.name : d.kind === "phone" ? "My phone" : "My laptop";
}

export async function renderDevices(app: HTMLElement) {
  const list = h("div", { class: "bento" }, h("p", { class: "muted" }, "Checking your devices…"));
  app.replaceChildren(page("devices", "Devices",
    "One Butler on your phone and laptop. Anything sent to an offline device waits until it reconnects.",
    list,
    h("ul", { class: "notes" },
      h("li", {}, icon("check"), "Remote actions name their destination, like “Run on My laptop”."),
      h("li", {}, icon("check"), "A queued action is never reported as complete."),
      h("li", {}, icon("plug"), "Google and other services live under ", h("a", { href: href("integrations") }, "Integrations"), "."),
    ),
  ));

  try {
    const devices = await api<Device[]>("/api/devices");
    list.replaceChildren(...(devices.length ? devices.map((d) => deviceCard(d, devices)) : [
      h("div", { class: "empty tile--12" }, icon("devices"), h("h3", {}, "No devices yet"),
        h("p", {}, "Open Butler on your phone or laptop once and it will appear here.")),
    ]));
  } catch (e) {
    if (e instanceof SignedOut) return;
    list.replaceChildren(inlineError(`Couldn't load your devices: ${(e as Error).message}. Refresh to try again.`));
  }
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
  return h("article", { class: `tile tile--6 device ${d.kind === "phone" ? "tile--sky" : "tile--lavender"}` },
    h("div", { class: "device__head" },
      h("span", { class: "device__icon" }, icon(d.kind === "phone" ? "phone" : "laptop")),
      status(online ? "connected" : "offline"),
    ),
    h("div", {},
      h("h2", { class: "device__title" }, title),
      h("p", { class: "device__meta" }, `${PLATFORM[d.kind]} · ${lastSeen(d.last_seen)}`),
      title !== d.name ? h("p", { class: "device__name" }, `Device name: ${d.name}`) : null),
    action,
  );
}
