// Recipes: instructions you save once and run by name ("run my morning check") from Ask
// Butler, or from here. The page is a kitchen: write what Butler should do, add a name,
// connections, a schedule or an email trigger, and Create. Ideas to start from sit below it,
// then your recipes. Steps that would change something wait for your yes in the Inbox.
import { recount, head, href, shell } from "./shell";
import { ago, api, busy, button, h, icon, iconButton, modal, SignedOut, status as pill, tabs, toast } from "./ui";

export interface Recipe {
  id: string;
  name: string;
  instructions: string;
  connections: string[];
  last_run_at: string | null;
  run_at: string | null;
  run_days: number[];
  schedule: string; // in words, like "weekdays at 08:00"
  email_query: string | null; // a Gmail search; new email matching it starts the recipe
  email_error: string | null;
  has_hook: boolean; // whether a secret link starts it
}

export interface Waiting { id: string; from: string; tool: string; details: string; expires: string }

export interface Status { recipes: Recipe[]; connections: string[]; waiting: Waiting[]; timeZone: string }

type Topic = "all" | "daily" | "email" | "money" | "library";

/** Ideas to start from, in the spirit of Poke's recipes. `needs` says what has to be connected. */
const IDEAS: { name: string; topic: Exclude<Topic, "all">; icon: string; text: string; needs: string }[] = [
  { name: "Morning check", topic: "daily", icon: "sun", needs: "A calendar or tasks connection",
    text: "Look at my tasks due today and my calendar for today. Tell me the three things to do first, in order, with times." },
  { name: "End of day", topic: "daily", icon: "moon", needs: "A tasks connection",
    text: "List what I finished today and what's left for tomorrow, from my task list. Keep it short." },
  { name: "Week ahead", topic: "daily", icon: "calendar", needs: "A calendar connection",
    text: "Every Sunday evening, look at my calendar for the coming week. Flag clashes, early starts and days with no breaks." },
  { name: "Inbox sweep", topic: "email", icon: "mail", needs: "An email connection, like Zapier's Gmail",
    text: "Find emails from the last day that need a reply from me. One line each: who, what they want, how urgent." },
  { name: "Bank alert", topic: "money", icon: "alert", needs: "Run on email matching your bank's alerts",
    text: "This email is from my bank. Tell me the amount, the shop and whether it looks unusual for me, in one line." },
  { name: "Bills due", topic: "money", icon: "clock", needs: "An email connection",
    text: "Look for bills and invoices in my email from the last week that are still unpaid. List each with the amount and due date." },
  { name: "Receipt keeper", topic: "money", icon: "note", needs: "Run on email matching receipts",
    text: "This email is a receipt. Tell me the shop, the total and what I bought, in one line, so I can log the spend." },
  { name: "Reading list", topic: "library", icon: "library", needs: "A notes or docs connection",
    text: "Pick the three articles or videos I'd most enjoy from my notes app's reading list, and say why in one line each." },
  { name: "Link digest", topic: "library", icon: "link", needs: "Start it from a link (Zapier, IFTTT, Tasker)",
    text: "What arrives is a link someone sent me. Tell me what it is, whether it's worth my time, and the one key point." },
];

