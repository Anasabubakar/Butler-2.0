// Signing in to an MCP server in the browser (OAuth), the way the MCP spec describes it:
// Butler finds the service's sign-in server from the MCP server's own description, signs
// itself up there if the service allows it (or uses the app you made there), and sends you
// to sign in with a one-time PKCE code. The tokens it gets back are kept locked in the
// vault with the connection and swapped for fresh ones before they run out.
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "npm:@modelcontextprotocol/sdk@1.32.1/client/auth.js";
import type { AuthorizationServerMetadata, OAuthTokens } from "npm:@modelcontextprotocol/sdk@1.32.1/shared/auth.js";

type Fetch = typeof fetch;

/** The app Butler signs in as: one it registered itself, or one you made on the service. */
export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // ms since 1970; missing when the service didn't say
}

/** Everything Butler needs to sign in again later. Only ever stored locked. */
export interface OAuth {
  authServer: string;
  metadata: AuthorizationServerMetadata;
  resource?: string; // the MCP server's own name for itself, sent so tokens only work there
  scope?: string;
  client: OAuthClient;
  registered: boolean; // Butler signed itself up (you didn't paste a client ID)
  tokens?: Tokens;
}

/** You have to sign in again: the service no longer accepts what Butler has. */
export class SignInNeeded extends Error {
  constructor(message = "the sign-in ran out; press Reconnect") {
    super(message);
  }
}

/** Refresh this long before a token runs out, so a slow call doesn't land on a dead one. */
const EARLY_MS = 60_000;

