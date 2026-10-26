// Automations: your recipes by how they start (on a schedule, on new email, from a link,
// or only when you ask), each a card you can open to run, edit or switch its link on.
import { deleteRecipe, editRecipe, linkBox, loadStatus, type Recipe, runButton, type Status, triggers } from "./recipes";
import { head, href, shell } from "./shell";
import { ago, h, icon, SignedOut, status as pill, tabs } from "./ui";

type View = "all" | "scheduled" | "email" | "links" | "asked";

const VIEWS: { value: View; text: string; test: (r: Recipe) => boolean }[] = [
  { value: "all", text: "All", test: () => true },
  { value: "scheduled", text: "Scheduled", test: (r) => Boolean(r.run_at) },
  { value: "email", text: "Emails", test: (r) => Boolean(r.email_query) },
  { value: "links", text: "Links", test: (r) => r.has_hook },
  { value: "asked", text: "When you ask", test: (r) => !r.run_at && !r.email_query && !r.has_hook },
];

export async function renderAutomations(app: HTMLElement) {
  const body = h("div", { class: "automations" }, h("p", { class: "muted" }, "Loading…"));
  app.replaceChildren(shell("automations",
    head("Automations", "Recipes that run on their own: on a schedule, when an email arrives, or when something calls their link.",
      h("a", { class: "b2-button b2-button--primary", href: href("recipes") }, icon("plus"), h("span", {}, "Add"))),
    body,
  ));

  let data: Status;
  try {
    data = await loadStatus();
  } catch (e) {
    if (!(e instanceof SignedOut)) body.replaceChildren(h("p", { class: "b2-error" }, (e as Error).message));
    return;
  }
  const wanted = new URLSearchParams(location.hash.split("?")[1] ?? "").get("view") as View | null;
  let view: View = VIEWS.some((v) => v.value === wanted) ? wanted! : "all";
  const list = h("div", { class: "auto-list" });
  const reload = async () => { data = await loadStatus().catch(() => data); draw(); };

  const draw = () => {
    const shown = data.recipes.filter(VIEWS.find((v) => v.value === view)!.test);
    body.replaceChildren(
      tabs("Show", VIEWS.map((v) => ({ value: v.value, text: v.text, count: data.recipes.filter(v.test).length })), view, (v) => {
        view = v;
        history.replaceState(null, "", v === "all" ? "#/automations" : `#/automations?view=${v}`);
        draw();
      }),
      list,
    );
    list.replaceChildren(...(shown.length ? shown.map((r) => autoCard(r, data, reload)) : [
      h("div", { class: "empty" }, icon("bolt"), h("h3", {}, view === "all" ? "No automations yet" : "None here yet"),
        h("p", {}, "Make a recipe, then give it a schedule, an email search or a link."),
        h("a", { class: "b2-button b2-button--secondary", href: href("recipes") }, icon("recipe"), h("span", {}, "Go to Recipes"))),
    ]));
  };
  draw();
}

function autoCard(r: Recipe, data: Status, reload: () => unknown): HTMLElement {
  const kind = r.email_query ? "mail" : r.run_at ? "clock" : r.has_hook ? "link" : "play";
  return h("details", { class: "auto" },
    h("summary", { class: "auto__head" },
      h("span", { class: "row__icon" }, icon(kind)),
      h("span", { class: "row__text" },
        h("span", { class: "row__title" }, r.name),
        h("span", { class: "row__sub" }, `Runs ${triggers(r)}`)),
      r.email_error ? pill("failed", "Email check failed") : r.last_run_at ? pill("complete", `Ran ${ago(r.last_run_at)}`) : pill("queued", "Not run yet"),
      h("span", { class: "auto__chevron", "aria-hidden": "true" }, icon("chevron")),
    ),
    h("div", { class: "auto__body" },
      h("p", { class: "auto__text" }, r.instructions),
      h("dl", { class: "facts" },
        h("dt", {}, "Uses"), h("dd", {}, r.connections.length ? r.connections.join(", ") : "Any integration"),
        r.run_at ? h("dt", {}, "Schedule") : null, r.run_at ? h("dd", {}, `${r.schedule} (${data.timeZone})`) : null,
        r.email_query ? h("dt", {}, "Email") : null, r.email_query ? h("dd", {}, r.email_query) : null,
      ),
      r.email_error ? h("p", { class: "b2-error" }, `Email check failed: ${r.email_error}`) : null,
      linkBox(r),
      h("div", { class: "actions" },
        runButton(r),
        h("button", { type: "button", class: "b2-button b2-button--ghost b2-button--small", onclick: () => editRecipe(r, data, reload) }, icon("edit"), h("span", {}, "Edit")),
        h("button", { type: "button", class: "b2-button b2-button--ghost b2-button--small", onclick: () => deleteRecipe(r, reload) }, icon("trash"), h("span", {}, "Delete")),
      ),
    ),
  );
}
