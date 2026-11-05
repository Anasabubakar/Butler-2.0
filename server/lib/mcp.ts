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
import * as oauth from "./mcpauth.ts";

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
  auth: "key" | "oauth"; // a key you pasted, or a sign-in in the browser
  signin_needed: boolean; // the sign-in ran out or hasn't happened yet: press Reconnect
  tools: Tool[];
  rules: Record<string, Rule>;
  checked_at: string | null;
  error: string | null;
}

/** Where the server is and how to sign in to it. Only ever stored locked. */
export interface Secret {
  url: string;
  headers: Record<string, string>;
  oauth?: oauth.OAuth; // only for connections you sign in to
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

/** The headers that sign Butler in: your key, or the current OAuth token. */
export function headersOf(secret: Secret): Record<string, string> {
  const token = secret.oauth?.tokens?.access_token;
  return token ? { ...secret.headers, Authorization: `Bearer ${token}` } : secret.headers;
}

/** The rule a tool gets until you choose: read-only tools run, the rest ask first. */
export const defaultRule = (t: Tool): Rule => (t.readOnly ? "auto" : "ask");

export const ruleFor = (c: Connection, t: Tool): Rule => c.rules[t.name] ?? defaultRule(t);

/** The server said Butler isn't signed in (HTTP 401). */
export class Unauthorized extends Error {}

const unauthorized = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 401 || /\b401\b|unauthori[sz]ed/i.test(e instanceof Error ? e.message : String(e));
};

/** Opens a session with the server: the current way (Streamable HTTP), then the older SSE way. */
async function open(secret: Secret): Promise<Client> {
  const url = new URL(secret.url);
  const options = { requestInit: { headers: headersOf(secret) }, fetch: fetcher };
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
  if (unauthorized(first)) throw new Unauthorized(`couldn't connect: ${plainError(first)}`);
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

const COLUMNS = sql`id, name, host, auth, signin_needed, tools, rules, checked_at, error`;

export const list = () => sql<Connection[]>`select ${COLUMNS} from mcp_connections order by created_at`;

async function secretOf(id: string): Promise<Secret> {
  const [row] = await sql<{ secret: string }[]>`select secret from mcp_connections where id = ${id}`;
  if (!row) throw new Error("that connection is gone");
  return JSON.parse(await unlock(row.secret)) as Secret;
}

async function saveSecret(id: string, secret: Secret) {
  await sql`update mcp_connections set secret = ${await lock(JSON.stringify(secret))} where id = ${id}`;
}

async function markSignInNeeded(id: string, message: string) {
  await sql`update mcp_connections set signin_needed = true, error = ${message.slice(0, 300)} where id = ${id}`;
}

/** Refreshes running right now, per connection, so two calls don't both spend a refresh token. */
const renewing = new Map<string, Promise<Secret>>();

/** Swaps the connection's OAuth tokens for fresh ones and keeps them. */
function renewSecret(id: string, secret: Secret): Promise<Secret> {
  const running = renewing.get(id);
  if (running) return running;
  const job = (async () => {
    const fresh = { ...secret, oauth: await oauth.renew(secret.oauth!, fetcher) };
    await saveSecret(id, fresh);
    return fresh;
  })().finally(() => renewing.delete(id));
  renewing.set(id, job);
  return job;
}

/**
 * Runs `work` with the connection's link and sign-in. OAuth tokens are refreshed first when
 * they're about to run out, and once more if the server says no. When only signing in again
 * will help, the connection is marked "Reconnect" and the error says so.
 */
async function withSecret<T>(id: string, work: (secret: Secret) => Promise<T>): Promise<T> {
  let secret = await secretOf(id);
  if (!secret.oauth) return work(secret);
  try {
    if (oauth.stale(secret.oauth)) secret = await renewSecret(id, secret);
    try {
      return await work(secret);
    } catch (e) {
      if (!(e instanceof Unauthorized)) throw e;
      secret = await renewSecret(id, secret);
      return await work(secret).catch((again) => {
        throw again instanceof Unauthorized ? new oauth.SignInNeeded() : again;
      });
    }
  } catch (e) {
    if (e instanceof oauth.SignInNeeded) {
      await markSignInNeeded(id, e.message);
      throw new Error(`${await nameOf(id)} needs you to sign in again: open Integrations and press Reconnect`);
    }
    throw e;
  }
}

async function nameOf(id: string): Promise<string> {
  const [row] = await sql<{ name: string }[]>`select name from mcp_connections where id = ${id}`;
  return row?.name ?? "that connection";
}

/** Checks the link, connects, and keeps the connection with the tools it offers. */
export async function add(name: string, link: string, headers: Record<string, string>): Promise<Connection> {
  if (!NAME_RE.test(name)) throw new Error("give it a short name: letters, numbers, spaces, . _ -");
  const url = await checkUrl(link);
  const secret: Secret = { url: url.href, headers };
  const tools = await discover(secret).catch((e) => {
    if (e instanceof Unauthorized && !Object.keys(headers).length) {
      throw new Error("that server wants you to sign in: pick Sign in with OAuth, or paste a key");
    }
    throw e;
  });
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
    tools = await withSecret(id, discover);
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
  ).filter((o) => !o.connection.signin_needed);
}