const TOPICS: { value: Topic; text: string }[] = [
  { value: "all", text: "All" }, { value: "daily", text: "Daily" }, { value: "email", text: "Email" },
  { value: "money", text: "Money" }, { value: "library", text: "Reading" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const loadStatus = () => api<Status>("/api/recipes");

/** A recipe's name from its first words, when you didn't give one. */
export function nameFrom(text: string): string {
  const words = text.replace(/[^\p{L}\p{N} '-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return name.slice(0, 60).trim() || "My recipe";
}

/** How a recipe starts, in a few words. */
export function triggers(r: Recipe): string {
  return [r.run_at ? r.schedule : null, r.email_query ? `on email matching “${r.email_query}”` : null,
    r.has_hook ? "from its link" : null].filter(Boolean).join(" · ") || "when you ask";
}

export async function renderRecipes(app: HTMLElement) {
  const kitchen = h("section", { class: "kitchen" }, h("p", { class: "muted" }, "Loading…"));
  const ideas = h("section", { class: "ideas" });
  const mine = h("section", { class: "mine" });
  app.replaceChildren(shell("recipes",
    head("Recipes", "Save an instruction once. Butler runs it when you ask, on a schedule, when an email arrives, or from a link.",
      h("a", { class: "b2-button b2-button--secondary", href: href("automations") }, icon("bolt"), h("span", {}, "Automations"))),
    kitchen,
    h("h2", { class: "section-title" }, "Ideas to start from"),
    ideas,
    h("h2", { class: "section-title" }, "My recipes"),
    mine,
  ));

  let status: Status;
  try {
    status = await loadStatus();
  } catch (e) {
    if (!(e instanceof SignedOut)) kitchen.replaceChildren(h("p", { class: "b2-error" }, (e as Error).message));
    return;
  }

  const reload = async () => {
    status = await loadStatus().catch(() => status);
    drawMine();
  };
  const form = recipeForm(null, status, reload);
  kitchen.replaceChildren(form.el);

  let topic: Topic = "all";
  const drawIdeas = () => {
    grid.replaceChildren(...IDEAS.filter((i) => topic === "all" || i.topic === topic).map((idea, n) =>
      h("article", { class: `idea t${n % 6}` },
        h("span", { class: "idea__icon" }, icon(idea.icon)),
        h("h3", {}, idea.name),
        h("p", {}, idea.text),
        h("p", { class: "idea__needs" }, idea.needs),
        button("Use this recipe", {
          kind: "secondary", small: true,
          onclick: () => { form.fill(idea.name, idea.text); kitchen.scrollIntoView({ behavior: "smooth", block: "center" }); },
        }),
      )));
  };
  const grid = h("div", { class: "ideas__grid" });
  ideas.replaceChildren(tabs("Idea topics", TOPICS, topic, (t) => { topic = t; drawIdeas(); }), grid);
  drawIdeas();

  function drawMine() {
    if (!status.recipes.length) {
      mine.replaceChildren(h("div", { class: "empty" }, icon("recipe"), h("h3", {}, "No recipes yet"),
        h("p", {}, "Write one above, or start from an idea. Then say “run my morning check” to Ask Butler.")));
      return;
    }
    mine.replaceChildren(h("div", { class: "table", role: "table", "aria-label": "My recipes" },
      h("div", { class: "table__row table__row--head", role: "row" },
        ...["Name", "What it does", "Runs", "Last run", ""].map((t) => h("span", { role: "columnheader" }, t))),
      ...status.recipes.map((r) => h("div", { class: "table__row", role: "row" },
        h("span", { role: "cell", class: "table__name" }, r.name),
        h("span", { role: "cell", class: "table__text" }, r.instructions),
        h("span", { role: "cell", class: "table__runs" }, triggers(r)),
        h("span", { role: "cell", class: "table__when" }, r.email_error ? pill("failed", "Email check failed") : r.last_run_at ? ago(r.last_run_at) : "Not yet"),
        h("span", { role: "cell", class: "table__actions" },
          runButton(r),
          iconButton("edit", `Edit ${r.name}`, () => editRecipe(r, status, reload)),
          iconButton("trash", `Delete ${r.name}`, () => deleteRecipe(r, reload)),
        ),
      )),
    ));
  }
  drawMine();
}


/** Run now; the reply shows in a dialog, with Yes and No when a step needs your say-so. */
export function runButton(r: Recipe): HTMLButtonElement {
  const b = button("Run", {
    kind: "secondary", small: true, icon: "play",
    onclick: async () => {
      try {
        const done = await busy(b, () => api<{ say: string; confirm?: string }>(`/api/recipes/${r.id}/run`, { method: "POST" }));
        showResult(r.name, done.say, done.confirm);
      } catch (e) {
        if (!(e instanceof SignedOut)) toast(`${r.name} didn't run: ${(e as Error).message}`);
      }
    },
  });
  return b;
}

/** What a recipe said, and the yes or no it needs, if any. */
export function showResult(title: string, say: string, approval?: string) {
  const out = h("p", { class: "result" }, say);
  const d = modal(title, out);
  if (!approval) return;
  const answer = async (yes: boolean, b: HTMLButtonElement) => {
    try {
      const after = await busy(b, () => answerApproval(approval, yes));
      out.textContent = after;
      row.remove();
    } catch (e) {
      out.textContent = (e as Error).message;
    }
  };
  const yes = button("Yes, do it", { kind: "primary", onclick: () => answer(true, yes) });
  const no = button("No", { kind: "ghost", onclick: () => answer(false, no) });
  const row = h("div", { class: "actions" }, yes, no);
  d.querySelector(".modal__body")!.append(row);
}

export async function answerApproval(id: string, yes: boolean): Promise<string> {
  const r = await api<{ say: string }>(`/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ yes }) });
  recount();
  return r.say;
}

export function editRecipe(r: Recipe, status: Status, done: () => unknown) {
  let d: HTMLDialogElement | null = null;
  const form = recipeForm(r, status, async () => { d?.close(); await done(); });
  d = modal(`Edit ${r.name}`, form.el, linkBox(r));
}

export async function deleteRecipe(r: Recipe, done: () => unknown) {
  if (!confirm(`Delete the recipe "${r.name}"?`)) return;
  await api(`/api/recipes/${r.id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message));
  toast(`Deleted ${r.name}.`);
  await done();
}

/** A recipe's secret link: anything that can send a POST to it starts the recipe. */
export function linkBox(r: Recipe): HTMLElement {
  const box = h("details", { class: "linkbox" }, h("summary", {}, icon("link"), "Start it from a link (Zapier, IFTTT, Tasker…)"));
  const area = h("div", { class: "linkbox__area" });
  box.append(area);
  const show = (url: string | null) => {
    if (!url) {
      area.replaceChildren(h("p", { class: "muted small" },
        "Anything that sends a POST to the link starts this recipe, and what it sends is given to the recipe to work on. " +
          "Keep the link private: whoever has it can start the recipe (anything that changes things still waits for your yes)."),
      button("Make a secret link", { kind: "secondary", small: true, onclick: () => change("POST") }));
      return;
    }
    const field = h("input", { readonly: true, value: url, "aria-label": "Secret link" });
    const copy = button("Copy", {
      kind: "secondary", small: true,
      onclick: async () => {
        await navigator.clipboard.writeText(url).then(() => toast("Link copied."), () => field.select());
      },
    });
    area.replaceChildren(field, h("div", { class: "actions" }, copy,
      button("New link", { kind: "ghost", small: true, onclick: () => confirm("Make a new link? The old one stops working.") && change("POST") }),
      button("Turn off", { kind: "ghost", small: true, onclick: () => change("DELETE") })));
  };
  const change = async (method: "POST" | "DELETE") => {
    try {
      show((await api<{ url?: string }>(`/api/recipes/${r.id}/hook`, { method })).url ?? null);
    } catch (e) {
      area.replaceChildren(h("p", { class: "b2-error" }, (e as Error).message));
    }
  };
  box.addEventListener("toggle", async () => {
    if (!box.open || area.childElementCount) return;
    show(r.has_hook ? (await api<{ url: string | null }>(`/api/recipes/${r.id}/hook`).catch(() => ({ url: null }))).url : null);
  });
  return box;
}

/**
 * The kitchen: what Butler should do, and chips that open the extras (a name, connections,
 * a schedule, an email trigger). Editing shows the extras the recipe already uses.
 */
export function recipeForm(r: Recipe | null, status: Status, done: () => unknown) {
  const text = h("textarea", {
    name: "instructions", required: true, maxlength: "4000", rows: "3", class: "kitchen__text",
    placeholder: "What should Butler do for you? Write it like you'd tell a person.",
    "aria-label": "What Butler should do",
  });
  text.value = r?.instructions ?? "";
  const grow = () => { text.style.height = "auto"; text.style.height = `${Math.min(text.scrollHeight, 360)}px`; };
  text.addEventListener("input", grow);

  const name = h("input", { name: "name", maxlength: "60", placeholder: "Morning check", autocomplete: "off", value: r?.name ?? "", "aria-label": "Name" });

  const boxes = status.connections.map((c) =>
    h("label", { class: "check" },
      h("input", { type: "checkbox", value: c, checked: Boolean(r?.connections.some((x) => x.toLowerCase() === c.toLowerCase())) }), c));

  // Runs on its own: a time (your time zone) and the days.
  const time = h("input", { type: "time", value: r?.run_at ?? "08:00", "aria-label": "Time" });
  const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    h("label", { class: "check check--day" },
      h("input", { type: "checkbox", value: String(d), checked: r?.run_at ? r.run_days.includes(d) : true }), DAYS[d]));

  // Starts on email: a Gmail search, and each new email that matches runs it.
  const query = h("input", { maxlength: "300", placeholder: "from:mybank.com subject:alert", autocomplete: "off",
    "aria-label": "Gmail search", value: r?.email_query ?? "" });

  const extra = (label: string, iconName: string, on: boolean, ...content: Node[]) => {
    const panel = h("div", { class: "kitchen__panel", hidden: !on }, h("p", { class: "kitchen__label" }, icon(iconName), label), ...content);
    const chip = h("button", { type: "button", class: "pill pill--dashed", "aria-expanded": String(on) }, icon(on ? "check" : "plus"), label);
    chip.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      chip.setAttribute("aria-expanded", String(!panel.hidden));
      chip.replaceChildren(icon(panel.hidden ? "plus" : "check"), label);
      chip.classList.toggle("active", !panel.hidden);
      if (!panel.hidden) panel.querySelector<HTMLElement>("input")?.focus();
    });
    chip.classList.toggle("active", on);
    return { panel, chip, on: () => !panel.hidden };
  };
  const named = extra("Name", "edit", Boolean(r), name);
  const linked = extra("Integrations", "plug", Boolean(r?.connections.length),
    boxes.length
      ? h("div", { class: "checks" }, ...boxes)
      : h("p", { class: "muted small" }, "No integrations yet, so it can only answer. ",
        h("a", { href: href("integrations") }, "Add one")),
    h("p", { class: "muted small" }, "None ticked: it may use any of them."));
  const scheduled = extra("Schedule", "clock", Boolean(r?.run_at),
    h("div", { class: "checks" }, time, ...dayBoxes),
    h("p", { class: "muted small" }, `Runs in your time (${status.timeZone}) and sends you the result.`));
  const onEmail = extra("On new email", "mail", Boolean(r?.email_query), query,
    h("p", { class: "muted small" }, "A Gmail search. Each new email that matches starts the recipe."));

  const save = button(r ? "Save" : "Create", { kind: "primary", type: "submit" });
  const note = h("p", { class: "b2-error", role: "alert", hidden: true });
  const el = h("form", { class: r ? "kitchen__form kitchen__form--edit" : "kitchen__form" },
    r ? null : h("h2", { class: "kitchen__title" }, "What should Butler do for you, sir?"),
    h("div", { class: "kitchen__box" },
      text,
      h("div", { class: "kitchen__bar" },
        h("div", { class: "pills" }, named.chip, linked.chip, scheduled.chip, onEmail.chip),
        save),
    ),
    named.panel, linked.panel, scheduled.panel, onEmail.panel,
    note,
  );
  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    note.hidden = true;
    if (!text.value.trim()) { text.focus(); return; }
    const connections = linked.on() ? boxes.map((b) => b.querySelector("input")!).filter((i) => i.checked).map((i) => i.value) : [];
    const given = named.on() ? name.value.trim() : "";
    try {
      await busy(save, () => api(r ? `/api/recipes/${r.id}` : "/api/recipes", {
        method: r ? "PUT" : "POST",
        body: JSON.stringify({
          name: given || nameFrom(text.value), instructions: text.value, connections,
          run_at: scheduled.on() ? time.value : null,
          run_days: dayBoxes.map((b) => b.querySelector("input")!).filter((i) => i.checked).map((i) => Number(i.value)),
          email_query: onEmail.on() && query.value.trim() ? query.value : null,
        }),
      }));
      toast(r ? `Saved ${given || r.name}.` : `Created “${given || nameFrom(text.value)}”. Say “run ${given || nameFrom(text.value)}” to Ask Butler.`);
      if (!r) { text.value = ""; name.value = ""; grow(); }
      await done();
    } catch (err) {
      if (err instanceof SignedOut) return;
      note.hidden = false;
      note.textContent = (err as Error).message;
    }
  });
  requestAnimationFrame(grow);
  return {
    el,
    /** Puts an idea in the kitchen. */
    fill(n: string, t: string) {
      text.value = t;
      name.value = n;
      if (!named.on()) named.chip.click();
      grow();
      text.focus();
    },
  };
}
