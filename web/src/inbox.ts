// Inbox: what waits for your yes (a recipe step that would send, change or delete
// something), and the notes, reminders, links and files Butler and your devices sent.
import type { Sent } from "./home";
import { answerApproval, loadStatus, type Waiting } from "./recipes";
import { head, shell } from "./shell";
import { ago, api, busy, button, h, icon, inlineError, SignedOut, tabs } from "./ui";

type View = "all" | "waiting" | "reminder" | "other";

const ICONS: Record<Sent["kind"], string> = { reminder: "clock", note: "note", link: "link", file: "download" };
const WHO: Record<string, string> = { website: "the website", server: "Butler", butler: "Butler" };
const who = (name: string) => WHO[name.toLowerCase()] ?? name;

export async function renderInbox(app: HTMLElement) {
  const body = h("div", { class: "inbox" }, h("p", { class: "muted" }, "Loading…"));
  app.replaceChildren(shell("inbox",
    head("Inbox", "Steps waiting for your yes, and everything Butler and your devices sent: notes, reminders, links and files."),
    body,
  ));

  let waiting: Waiting[] = [];
  let sent: Sent[] = [];
  try {
    [waiting, sent] = await Promise.all([loadStatus().then((s) => s.waiting), api<Sent[]>("/api/messages")]);
  } catch (e) {
    if (!(e instanceof SignedOut)) body.replaceChildren(inlineError((e as Error).message));
    return;
  }

  let view: View = waiting.length ? "waiting" : "all";
  const list = h("div", { class: "inbox__list" });
  const draw = () => {
    const counts = {
      all: waiting.length + sent.length,
      waiting: waiting.length,
      reminder: sent.filter((m) => m.kind === "reminder").length,
      other: sent.filter((m) => m.kind !== "reminder").length,
    };
    body.replaceChildren(
      tabs("Show", [
        { value: "all", text: "All", count: counts.all },
        { value: "waiting", text: "Waiting for you", count: counts.waiting },
        { value: "reminder", text: "Reminders", count: counts.reminder },
        { value: "other", text: "Notes & links", count: counts.other },
      ] as { value: View; text: string; count: number }[], view, (v) => { view = v; draw(); }),
      list,
    );
    const shownWaiting = view === "all" || view === "waiting" ? waiting : [];
    const shownSent = view === "waiting" ? [] : sent.filter((m) => view === "all" || (view === "reminder") === (m.kind === "reminder"));
    const parts: Node[] = [];
    if (shownWaiting.length) parts.push(...shownWaiting.map((w) => approval(w, () => { waiting = waiting.filter((x) => x !== w); draw(); })));
    if (shownSent.length) parts.push(h("ul", { class: "b2-card inbox__sent" }, ...shownSent.map(message)));
    if (!parts.length) {
      parts.push(h("div", { class: "empty" }, icon("inbox"),
        h("h3", {}, view === "waiting" ? "Nothing waits for you" : "All clear, sir."),
        h("p", {}, view === "waiting"
          ? "When a recipe wants to send, change or delete something, it waits here for your yes."
          : "Notes and reminders Butler sends your devices show up here.")));
    }
    list.replaceChildren(...parts);
  };
  draw();
}

/** A step a recipe wants to take, with Yes and No. */
function approval(w: Waiting, gone: () => void): HTMLElement {
  const out = h("p", { class: "approval__out", role: "status", hidden: true });
  const answer = async (yes: boolean, b: HTMLButtonElement) => {
    try {
      out.textContent = await busy(b, () => answerApproval(w.id, yes));
      out.hidden = false;
      el.classList.add("answered");
      buttons.remove();
      setTimeout(gone, 4000);
    } catch (e) {
      if (!(e instanceof SignedOut)) { out.textContent = (e as Error).message; out.hidden = false; }
    }
  };
  const yes = button("Yes, do it", { kind: "primary", small: true, onclick: () => answer(true, yes) });
  const no = button("No", { kind: "ghost", small: true, onclick: () => answer(false, no) });
  const buttons = h("div", { class: "actions" }, yes, no);
  const el = h("article", { class: "b2-card approval" },
    h("div", { class: "approval__head" },
      h("span", { class: "row__icon" }, icon("alert")),
      h("div", { class: "row__text" },
        h("span", { class: "row__title" }, w.tool),
        h("span", { class: "row__sub" }, `From ${w.from} · ${until(w.expires)}`)),
    ),
    h("pre", { class: "approval__details" }, w.details),
    buttons,
    out,
  );
  return el;
}

/** "expires in 20 minutes", for something that lapses later. */
function until(iso: string): string {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (min <= 0) return "expired";
  if (min < 60) return `expires in ${min} minute${min === 1 ? "" : "s"}`;
  const hours = Math.round(min / 60);
  return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

function message(m: Sent): HTMLElement {
  const later = new Date(m.due_at).getTime() > Date.now();
  const when = later
    ? `Due ${new Date(m.due_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : ago(m.due_at);
  const to = m.to_devices.length > 1 ? "all your devices" : m.to_devices[0];
  return h("li", { class: "row message" },
    h("span", { class: "row__icon" }, icon(ICONS[m.kind] ?? "note")),
    h("div", { class: "row__text" },
      m.body ? h("p", { class: "message__body" }, m.body) : null,
      m.url ? h("a", { class: "message__link", href: m.url, target: "_blank", rel: "noopener noreferrer" }, m.url) : null,
      !m.body && !m.url ? h("p", { class: "message__body" }, "A file") : null,
      h("span", { class: "row__sub" }, `${when} · from ${who(m.from_device)} to ${to}`),
    ),
    later ? h("span", { class: "b2-status b2-status--queued" }, icon("clock"), h("span", {}, "Coming up")) : null,
  );
}