export interface Prepare {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/** What Butler says about itself when it signs up or publishes its client document. */
export function clientDocument(clientId: string, redirectUri: string, home: string) {
  return {
    client_id: clientId,
    client_name: "Butler",
    client_uri: home,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/** How Butler should prove who it is at the token endpoint, from what the service supports. */
function authMethod(metadata: AuthorizationServerMetadata, hasSecret: boolean): string | undefined {
  const supported = metadata.token_endpoint_auth_methods_supported;
  if (!supported?.length) return hasSecret ? "client_secret_basic" : "none";
  if (!hasSecret) return supported.includes("none") ? "none" : supported[0];
  return ["client_secret_basic", "client_secret_post"].find((m) => supported.includes(m)) ?? supported[0];
}

/**
 * Finds how to sign in to the MCP server at `serverUrl` and which app to sign in as: the app
 * you made there, else Butler's own client document at `documentUrl` (when the service reads
 * those), else one Butler signs up for itself.
 * Throws with a plain reason when the server has no sign-in, or needs you to make an app.
 */
export async function prepare(
  serverUrl: string, given: Prepare, redirectUri: string, fetchFn: Fetch, documentUrl?: string,
): Promise<OAuth> {
  const info = await discoverOAuthServerInfo(serverUrl, { fetchFn }).catch(() => null);
  const metadata = info?.authorizationServerMetadata;
  if (!info || !metadata) {
    throw new Error("that server doesn't say how to sign in with OAuth; try an API key instead");
  }
  if (!metadata.response_types_supported?.includes("code")) {
    throw new Error("that service's sign-in doesn't work with Butler (no code flow)");
  }
  const resource = info.resourceMetadata?.resource;
  const scope = given.scope || info.resourceMetadata?.scopes_supported?.join(" ") || undefined;
  let client: OAuthClient;
  let registered = false;
  if (given.clientId) {
    client = {
      client_id: given.clientId,
      ...(given.clientSecret ? { client_secret: given.clientSecret } : {}),
      token_endpoint_auth_method: authMethod(metadata, Boolean(given.clientSecret)),
    };
  } else if (documentUrl && metadata.client_id_metadata_document_supported) {
    // The newer way (CIMD): Butler's client ID is the link to a page describing it.
    client = { client_id: documentUrl, token_endpoint_auth_method: "none" };
  } else if (metadata.registration_endpoint) {
    const method = authMethod(metadata, false);
    const full = await registerClient(info.authorizationServerUrl, {
      metadata,
      fetchFn,
      scope,
      clientMetadata: {
        client_name: "Butler",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...(method ? { token_endpoint_auth_method: method } : {}),
      },
    }).catch((e: unknown) => {
      throw new Error(`the service wouldn't let Butler sign up: ${plain(e)}`);
    });
    client = {
      client_id: full.client_id,
      ...(full.client_secret ? { client_secret: full.client_secret } : {}),
      ...(full.token_endpoint_auth_method ? { token_endpoint_auth_method: full.token_endpoint_auth_method } : {}),
    };
    registered = true;
  } else {
    throw new Error(
      `${new URL(info.authorizationServerUrl).host} needs you to make an OAuth app first; paste its client ID (and secret) under More options`,
    );
  }
  return { authServer: info.authorizationServerUrl, metadata, resource, scope, client, registered };
}

/** The link to send you to, and the PKCE verifier to keep until you come back. */
export async function begin(oauth: OAuth, redirectUri: string, state: string): Promise<{ url: string; verifier: string }> {
  const { authorizationUrl, codeVerifier } = await startAuthorization(oauth.authServer, {
    metadata: oauth.metadata,
    clientInformation: oauth.client,
    redirectUrl: redirectUri,
    scope: oauth.scope,
    state,
    resource: oauth.resource ? new URL(oauth.resource) : undefined,
  });
  return { url: authorizationUrl.href, verifier: codeVerifier };
}

const toTokens = (t: OAuthTokens, now: number, old?: Tokens): Tokens => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token ?? old?.refresh_token,
  ...(t.expires_in ? { expires_at: now + t.expires_in * 1000 } : {}),
});

/** Swaps the code the service sent you back with for tokens. */
export async function finish(oauth: OAuth, code: string, verifier: string, redirectUri: string, fetchFn: Fetch, now = Date.now()): Promise<OAuth> {
  const tokens = await exchangeAuthorization(oauth.authServer, {
    metadata: oauth.metadata,
    clientInformation: oauth.client,
    authorizationCode: code,
    codeVerifier: verifier,
    redirectUri,
    resource: oauth.resource ? new URL(oauth.resource) : undefined,
    fetchFn,
  }).catch((e: unknown) => {
    throw new Error(`the service didn't accept the sign-in: ${plain(e)}`);
  });
  return { ...oauth, tokens: toTokens(tokens, now) };
}

/** Whether the token has run out, or is about to. */
export const stale = (oauth: OAuth, now = Date.now()) =>
  !oauth.tokens || (oauth.tokens.expires_at !== undefined && oauth.tokens.expires_at - EARLY_MS <= now);

/** OAuth error codes that mean only signing in again will help (not a network blip). */
const DEAD = /\b(invalid_grant|invalid_client|unauthorized_client|invalid_token|access_denied)\b/;

/**
 * Fresh tokens from the refresh token. Throws SignInNeeded when there's no refresh token or
 * the service refused it; other failures (the service is down) throw a normal error.
 */
export async function renew(oauth: OAuth, fetchFn: Fetch, now = Date.now()): Promise<OAuth> {
  const refreshToken = oauth.tokens?.refresh_token;
  if (!refreshToken) throw new SignInNeeded();
  try {
    const tokens = await refreshAuthorization(oauth.authServer, {
      metadata: oauth.metadata,
      clientInformation: oauth.client,
      refreshToken,
      resource: oauth.resource ? new URL(oauth.resource) : undefined,
      fetchFn,
    });
    return { ...oauth, tokens: toTokens(tokens, now, oauth.tokens) };
  } catch (e) {
    const code = (e as { errorCode?: unknown }).errorCode;
    if ((typeof code === "string" && DEAD.test(code)) || DEAD.test(String(e))) throw new SignInNeeded();
    throw new Error(`couldn't refresh the sign-in: ${plain(e)}`);
  }
}

/** An error's words, short, with anything that looks like a token cut out. */
export function plain(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/\b[A-Za-z0-9_\-.~+/]{32,}=*/g, "…").slice(0, 200);
}
