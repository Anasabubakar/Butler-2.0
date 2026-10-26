// Integrations: your Google account, and the services (MCP servers) whose tools Ask Butler
// and your recipes can use. For each tool you choose whether Butler just does it, asks you
// first, or leaves it alone, and you can see what Butler used lately.
import { head, shell } from "./shell";
import { ago, api, busy, button, fill, h, icon, inlineError, modal, SignedOut, status, tabs, toast } from "./ui";

type Rule = "auto" | "ask" | "off";
interface Tool { name: string; description: string; readOnly: boolean; rule: Rule }
interface Connection { id: string; name: string; host: string; checked_at: string | null; error: string | null; tools: Tool[] }
interface Call { at: string; connection: string; tool: string; asked: boolean; status: "done" | "failed"; result: string | null }
interface McpStatus { ready: boolean; connections: Connection[]; calls: Call[] }
interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  backup: { at: string; ok: boolean; note: string } | null;
}

type View = "all" | "accounts" | "other";

const RULE_NAMES: Record<Rule, string> = { auto: "Just do it", ask: "Ask me first", off: "Off" };

export async function renderIntegrations(app: HTMLElement) {
  const accounts = h("section", { class: "integ-group" });
  const other = h("section", { class: "integ-group" });
  const add = button("Add", { kind: "primary", icon: "plus", onclick: () => addConnection(load) });
  let view: View = "all";
  const show = () => {
    accounts.hidden = view === "other";
    other.hidden = view === "accounts";
  };
  app.replaceChildren(shell("integrations",
    head("Integrations", "Connect your accounts and other services so Butler can use them. Anything that sends, changes or deletes asks you first.", add),
    tabs("Show", [{ value: "all", text: "All" }, { value: "accounts", text: "Accounts" }, { value: "other", text: "Other" }] as { value: View; text: string }[],
      view, (v) => { view = v; show(); }),
    accounts,
    other,
  ));
  show();

  google(accounts);
  async function load() {
    let s: McpStatus;
    try {
      s = await api<McpStatus>("/api/mcp");
    } catch (e) {
      if (!(e instanceof SignedOut)) other.replaceChildren(inlineError((e as Error).message));
      return;
    }
    add.disabled = !s.ready;
    fill(other,
      h("h2", { class: "section-title" }, "Other", h("span", { class: "muted" }, "MCP servers like Zapier, Notion or your own")),
      s.ready ? null : inlineError("The server needs BUTLER_VAULT_KEY set before it can keep keys safely."),
      ...(s.connections.length ? s.connections.map((c) => connectionCard(c, load)) : [
        h("div", { class: "empty" }, icon("plug"), h("h3", {}, "Nothing connected yet"),
          h("p", {}, "Add any MCP server by its link. Ask Butler and your recipes can then use its tools."),
          s.ready ? button("Add a connection", { kind: "secondary", icon: "plus", onclick: () => addConnection(load) }) : null),
      ]),
      s.calls.length ? activity(s.calls) : null,
    );
  }
  load();
}