/** Runs a tool you chose (or said yes to), and writes it in the log. */
export async function use(offer: Offer, args: Record<string, unknown>, asked: boolean): Promise<string> {
  let status: "done" | "failed" = "done";
  let result: string;
  try {
    result = await withSecret(offer.connection.id, (secret) => run(secret, offer.tool.name, args));
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

// --- signing in with OAuth ------------------------------------------------------------------

/** Where the service sends you back after you sign in: PUBLIC_URL/api/mcp/oauth/callback. */
export function redirectUri(): string {
  const base = (Deno.env.get("PUBLIC_URL") ?? "").replace(/\/$/, "");
  if (!base) throw new Error("set PUBLIC_URL on the server first, so the service knows where to send you back");
  return `${base}/api/mcp/oauth/callback`;
}

const hash = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Keeps a connection you'll sign in to. It has no tools until you finish signing in.
 * `given` is the app you made on the service, for services that don't let Butler sign up itself.
 */
export async function addOAuth(name: string, link: string, given: oauth.Prepare): Promise<Connection> {
  if (!NAME_RE.test(name)) throw new Error("give it a short name: letters, numbers, spaces, . _ -");
  const url = await checkUrl(link);
  const [taken] = await sql`select 1 from mcp_connections where name = ${name}`;
  if (taken) throw new Error("you already have a connection with that name");
  const secret: Secret = { url: url.href, headers: {}, oauth: await oauth.prepare(url.href, given, redirectUri(), fetcher) };
  const [row] = await sql<Connection[]>`
    insert into mcp_connections (name, host, secret, auth, signin_needed)
    values (${name}, ${url.host}, ${await lock(JSON.stringify(secret))}, 'oauth', true)
    returning ${COLUMNS}`;
  return row;
}

/** The service's sign-in page for this connection, with `state` to match when you come back. */
export async function signInLink(id: string, state: string): Promise<string> {
  const secret = await secretOf(id);
  if (!secret.oauth) throw new Error("that connection uses a key, not a sign-in");
  const { url, verifier } = await oauth.begin(secret.oauth, redirectUri(), state);
  await sql`delete from mcp_oauth_pending where created_at < now() - interval '10 minutes'`;
  await sql`insert into mcp_oauth_pending (state_hash, connection_id, verifier)
    values (${await hash(state)}, ${id}, ${await lock(verifier)})`;
  return url;
}

/** Finishes a sign-in you started in the last 10 minutes, then asks the server for its tools. */
export async function finishSignIn(state: string, code: string): Promise<Connection> {
  const [pending] = await sql<{ connection_id: string; verifier: string }[]>`
    delete from mcp_oauth_pending where state_hash = ${await hash(state)}
      and created_at > now() - interval '10 minutes'
    returning connection_id, verifier`;
  if (!pending) throw new Error("that sign-in is too old or was already used; press Reconnect to try again");
  const id = pending.connection_id;
  const secret = await secretOf(id);
  if (!secret.oauth) throw new Error("that connection uses a key, not a sign-in");
  const signedIn = { ...secret, oauth: await oauth.finish(secret.oauth, code, await unlock(pending.verifier), redirectUri(), fetcher) };
  await saveSecret(id, signedIn);
  await sql`update mcp_connections set signin_needed = false, error = null where id = ${id}`;
  return refresh(id);
}
