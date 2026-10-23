// Recipes: instructions you save once and run by name ("run my morning check") from Ask
// Butler, or from here. Steps that would change something wait for your yes, here or on
// your phone and laptop.

interface Recipe {
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

interface Waiting { id: string; from: string; tool: string; details: string; expires: string }

interface Status { recipes: Recipe[]; connections: string[]; waiting: Waiting[]; timeZone: string }

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<Record<string, string | boolean | EventListener>>,
  ...children: Array<Node | string | null | undefined | false>
) => HTMLElementTagNameMap[K];

/** Ideas to start from, in the spirit of Poke's recipes. */
const IDEAS: [string, string][] = [
  ["Morning check", "Look at my tasks due today and my calendar for today. Tell me the three things to do first, in order, with times."],
  ["Inbox sweep", "Find emails from the last day that need a reply from me. One line each: who, what they want, how urgent."],
  ["End of day", "List what I finished today and what's left for tomorrow, from my task list. Keep it short."],
];

/** Opens the Recipes panel over the library. */
export function openRecipes(api: Api, h: H, ago: (iso: string) => string) {
  const body = h("div", { class: "conn-body" }, h("p", { class: "muted" }, "Loading…"));
  const close = h("button", { class: "viewer-close", "aria-label": "Close", title: "Close (Esc)" }, "×");
  const dialog = h("dialog", { class: "conn", "aria-label": "Recipes" },
    h("div", { class: "conn-bar" }, h("h2", {}, "Recipes"), close),
    body,
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();

  let status: Status = { recipes: [], connections: [], waiting: [], timeZone: "UTC" };

  async function load() {
    try {
      status = await api<Status>("/api/recipes");
    } catch (e) {
      body.replaceChildren(h("p", { class: "conn-error", role: "alert" }, (e as Error).message));
      return;
    }
    body.replaceChildren(
      h("p", { class: "muted" },
        "Save instructions once, then say \"run my morning check\" to Ask Butler. A recipe can use your connections' tools: " +
          "ones that only read run on their own; anything that sends, changes or deletes waits for your yes."),
      ...(status.waiting.length ? [waitingList(status.waiting)] : []),
      ...status.recipes.map(card),
      form(null),
    );
  }

  function waitingList(items: Waiting[]): HTMLElement {
    return h("section", { class: "conn-card waiting" },
      h("h3", {}, "Waiting for your yes"),
      h("ul", { class: "conn-tools" }, ...items.map((w) => {
        const yes = h("button", { class: "conn-primary" }, "Yes, do it");
        const no = h("button", { class: "ghost" }, "No");
        const answer = async (ok: boolean) => {
          yes.disabled = no.disabled = true;
          try {
            alert((await api<{ say: string }>(`/api/approvals/${w.id}`, { method: "POST", body: JSON.stringify({ yes: ok }) })).say);
          } catch (e) {
            alert((e as Error).message);
          }
          await load();
        };
        yes.addEventListener("click", () => answer(true));
        no.addEventListener("click", () => answer(false));
        return h("li", {},
          h("div", {}, h("strong", {}, w.tool), h("span", { class: "conn-tag" }, w.from), h("pre", { class: "recipe-details" }, w.details)),
          h("div", { class: "recipe-actions" }, yes, no),
        );
      })),
    );
  }

  function card(r: Recipe): HTMLElement {
    const out = h("p", { class: "recipe-out", hidden: true, role: "status" });
    const runIt = h("button", { class: "conn-primary" }, "Run");
    runIt.addEventListener("click", async () => {
      runIt.disabled = true;
      out.hidden = false;
      out.textContent = "Working…";
      try {
        const done = await api<{ say: string; confirm?: string }>(`/api/recipes/${r.id}/run`, { method: "POST" });
        out.textContent = done.say;
        if (done.confirm) {
          const ok = confirm(done.say);
          const after = await api<{ say: string }>(`/api/approvals/${done.confirm}`, { method: "POST", body: JSON.stringify({ yes: ok }) });
          out.textContent = after.say;
        }
      } catch (e) {
        out.textContent = (e as Error).message;
      }
      runIt.disabled = false;
    });
    const edit = h("button", { class: "ghost" }, "Edit");
    const holder = h("section", { class: "conn-card" });
    edit.addEventListener("click", () => holder.replaceWith(form(r)));
    const remove = h("button", { class: "ghost" }, "Delete");
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete the recipe "${r.name}"?`)) return;
      await api(`/api/recipes/${r.id}`, { method: "DELETE" }).catch(() => {});
      await load();
    });
    const uses = r.connections.length ? `Uses ${r.connections.join(", ")}` : "Uses any connection";
    holder.append(
      h("div", { class: "conn-head" },
        h("div", {}, h("h3", {}, r.name),
          h("p", { class: "muted small" },
            [uses, r.run_at ? `runs ${r.schedule}` : null, r.last_run_at ? `ran ${ago(r.last_run_at)}` : "not run yet"].filter(Boolean).join(" · "))),
        runIt, edit, remove,
      ),
      h("p", { class: "recipe-text" }, r.instructions),
      out,
    );
    return holder;
  }

  function form(r: Recipe | null): HTMLElement {
    const name = h("input", { name: "name", required: true, maxlength: "60", placeholder: "Morning check", autocomplete: "off", value: r?.name ?? "" });
    const text = h("textarea", { name: "instructions", required: true, maxlength: "4000", rows: "4",
      placeholder: "What should Butler do? Write it like you'd tell a person." });
    text.value = r?.instructions ?? "";
    const boxes = status.connections.map((c) =>
      h("label", { class: "recipe-check" },
        h("input", { type: "checkbox", value: c, checked: Boolean(r?.connections.some((x) => x.toLowerCase() === c.toLowerCase())) }), c));
    // Runs on its own: a time (your time zone) and the days.
    const scheduled = h("input", { type: "checkbox", checked: Boolean(r?.run_at) });
    const time = h("input", { type: "time", value: r?.run_at ?? "08:00", "aria-label": "Time" });
    const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) =>
      h("label", { class: "recipe-check" },
        h("input", { type: "checkbox", value: String(d), checked: r?.run_at ? r.run_days.includes(d) : true }),
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]));
    const when = h("div", { class: "recipe-when", hidden: !r?.run_at }, time, ...dayBoxes);
    scheduled.addEventListener("change", () => { when.hidden = !scheduled.checked; });
    // Starts on email: a Gmail search, and each new email that matches runs it.
    const onEmail = h("input", { type: "checkbox", checked: Boolean(r?.email_query) });
    const query = h("input", { maxlength: "300", placeholder: "from:mybank.com subject:alert", autocomplete: "off",
      "aria-label": "Gmail search", value: r?.email_query ?? "", hidden: !r?.email_query });
    onEmail.addEventListener("change", () => { query.hidden = !onEmail.checked; if (onEmail.checked) query.focus(); });
    const save = h("button", { type: "submit", class: "conn-primary" }, r ? "Save" : "Add recipe");
    const note = h("p", { class: "muted small" });
    const ideas = r ? null : h("p", { class: "recipe-ideas" }, "Ideas: ", ...IDEAS.map(([n, t]) => {
      const b = h("button", { type: "button", class: "conn-tag" }, n);
      b.addEventListener("click", () => { name.value = n; text.value = t; text.focus(); });
      return b;
    }));
    const el = h("form", { class: "conn-card recipe-form" },
      h("h3", {}, r ? `Edit ${r.name}` : "New recipe"),
      ideas,
      h("label", {}, "Name", name),
      h("label", {}, "Instructions", text),
      boxes.length
        ? h("fieldset", {}, h("legend", {}, "Connections it may use (none ticked: any)"), ...boxes)
        : h("p", { class: "muted small" }, "No connections yet, so it can only answer. Add some under Connections."),
      h("label", { class: "recipe-check" }, scheduled, `Run on its own (${status.timeZone} time), and send me the result`),
      when,
      h("label", { class: "recipe-check" }, onEmail, "Also run it when a new email matches this Gmail search"),
      query,
      h("div", { class: "recipe-actions" }, save,
        r ? h("button", { type: "button", class: "ghost", onclick: () => load() }, "Cancel") : null),
      note,
    );
    el.addEventListener("submit", async (e) => {
      e.preventDefault();
      save.disabled = true;
      const connections = boxes.map((b) => b.querySelector("input")!).filter((i) => i.checked).map((i) => i.value);
      try {
        await api(r ? `/api/recipes/${r.id}` : "/api/recipes", {
          method: r ? "PUT" : "POST",
          body: JSON.stringify({
            name: name.value, instructions: text.value, connections,
            run_at: scheduled.checked ? time.value : null,
            run_days: dayBoxes.map((b) => b.querySelector("input")!).filter((i) => i.checked).map((i) => Number(i.value)),
            email_query: onEmail.checked ? query.value : null,
          }),
        });
        await load();
      } catch (err) {
        note.textContent = (err as Error).message;
        save.disabled = false;
      }
    });
    return el;
  }

  load();
}