async function google(slot: HTMLElement) {
  const result = new URLSearchParams(location.search).get("google");
  if (result) history.replaceState(null, "", location.pathname + location.hash);
  slot.replaceChildren(h("h2", { class: "section-title" }, "Accounts"), h("p", { class: "muted" }, "Checking Google…"));
  const s = await api<GoogleStatus>("/api/google/status").catch(() => null);
  const title = h("h2", { class: "section-title" }, "Accounts");
  if (!s?.configured) {
    slot.replaceChildren(title, h("article", { class: "b2-card integ" },
      h("div", { class: "integ__head" }, h("span", { class: "integ__logo" }, icon("google")),
        h("div", { class: "row__text" }, h("h3", {}, "Google"), h("p", { class: "muted small" }, "Calendar, Gmail, Contacts and Drive"))),
      h("p", { class: "muted" }, "Google isn't set up on this server yet. Add a Google client to the server to connect Calendar and Gmail.")));
    return;
  }
  const action = s.connected
    ? button("Disconnect", {
      kind: "ghost", small: true,
      onclick: async (e) => {
        if (!confirm("Disconnect Google? Butler will stop adding calendar events, sending email you approve and backing up to Drive. Your saved library stays.")) return;
        await busy(e.currentTarget as HTMLButtonElement, () => api("/api/google/disconnect", { method: "POST" }).catch(() => {}));
        google(slot);
      },
    })
    : button("Connect Google", { kind: "primary", small: true, icon: "google", onclick: () => { location.href = "/api/google/connect"; } });
  slot.replaceChildren(title, h("article", { class: "b2-card integ" },
    h("div", { class: "integ__head" },
      h("span", { class: "integ__logo" }, icon("google")),
      h("div", { class: "row__text" },
        h("h3", {}, "Google"),
        h("p", { class: "muted small" }, s.connected ? s.email ?? "Your Google account" : "Calendar, Gmail, Contacts and Drive")),
      status(s.connected ? "connected" : "offline", s.connected ? "Connected" : "Not connected"),
      action,
    ),
    result === "failed" ? inlineError("Connecting Google didn't go through. Try again, and allow the access Butler asks for.") : null,
    h("ul", { class: "scopes" },
      scope("calendar", "Calendar", "Adds events you ask for, and reads today's for your brief."),
      scope("mail", "Gmail", "Sends only the emails you confirm, and lets recipes start on new email."),
      scope("chat", "Contacts", "Looks up who you mean when you ask to email someone."),
      scope("download", "Drive", "A daily backup of your library."),
    ),
    s.backup
      ? h("p", { class: "integ__note" }, status(s.backup.ok ? "complete" : "failed", s.backup.ok ? "Backup complete" : "Backup failed"),
        ` ${new Date(s.backup.at).toLocaleString()}${s.backup.note ? ` · ${s.backup.note}` : ""}`)
      : null,
  ));
}

function scope(iconName: string, name: string, text: string): HTMLElement {
  return h("li", {}, h("span", { class: "row__icon" }, icon(iconName)), h("span", {}, h("strong", {}, name), h("span", { class: "muted" }, text)));
}

/** Adds an MCP server by its link and key. */
function addConnection(done: () => unknown) {
  const name = h("input", { name: "name", required: true, maxlength: "40", placeholder: "Zapier", autocomplete: "off" });
  const url = h("input", { name: "url", type: "url", required: true, placeholder: "https://…", autocomplete: "off" });
  const auth = h("select", { name: "auth" },
    h("option", { value: "none" }, "No key"),
    h("option", { value: "bearer", selected: true }, "API key (Bearer)"),
    h("option", { value: "header" }, "API key in a header"),
  );
  const key = h("input", { name: "key", type: "password", placeholder: "Key", autocomplete: "new-password", "aria-label": "Key" });
  const header = h("input", { name: "header", placeholder: "Header name, e.g. X-API-Key", autocomplete: "off", hidden: true, "aria-label": "Header name" });
  const go = button("Connect", { kind: "primary", type: "submit" });
  const note = h("p", { class: "muted small", role: "status" });
  auth.addEventListener("change", () => {
    key.hidden = auth.value === "none";
    header.hidden = auth.value !== "header";
  });
  const form = h("form", { class: "form" },
    h("p", { class: "muted" }, "Tools that only read run straight away; anything that could send, change or delete asks you first. You can change that per tool."),
    h("label", { class: "b2-field" }, h("span", { class: "b2-field__label" }, "Name"), name),
    h("label", { class: "b2-field" }, h("span", { class: "b2-field__label" }, "Server link"), url),
    h("label", { class: "b2-field" }, h("span", { class: "b2-field__label" }, "Sign-in"), auth),
    key, header,
    h("div", { class: "actions" }, go),
    note,
  );
  const d = modal("Add a connection", form);
  name.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    note.textContent = "Connecting…";
    try {
      const added = await busy(go, () => api<Connection>("/api/mcp", {
        method: "POST",
        body: JSON.stringify({ name: name.value, url: url.value, auth: auth.value, key: key.value, header: header.value }),
      }));
      toast(`Connected ${added.name}: ${added.tools.length} tools.`);
      d.close();
      await done();
    } catch (err) {
      note.textContent = (err as Error).message;
    }
  });
}

