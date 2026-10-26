// Settings: every control says where it applies, this browser or all your devices.
import { applyMotion, applyTheme, local } from "./local";
import { href, page } from "./shell";
import { ago, api, busy, button, card, h, iconButton, inlineError, SignedOut, toast, toggle } from "./ui";

interface Prefs { teasing: "on" | "less" | "off"; quiet: boolean; memory: boolean }
interface Memory { id: string; created_at: string; text: string; source: "learned" | "told" }

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

  app.replaceChildren(page("settings", "Settings",
    "Your Butler, your boundaries. Each setting says whether it applies to this browser or to all your devices.",
    h("div", { class: "settings" },
      h("div", { class: "settings-side" }, personality, memoryCard()),
      h("div", { class: "settings-side" }, themeCard(), reachCard(), dataCard())),
  ));

  try {
    let prefs = await api<Prefs>("/api/prefs");
    const save = async (patch: Partial<Prefs>) => {
      prefs = await api<Prefs>("/api/prefs", { method: "PUT", body: JSON.stringify(patch) });
    };
    shared.replaceChildren(
      toggle("Teasing", "Light sass and roasting when the moment fits. Never about money, health, private messages or mistakes.",
        prefs.teasing !== "off", (on) => save({ teasing: on ? "on" : "off" }), everywhere),
      toggle("Quiet mode", "Silence non-essential cues and interruptions.", prefs.quiet,
        (on) => save({ quiet: on }), everywhere),
      toggle("Learn about me", "Butler picks up lasting facts from what you tell it (people, preferences, plans) and uses them in every reply. See and forget them under Memory.",
        prefs.memory, (on) => save({ memory: on }), everywhere),
    );
  } catch (e) {
    if (e instanceof SignedOut) return;
    shared.replaceChildren(inlineError(`Couldn't load teasing and quiet mode: ${(e as Error).message}. Refresh to try again.`));
  }
}

/** What Butler remembers about you: every fact, each with Forget, plus adding one and forgetting it all. */
function memoryCard(): HTMLElement {
  const list = h("ul", { class: "memory__list" }, h("li", { class: "muted" }, "Loading…"));
  const input = h("input", { type: "text", placeholder: "Something Butler should know, like “My sister is Aisha”", "aria-label": "Something Butler should remember", maxlength: "300" });
  const add = button("Remember", { kind: "secondary", type: "submit" });
  const form = h("form", { class: "memory__add" }, input, add);

  async function load() {
    try {
      const { memories } = await api<{ memories: Memory[] }>("/api/memory");
      list.replaceChildren(...(memories.length
        ? memories.map((m) => {
          const row = h("li", {},
            h("span", { class: "memory__text" }, m.text),
            h("span", { class: "memory__when" }, `${m.source === "told" ? "You told it" : "Learned"} ${ago(m.created_at)}`),
            iconButton("trash", `Forget “${m.text}”`, async () => {
              try {
                await api(`/api/memory/${m.id}`, { method: "DELETE" });
                row.remove();
                if (!list.childElementCount) load();
              } catch (e) {
                if (!(e instanceof SignedOut)) toast(`Couldn't forget it: ${(e as Error).message}`);
              }
            }));
          return row;
        })
        : [h("li", { class: "muted" }, "Nothing yet. Butler learns as you talk to it, or add something here.")]));
    } catch (e) {
      if (!(e instanceof SignedOut)) list.replaceChildren(h("li", {}, inlineError(`Couldn't load memories: ${(e as Error).message}`)));
    }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await busy(add, () => api("/api/memory", { method: "POST", body: JSON.stringify({ text }) }));
      input.value = "";
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) toast((err as Error).message);
    }
  });
  const forgetAll = button("Forget everything", {
    kind: "danger", small: true,
    onclick: async (e) => {
      if (!confirm("Forget everything Butler has learned about you? This can't be undone.")) return;
      try {
        await busy(e.currentTarget as HTMLButtonElement, () => api("/api/memory", { method: "DELETE" }));
        load();
      } catch (err) {
        if (!(err instanceof SignedOut)) toast(`Couldn't forget: ${(err as Error).message}`);
      }
    },
  });
  const clearChat = button("Delete chat history", {
    kind: "ghost", small: true,
    onclick: async (e) => {
      if (!confirm("Delete your conversation with Butler? Chats about single saves stay with those saves.")) return;
      try {
        await busy(e.currentTarget as HTMLButtonElement, () => api("/api/chat", { method: "DELETE" }));
        toast("Chat history deleted.");
      } catch (err) {
        if (!(err instanceof SignedOut)) toast(`Couldn't delete it: ${(err as Error).message}`);
      }
    },
  });
  load();
  return h("section", { class: "b2-card memory" },
    h("h2", {}, "Memory"),
    h("p", { class: "muted settings-scope" }, "All your devices"),
    h("p", { class: "muted" }, "Butler reads your last two days of chat and everything below in every reply. It never keeps passwords, codes or card numbers. Older chat is kept for a year but not read."),
    form,
    list,
    h("div", { class: "settings-actions" }, clearChat, forgetAll),
  );
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
      row("Connected accounts", "Google Calendar, Gmail, Contacts and Drive.", { text: "Open Integrations", to: href("integrations") }),
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
    h("p", { class: "muted" }, "Download everything you've saved as a file. To delete a save, use its delete button in the Library; you get a few seconds to undo."),
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

