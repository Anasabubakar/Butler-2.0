// MCP connections: other services (Zapier, Notion, your own server...) that offer tools
// over the Model Context Protocol. You add one by its link and key on the website; Ask
// Butler can then use its tools. Tools that only read run straight away; anything that
// could send, change or delete asks you first, unless you say otherwise per tool.
import { Client } from "npm:@modelcontextprotocol/sdk@1.32.1/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.32.1/client/streamableHttp.js";
import { SSEClientTransport } from "npm:@modelcontextprotocol/sdk@1.32.1/client/sse.js";
import { sql } from "./db.ts";
import { checkUrl, guardedFetch } from "./outbound.ts";
import { lock, unlock } from "./vault.ts";

export const RULES = ["auto", "ask", "off"] as const;
export type Rule = typeof RULES[number];

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>; // the JSON Schema of its arguments
  readOnly: boolean; // the server says it only reads
}

export interface Connection {
  id: string;
  name: string;
  host: string;
  tools: Tool[];
  rules: Record<string, Rule>;
  checked_at: string | null;
  error: string | null;
}

/** Where the server is and how to sign in to it. Only ever stored locked. */
export interface Secret {
  url: string;
  headers: Record<string, string>;
}

export const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;
const HEADER_RE = /^[A-Za-z0-9-]{1,60}$/;
const CONNECT_MS = 20_000;
const CALL_MS = 60_000;
const MAX_TOOLS = 100;
const MAX_RESULT = 8_000;

let fetcher: typeof fetch = (input, init) => guardedFetch(input, init);

/** Swaps the fetch used to reach servers (tests use a plain one, to reach a local server). */
export const useFetch = (f: typeof fetch) => { fetcher = f; };

/** How the server wants its key: "none", "bearer" (Authorization: Bearer KEY) or a named header. */
export function headersFor(auth: string, key: string, header = ""): Record<string, string> {
  if (auth === "none" || !key) return {};
  if (auth === "bearer") return { Authorization: `Bearer ${key}` };
  if (auth === "header") {
    if (!HEADER_RE.test(header) || /^(host|content-type|content-length|accept|cookie)$/i.test(header)) {
      throw new Error("that header name won't work");
    }
    return { [header]: key };
  }
  throw new Error("unknown sign-in type");
}

/** The rule a tool gets until you choose: read-only tools run, the rest ask first. */
export const defaultRule = (t: Tool): Rule => (t.readOnly ? "auto" : "ask");

export const ruleFor = (c: Connection, t: Tool): Rule => c.rules[t.name] ?? defaultRule(t);

/** Opens a session with the server: the current way (Streamable HTTP), then the older SSE way. */
async function open(secret: Secret): Promise<Client> {
  const url = new URL(secret.url);
  const options = { requestInit: { headers: secret.headers }, fetch: fetcher };
  let first: unknown;
  for (const transport of [new StreamableHTTPClientTransport(url, options), new SSEClientTransport(url, options)]) {
    const client = new Client({ name: "Butler", version: "2.0" });
    try {
      await client.connect(transport, { timeout: CONNECT_MS });
      return client;
    } catch (e) {
      first ??= e;
      await client.close().catch(() => {});
    }
  }
  throw new Error(`couldn't connect: ${plainError(first)}`);
}

function plainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 401 || /\b401\b|unauthori[sz]ed/i.test(text)) return "the server said the key is wrong or missing";
  if (code === 403 || /\b403\b|forbidden/i.test(text)) return "the server refused Butler";
  if (code === 404 || /\b404\b/.test(text)) return "nothing at that address; check the link";
  return text.slice(0, 200);
}

/** The tools the server offers. */
export async function discover(secret: Secret): Promise<Tool[]> {
  const client = await open(secret);
  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: CONNECT_MS });
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          description: (t.description ?? t.title ?? "").slice(0, 1000),
          schema: t.inputSchema as Record<string, unknown>,
          readOnly: t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint !== true,
        });
      }
      cursor = page.nextCursor;
    } while (cursor && tools.length < MAX_TOOLS);
    return tools.slice(0, MAX_TOOLS);
  } finally {
    await client.close().catch(() => {});
  }
}

type Content = { type: string; text?: string; resource?: { text?: string; uri?: string } };