function connectionCard(conn: Connection, reload: () => unknown): HTMLElement {
  const recheck = button("Check again", {
    kind: "ghost", small: true,
    onclick: async (e) => {
      await busy(e.currentTarget as HTMLButtonElement, () => api(`/api/mcp/${conn.id}/refresh`, { method: "POST" }).catch(() => {}));
      await reload();
    },
  });
  const remove = button("Remove", {
    kind: "ghost", small: true,
    onclick: async () => {
      if (!confirm(`Remove ${conn.name}? Butler forgets its link and key.`)) return;
      await api(`/api/mcp/${conn.id}`, { method: "DELETE" }).catch(() => {});
      await reload();
    },
  });
  return h("details", { class: "auto integ-conn" },
    h("summary", { class: "auto__head" },
      h("span", { class: "integ__logo" }, h("span", {}, conn.name.charAt(0).toUpperCase())),
      h("span", { class: "row__text" },
        h("span", { class: "row__title" }, conn.name),
        h("span", { class: "row__sub" }, [conn.host, `${conn.tools.length} tools`, conn.checked_at ? `checked ${ago(conn.checked_at)}` : ""].filter(Boolean).join(" · "))),
      conn.error ? status("failed", "Check failed") : status("connected"),
      h("span", { class: "auto__chevron", "aria-hidden": "true" }, icon("chevron")),
    ),
    h("div", { class: "auto__body" },
      conn.error ? inlineError(`Last check failed: ${conn.error}`) : null,
      h("ul", { class: "tools" }, ...conn.tools.map((t) => toolRow(conn, t))),
      h("div", { class: "actions" }, recheck, remove),
    ),
  );
}

function toolRow(conn: Connection, tool: Tool): HTMLElement {
  const pick = h("select", { "aria-label": `${tool.name}: what Butler may do` },
    ...(["auto", "ask", "off"] as Rule[]).map((r) => h("option", { value: r, selected: r === tool.rule }, RULE_NAMES[r])));
  pick.addEventListener("change", async () => {
    const rule = pick.value as Rule;
    if (rule === "auto" && !tool.readOnly && !confirm(`${tool.name} can change things. Let Butler use it without asking you first?`)) {
      pick.value = tool.rule;
      return;
    }
    try {
      await api(`/api/mcp/${conn.id}/rule`, { method: "PUT", body: JSON.stringify({ tool: tool.name, rule }) });
      tool.rule = rule;
    } catch (e) {
      pick.value = tool.rule;
      toast((e as Error).message);
    }
  });
  return h("li", { class: "tool" },
    h("div", { class: "tool__text" },
      h("span", { class: "tool__name" }, tool.name, tool.readOnly ? h("span", { class: "tag" }, "reads only") : null),
      h("span", { class: "muted small" }, tool.description.slice(0, 220)),
    ),
    pick,
  );
}

function activity(calls: Call[]): HTMLElement {
  return h("section", { class: "b2-card integ-log" },
    h("h3", {}, "What Butler used lately"),
    h("ul", { class: "rows" }, ...calls.map((c) =>
      h("li", { class: "row", title: c.result ?? "" },
        h("span", { class: "row__icon" }, icon(c.status === "done" ? "check" : "alert")),
        h("span", { class: "row__text" },
          h("span", { class: "row__title" }, `${c.connection} · ${c.tool}`),
          h("span", { class: "row__sub" }, [c.status === "done" ? "Worked" : "Failed", c.asked ? "you said yes" : null, ago(c.at)].filter(Boolean).join(" · "))),
      ))),
  );
}
