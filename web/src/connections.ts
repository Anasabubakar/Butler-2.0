// Connections: MCP servers whose tools Ask Butler can use. Add one by its link and key,
// choose per tool whether Butler just does it, asks you first, or leaves it alone,
// and see what Butler used lately.

type Rule = "auto" | "ask" | "off";

interface Tool { name: string; description: string; readOnly: boolean; rule: Rule }

interface Connection {
  id: string;
  name: string;
  host: string;
  checked_at: string | null;
  error: string | null;
  tools: Tool[];
}

interface Call {
  at: string;
  connection: string;
  tool: string;
  asked: boolean;
  status: "done" | "failed";
  result: string | null;
}

interface Status { ready: boolean; connections: Connection[]; calls: Call[] }

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<Record<string, string | boolean | EventListener>>,
  ...children: Array<Node | string | null | undefined | false>
) => HTMLElementTagNameMap[K];

const RULE_NAMES: Record<Rule, string> = { auto: "Just do it", ask: "Ask me first", off: "Off" };

/** Opens the Connections panel over the library. */
export function openConnections(api: Api, h: H, ago: (iso: string) => string) {
  const body = h("div", { class: "conn-body" }, h("p", { class: "muted" }, "Loading…"));
  const close = h("button", { class: "viewer-close", "aria-label": "Close", title: "Close (Esc)" }, "×");
  const dialog = h("dialog", { class: "conn", "aria-label": "Connections" },
    h("div", { class: "conn-bar" }, h("h2", {}, "Connections"), close),
    body,
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();

  const problem = (e: unknown) => h("p", { class: "conn-error", role: "alert" }, (e as Error).message);

  async function load() {
    let status: Status;
    try {
      status = await api<Status>("/api/mcp");
    } catch (e) {
      body.replaceChildren(problem(e));
      return;
    }
    body.replaceChildren(
      h("p", { class: "muted" },
        "Add any MCP server (Zapier, Notion, your own) by its link. Ask Butler can then use its tools. " +
          "Tools that only read run straight away; anything that could send, change or delete asks you first."),
      status.ready ? addForm() : h("p", { class: "conn-error" }, "The server needs BUTLER_VAULT_KEY set before it can keep keys safely."),
      ...status.connections.map(card),
      status.calls.length ? activity(status.calls) : null,
    );
  }

  function addForm(): HTMLElement {
    const name = h("input", { name: "name", required: true, maxlength: "40", placeholder: "Zapier", autocomplete: "off" });
    const url = h("input", { name: "url", type: "url", required: true, placeholder: "https://…", autocomplete: "off" });
    const auth = h("select", { name: "auth" },
      h("option", { value: "none" }, "No key"),
      h("option", { value: "bearer", selected: true }, "API key (Bearer)"),
      h("option", { value: "header" }, "API key in a header"),
    );
    const key = h("input", { name: "key", type: "password", placeholder: "Key", autocomplete: "new-password" });
    const header = h("input", { name: "header", placeholder: "Header name, e.g. X-API-Key", autocomplete: "off", hidden: true });
    const go = h("button", { type: "submit", class: "conn-primary" }, "Connect");
    const note = h("p", { class: "muted small" });
    const sync = () => {
      key.hidden = auth.value === "none";
      header.hidden = auth.value !== "header";
    };
    auth.addEventListener("change", sync);
    const form = h("form", { class: "conn-add" },
      h("label", {}, "Name", name),
      h("label", {}, "Server link", url),
      h("label", {}, "Sign-in", auth),
      key, header, go, note,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      go.disabled = true;
      note.textContent = "Connecting…";
      try {
        const added = await api<Connection>("/api/mcp", {
          method: "POST",
          body: JSON.stringify({ name: name.value, url: url.value, auth: auth.value, key: key.value, header: header.value }),
        });
        note.textContent = `Connected. ${added.tools.length} tools.`;
        await load();
      } catch (err) {
        note.textContent = (err as Error).message;
        go.disabled = false;
      }
    });
    return form;
  }

  function card(conn: Connection): HTMLElement {
    const recheck = h("button", { class: "ghost" }, "Check again");
    recheck.addEventListener("click", async () => {
      recheck.disabled = true;
      recheck.textContent = "Checking…";
      await api(`/api/mcp/${conn.id}/refresh`, { method: "POST" }).catch(() => {});
      await load();
    });
    const remove = h("button", { class: "ghost" }, "Remove");
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove ${conn.name}? Butler forgets its link and key.`)) return;
      await api(`/api/mcp/${conn.id}`, { method: "DELETE" }).catch(() => {});
      await load();
    });
    const when = conn.checked_at ? `checked ${ago(conn.checked_at)}` : "";
    return h("section", { class: "conn-card" },
      h("div", { class: "conn-head" },
        h("div", {}, h("h3", {}, conn.name), h("p", { class: "muted small" }, [conn.host, `${conn.tools.length} tools`, when].filter(Boolean).join(" · "))),
        recheck, remove,
      ),
      conn.error ? h("p", { class: "conn-error" }, `Last check failed: ${conn.error}`) : null,
      h("ul", { class: "conn-tools" }, ...conn.tools.map((t) => toolRow(conn, t))),
    );
  }

  function toolRow(conn: Connection, tool: Tool): HTMLElement {
    const pick = h("select", { "aria-label": `${tool.name}: what Butler may do` },
      ...(["auto", "ask", "off"] as Rule[]).map((r) => h("option", { value: r, selected: r === tool.rule }, RULE_NAMES[r])));
    pick.addEventListener("change", async () => {
      const rule = pick.value as Rule;
      if (rule === "auto" && !tool.readOnly &&
        !confirm(`${tool.name} can change things. Let Butler use it without asking you first?`)) {
        pick.value = tool.rule;
        return;
      }
      try {
        await api(`/api/mcp/${conn.id}/rule`, { method: "PUT", body: JSON.stringify({ tool: tool.name, rule }) });
        tool.rule = rule;
      } catch (e) {
        pick.value = tool.rule;
        alert((e as Error).message);
      }
    });
    return h("li", {},
      h("div", {},
        h("strong", {}, tool.name),
        tool.readOnly ? h("span", { class: "conn-tag" }, "reads only") : null,
        h("p", { class: "muted small" }, tool.description.slice(0, 220)),
      ),
      pick,
    );
  }

  function activity(calls: Call[]): HTMLElement {
    return h("section", { class: "conn-card" },
      h("h3", {}, "What Butler used lately"),
      h("ul", { class: "conn-log" }, ...calls.map((c) =>
        h("li", {},
          h("span", { class: `conn-dot ${c.status}` }),
          h("span", {}, `${c.connection}/${c.tool}`, c.asked ? h("span", { class: "muted" }, " · you said yes") : null),
          h("span", { class: "muted small" }, ago(c.at)),
        ))),
    );
  }

  load();
}