/** What a tool sent back, as text you could read. */
export function resultText(result: { content?: unknown; structuredContent?: unknown }): string {
  const parts = (Array.isArray(result.content) ? result.content as Content[] : []).map((c) =>
    c.type === "text" ? c.text ?? ""
    : c.type === "resource" ? c.resource?.text ?? c.resource?.uri ?? ""
    : c.type === "image" ? "[a picture]"
    : c.type === "audio" ? "[a sound clip]"
    : c.type === "resource_link" ? String((c as { uri?: string }).uri ?? "")
    : ""
  ).filter(Boolean);
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n").trim() || "(nothing came back)";
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}…` : text;
}

/** Runs one tool. Throws with the server's words if the tool failed. */
export async function run(secret: Secret, tool: string, args: Record<string, unknown>): Promise<string> {
  const client = await open(secret);
  try {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_MS });
    const text = resultText(result);
    if (result.isError) throw new Error(text.slice(0, 500));
    return text;
  } finally {
    await client.close().catch(() => {});
  }
}

// --- stored connections --------------------------------------------------------------

const COLUMNS = sql`id, name, host, tools, rules, checked_at, error`;

export const list = () => sql<Connection[]>`select ${COLUMNS} from mcp_connections order by created_at`;

async function secretOf(id: string): Promise<Secret> {
  const [row] = await sql<{ secret: string }[]>`select secret from mcp_connections where id = ${id}`;
  if (!row) throw new Error("that connection is gone");
  return JSON.parse(await unlock(row.secret)) as Secret;
}

/** Checks the link, connects, and keeps the connection with the tools it offers. */
export async function add(name: string, link: string, headers: Record<string, string>): Promise<Connection> {
  if (!NAME_RE.test(name)) throw new Error("give it a short name: letters, numbers, spaces, . _ -");
  const url = await checkUrl(link);
  const secret: Secret = { url: url.href, headers };
  const tools = await discover(secret);
  const [row] = await sql<Connection[]>`
    insert into mcp_connections (name, host, secret, tools, checked_at)
    values (${name}, ${url.host}, ${await lock(JSON.stringify(secret))}, ${sql.json(tools as never)}, now())
    returning ${COLUMNS}`;
  return row;
}

/** Asks the server again which tools it has. */
export async function refresh(id: string): Promise<Connection> {
  let tools: Tool[] | null = null;
  let error: string | null = null;
  try {
    tools = await discover(await secretOf(id));
  } catch (e) {
    error = String(e instanceof Error ? e.message : e).slice(0, 300);
  }
  const [row] = await sql<Connection[]>`
    update mcp_connections set checked_at = now(), error = ${error},
      tools = coalesce(${tools ? sql.json(tools as never) : null}::jsonb, tools)
    where id = ${id} returning ${COLUMNS}`;
  if (!row) throw new Error("that connection is gone");
  return row;
}

export async function setRule(id: string, tool: string, rule: Rule) {
  await sql`update mcp_connections set rules = rules || ${sql.json({ [tool]: rule })} where id = ${id}`;
}

export async function remove(id: string) {
  await sql`delete from mcp_connections where id = ${id}`;
}

// --- using tools from Ask Butler ---------------------------------------------------------

/** A tool Ask Butler may pick, named "Connection/tool". */
export interface Offer {
  key: string;
  connection: Connection;
  tool: Tool;
  rule: Rule;
}

/** Every tool that isn't switched off. */
export async function offers(): Promise<Offer[]> {
  return (await list()).flatMap((c) =>
    c.tools.map((t) => ({ key: `${c.name}/${t.name}`, connection: c, tool: t, rule: ruleFor(c, t) }))
      .filter((o) => o.rule !== "off")
  );
}

/** Runs a tool you chose (or said yes to), and writes it in the log. */
export async function use(offer: Offer, args: Record<string, unknown>, asked: boolean): Promise<string> {
  let status: "done" | "failed" = "done";
  let result: string;
  try {
    result = await run(await secretOf(offer.connection.id), offer.tool.name, args);
    return result;
  } catch (e) {
    status = "failed";
    result = plainError(e);
    throw new Error(result);
  } finally {
    await sql`insert into mcp_calls (connection_id, connection, tool, args, asked, status, result)
      values (${offer.connection.id}, ${offer.connection.name}, ${offer.tool.name}, ${sql.json(args as never)},
        ${asked}, ${status}, ${result!.slice(0, 2000)})`.catch((e) => console.error("mcp log", String(e).slice(0, 200)));
  }
}

export interface Call {
  at: string;
  connection: string;
  tool: string;
  args: Record<string, unknown>;
  asked: boolean;
  status: "done" | "failed";
  result: string | null;
}

export const recentCalls = (limit = 30) =>
  sql<Call[]>`select at, connection, tool, args, asked, status, result from mcp_calls order by at desc limit ${limit}`;
