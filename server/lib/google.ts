// Your Google account, signed in once from the library website: Butler adds
// calendar events, finds people in your contacts and sends email as you.
import { encodeBase64, encodeBase64Url } from "jsr:@std/encoding@1.0.10";
import { sql } from "./db.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token";
const API = () => Deno.env.get("GOOGLE_API_URL") ?? "https://www.googleapis.com";
const PEOPLE = () => Deno.env.get("GOOGLE_PEOPLE_URL") ?? "https://people.googleapis.com";
const GMAIL = () => Deno.env.get("GOOGLE_GMAIL_URL") ?? "https://gmail.googleapis.com";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/drive.file", // only files Butler itself makes: the backups
];

const clientId = () => Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const clientSecret = () => Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
export const googleConfigured = () => Boolean(clientId() && clientSecret());

/** Where Google sends you back after you allow Butler: PUBLIC_URL/api/google/callback. */
export const redirectUri = () => `${(Deno.env.get("PUBLIC_URL") ?? "").replace(/\/$/, "")}/api/google/callback`;

export function consentUrl(state: string): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // gives a refresh token, so you sign in once
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })}`;
}

// --- tokens ------------------------------------------------------------------------------

let cached: { token: string; expires: number } | null = null;

export interface Account {
  email: string | null;
  connected_at: string;
}

export async function account(): Promise<Account | null> {
  const [row] = await sql<Account[]>`select email, connected_at from google_account where id = 1`;
  return row ?? null;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return data as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string };
}

/** Finishes signing in: swaps Google's code for tokens and keeps the refresh token. */
export async function connect(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error("Google gave no refresh token; remove Butler at myaccount.google.com/permissions and connect again");
  const email = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;
  await sql`insert into google_account (id, email, refresh_token) values (1, ${email}, ${tokens.refresh_token})
    on conflict (id) do update set email = excluded.email, refresh_token = excluded.refresh_token, connected_at = now()`;
  cached = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 };
}

function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).email ?? null;
  } catch {
    return null;
  }
}

export async function disconnect() {
  const [row] = await sql<{ refresh_token: string }[]>`delete from google_account where id = 1 returning refresh_token`;
  cached = null;
  if (row) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refresh_token)}`, { method: "POST" })
      .catch(() => {});
  }
}

/** A fresh access token, or an error saying to connect Google first. */
async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  const [row] = await sql<{ refresh_token: string }[]>`select refresh_token from google_account where id = 1`;
  if (!row) throw new Error("connect your Google account on the Butler website first");
  const tokens = await tokenRequest({ refresh_token: row.refresh_token, grant_type: "refresh_token" });
  cached = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 };
  return cached.token;
}

/** A request to a Google API as you. */
export async function authorized(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await authorized(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google answered ${res.status}: ${data.error?.message ?? ""}`.trim());
  return data as T;
}

// --- calendar ------------------------------------------------------------------------------

/** Adds an event to your main calendar and returns its link. */
export async function addEvent(title: string, start: Date, end: Date, timeZone: string): Promise<string> {
  const event = await google<{ htmlLink: string }>(`${API()}/calendar/v3/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: title,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
    }),
  });
  return event.htmlLink;
}

export interface Event {
  title: string;
  start: Date;
  allDay: boolean;
}

/** Your calendar's events that start between `from` and `to`, in order. */
export async function events(from: Date, to: Date): Promise<Event[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20",
  });
  const data = await google<{ items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] }>(
    `${API()}/calendar/v3/calendars/primary/events?${params}`,
  );
  return (data.items ?? []).flatMap((e) => {
    const when = e.start?.dateTime ?? e.start?.date;
    return when ? [{ title: e.summary || "(no title)", start: new Date(when), allDay: !e.start?.dateTime }] : [];
  });
}

// --- people ---------------------------------------------------------------------------------

export interface Person {
  name: string;
  email: string | null;
  phone: string | null;
}

interface PeopleResults {
  results?: {
    person: {
      names?: { displayName?: string }[];
      emailAddresses?: { value?: string }[];
      phoneNumbers?: { value?: string; canonicalForm?: string }[];
    };
  }[];
}

/** People matching `name` in your contacts, then in people you've emailed, with an email or phone each. */
export async function findPeople(name: string): Promise<Person[]> {
  const found: Person[] = [];
  const read = (data: PeopleResults) => {
    for (const { person } of data.results ?? []) {
      const email = person.emailAddresses?.find((e) => e.value)?.value ?? null;
      const phoneEntry = person.phoneNumbers?.find((p) => p.canonicalForm || p.value);
      const phone = phoneEntry?.canonicalForm ?? phoneEntry?.value ?? null;
      if (!email && !phone) continue;
      if (found.some((f) => (email && f.email === email) || (phone && f.phone === phone))) continue;
      found.push({ name: person.names?.[0]?.displayName || email || phone!, email, phone });
    }
  };
  const query = encodeURIComponent(name);
  // Google asks for one empty search first so its search cache is warm.
  await google(`${PEOPLE()}/v1/people:searchContacts?query=&readMask=names,emailAddresses,phoneNumbers`).catch(() => {});
  read(await google<PeopleResults>(`${PEOPLE()}/v1/people:searchContacts?query=${query}&readMask=names,emailAddresses,phoneNumbers&pageSize=5`));
  read(await google<PeopleResults>(`${PEOPLE()}/v1/otherContacts:search?query=${query}&readMask=names,emailAddresses,phoneNumbers&pageSize=5`)
    .catch(() => ({})));
  return found.slice(0, 5);
}

// --- email ------------------------------------------------------------------------------------

export interface Email {
  to: { name: string; email: string };
  subject: string;
  body: string;
  attachment?: { name: string; mime: string; data: Uint8Array };
}

const header = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${encodeBase64(new TextEncoder().encode(s))}?=`;
const wrap = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");

/** The email as a MIME message, the way Gmail's API takes it. */
export function mime(email: Email): string {
  const to = /^[\w .'-]*$/.test(email.to.name) && email.to.name !== email.to.email
    ? `"${email.to.name}" <${email.to.email}>`
    : email.to.email;
  const head = [`To: ${to}`, `Subject: ${header(email.subject)}`, "MIME-Version: 1.0"];
  const text = wrap(encodeBase64(new TextEncoder().encode(email.body)));
  if (!email.attachment) {
    return [...head, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", text].join("\r\n");
  }
  const boundary = `butler-${crypto.randomUUID()}`;
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    text,
    `--${boundary}`,
    `Content-Type: ${email.attachment.mime}; name="${email.attachment.name}"`,
    `Content-Disposition: attachment; filename="${email.attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap(encodeBase64(email.attachment.data)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function sendEmail(email: Email) {
  await google(`${GMAIL()}/gmail/v1/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: encodeBase64Url(new TextEncoder().encode(mime(email))) }),
  });
}
