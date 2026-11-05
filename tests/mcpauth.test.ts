import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeBase64Url } from "jsr:@std/encoding@1.0.10/base64url";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.32.1/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.32.1/server/webStandardStreamableHttp.js";
import { discover, useFetch } from "../server/lib/mcp.ts";
import { begin, finish, plain, prepare, renew, SignInNeeded, stale } from "../server/lib/mcpauth.ts";

const REDIRECT = "https://butler.example/api/mcp/oauth/callback";

const challengeOf = async (verifier: string) =>
  encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

/**
 * A service on localhost the way the MCP spec describes one: an MCP server that points at
 * its sign-in server, which lets apps sign up, hands out codes with PKCE, and rotates
 * refresh tokens. `dcr: false` makes it one where you must make an app first (like GitHub).
 */
function service({ dcr = true, broken = false } = {}) {
  const codes = new Map<string, { challenge: string; client: string; resource: string | null }>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const registered: Record<string, unknown>[] = [];
  let n = 0;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const url = new URL(req.url);
    const base = url.origin;
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return json({ resource: `${base}/mcp`, authorization_servers: [`${base}/auth`], scopes_supported: ["read", "write"] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
      return json({
        issuer: `${base}/auth`,
        authorization_endpoint: `${base}/auth/authorize`,
        token_endpoint: `${base}/auth/token`,
        ...(dcr ? { registration_endpoint: `${base}/auth/register` } : {}),
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
    }
    if (url.pathname === "/auth/register" && req.method === "POST") {
      const body = await req.json();
      registered.push(body);
      return json({ ...body, client_id: `client-${registered.length}` }, 201);
    }
    if (url.pathname === "/auth/token" && req.method === "POST") {
      if (broken) return new Response("down", { status: 503 });
      const form = new URLSearchParams(await req.text());
      const issue = () => {
        const a = `access-${++n}`, r = `refresh-${n}`;
        access.add(a);
        refresh.add(r);
        return json({ access_token: a, refresh_token: r, token_type: "Bearer", expires_in: 3600 });
      };
      if (form.get("grant_type") === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!code || code.client !== form.get("client_id") || code.challenge !== await challengeOf(form.get("code_verifier") ?? "")) {
          return json({ error: "invalid_grant" }, 400);
        }
        if (code.resource !== form.get("resource")) return json({ error: "invalid_target" }, 400);
        return issue();
      }
      if (form.get("grant_type") === "refresh_token") {
        const old = form.get("refresh_token") ?? "";
        if (!refresh.delete(old)) return json({ error: "invalid_grant", error_description: "refresh token revoked" }, 400);
        return issue();
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/mcp") {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!access.has(token)) {
        return new Response("sign in", {
          status: 401,
          headers: { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` },
        });
      }
      const mcp = new McpServer({ name: "test", version: "1.0.0" });
      mcp.registerTool("whoami", { description: "Who you are", annotations: { readOnlyHint: true } },
        () => ({ content: [{ type: "text", text: "Anas" }] }));
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await mcp.connect(transport);
      return transport.handleRequest(req);
    }
    return new Response("not found", { status: 404 });
  });
  /** You signing in: the service checks the link and sends you back with a code. */
  const signIn = (link: string) => {
    const u = new URL(link);
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
    const code = `code-${++n}`;
    codes.set(code, {
      challenge: u.searchParams.get("code_challenge")!,
      client: u.searchParams.get("client_id")!,
      resource: u.searchParams.get("resource"),
    });
    return { code, state: u.searchParams.get("state") };
  };
  const revokeAll = () => { access.clear(); refresh.clear(); };
  return { server, registered, signIn, revokeAll, url: `http://localhost:${server.addr.port}/mcp` };
}

test("Butler finds the sign-in server, signs itself up, and signs in with PKCE", async () => {
  const s = service();
  useFetch(fetch);
  try {
    const prepared = await prepare(s.url, {}, REDIRECT, fetch);
    assert.equal(prepared.registered, true);
    assert.equal(prepared.client.client_id, "client-1");
    assert.equal(prepared.scope, "read write");
    assert.equal(prepared.resource, s.url);
    assert.deepEqual(s.registered[0].redirect_uris, [REDIRECT]);
    assert.equal(s.registered[0].token_endpoint_auth_method, "none");

    const { url, verifier } = await begin(prepared, REDIRECT, "state-1");
    const back = s.signIn(url);
    assert.equal(back.state, "state-1");
    assert.equal(new URL(url).searchParams.get("scope"), "read write");

    const signedIn = await finish(prepared, back.code, verifier, REDIRECT, fetch, 1_000);
    assert.equal(signedIn.tokens?.access_token, "access-2");
    assert.equal(signedIn.tokens?.expires_at, 1_000 + 3_600_000);

    const tools = await discover({ url: s.url, headers: {}, oauth: signedIn });
    assert.deepEqual(tools.map((t) => t.name), ["whoami"]);
  } finally {
    await s.server.shutdown();
  }
});

test("a wrong PKCE verifier is refused", async () => {
  const s = service();
  try {
    const prepared = await prepare(s.url, {}, REDIRECT, fetch);
    const { url } = await begin(prepared, REDIRECT, "x");
    const { code } = s.signIn(url);
    await assert.rejects(finish(prepared, code, "not-the-verifier", REDIRECT, fetch), /didn't accept the sign-in/);
  } finally {
    await s.server.shutdown();
  }
});

test("services that need your own app say so, and use the client ID you paste", async () => {
  const s = service({ dcr: false });
  try {
    await assert.rejects(prepare(s.url, {}, REDIRECT, fetch), /make an OAuth app first/);
    const prepared = await prepare(s.url, { clientId: "mine", clientSecret: "shh", scope: "read" }, REDIRECT, fetch);
    assert.equal(prepared.registered, false);
    assert.deepEqual(prepared.client, { client_id: "mine", client_secret: "shh", token_endpoint_auth_method: "client_secret_post" });
    assert.equal(prepared.scope, "read");
    assert.equal(s.registered.length, 0);
  } finally {
    await s.server.shutdown();
  }
});

test("a server without OAuth is explained plainly", async () => {
  const plainServer = Deno.serve({ port: 0, onListen() {} }, () => new Response("nope", { status: 404 }));
  try {
    await assert.rejects(prepare(`http://localhost:${plainServer.addr.port}/mcp`, {}, REDIRECT, fetch), /try an API key instead/);
  } finally {
    await plainServer.shutdown();
  }
});

test("tokens refresh, and a revoked sign-in asks you to reconnect", async () => {
  const s = service();
  try {
    const prepared = await prepare(s.url, {}, REDIRECT, fetch);
    const { url, verifier } = await begin(prepared, REDIRECT, "x");
    const signedIn = await finish(prepared, s.signIn(url).code, verifier, REDIRECT, fetch, 0);
    assert.equal(stale(signedIn, 0), false);
    assert.equal(stale(signedIn, 3_600_000 - 30_000), true); // inside the minute before it runs out

    const fresh = await renew(signedIn, fetch);
    assert.notEqual(fresh.tokens?.access_token, signedIn.tokens?.access_token);
    assert.notEqual(fresh.tokens?.refresh_token, signedIn.tokens?.refresh_token);
    // The old refresh token was used up, so reusing it means signing in again.
    await assert.rejects(renew(signedIn, fetch), SignInNeeded);

    s.revokeAll();
    await assert.rejects(renew(fresh, fetch), SignInNeeded);
    await assert.rejects(renew({ ...fresh, tokens: { access_token: "a" } }, fetch), SignInNeeded);
  } finally {
    await s.server.shutdown();
  }
});

test("a service that's down is not mistaken for a dead sign-in", async () => {
  const s = service({ broken: true });
  try {
    const prepared = await prepare(s.url, {}, REDIRECT, fetch);
    const oauth = { ...prepared, tokens: { access_token: "a", refresh_token: "r" } };
    await assert.rejects(renew(oauth, fetch), (e: Error) => !(e instanceof SignInNeeded) && /couldn't refresh/.test(e.message));
  } finally {
    await s.server.shutdown();
  }
});

test("error words never carry a token", () => {
  assert.equal(plain(new Error("bad token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123")), "bad token …");
});
