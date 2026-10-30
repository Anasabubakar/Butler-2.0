// Your Google account, signed in once from the library website: Butler adds
// calendar events, finds people in your contacts, sends email as you and notices new
// email that should start one of your recipes.
import { encodeBase64, encodeBase64Url } from "jsr:@std/encoding@1.0.10";
import { sql } from "./db.ts";
import * as settings from "./settings.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token";
const API = () => Deno.env.get("GOOGLE_API_URL") ?? "https://www.googleapis.com";
const PEOPLE = () => Deno.env.get("GOOGLE_PEOPLE_URL") ?? "https://people.googleapis.com";
const GMAIL = () => Deno.env.get("GOOGLE_GMAIL_URL") ?? "https://gmail.googleapis.com";
const TASKS = () => Deno.env.get("GOOGLE_TASKS_URL") ?? "https://tasks.googleapis.com";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly", // every calendar you see, not only the main one
  "https://www.googleapis.com/auth/tasks.readonly", // your Google Tasks, for the brief
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly", // for recipes that start when an email arrives
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

/**
 * Something Google refused, said so you know what to do about it. `fix` is set when only you can
 * sort it out (sign in again, allow more, switch an API on), and the website shows it until you do.
 */
export class GoogleError extends Error {
  constructor(message: string, readonly fix: "signin" | "permission" | "api" | null = null) {
    super(message);
  }
}

const SIGN_IN_AGAIN = "your Google sign-in has expired or was removed. press Connect Google on the Butler website to sign in again.";
const ALLOW_MORE = "Butler doesn't have permission for that yet. press Connect Google on the Butler website and tick every box Google shows.";

/** Google's error, in words you can act on. */
export function explainFailure(status: number, data: { error?: unknown; error_description?: string }): GoogleError {
  const err = data.error as { message?: string; status?: string; details?: { reason?: string }[] } | string | undefined;
  const text = typeof err === "string" ? `${err} ${data.error_description ?? ""}` : `${err?.message ?? ""} ${err?.status ?? ""} ${
    (err?.details ?? []).map((d) => d.reason ?? "").join(" ")}`;
  if (status === 401 || /invalid_grant|UNAUTHENTICATED|invalid_token/i.test(text)) return new GoogleError(SIGN_IN_AGAIN, "signin");
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
    const api = text.match(/(Google Calendar|Gmail|Google Tasks|Tasks|People|Google Drive|Drive)\s*API/i)?.[0] ?? "that Google API";
    return new GoogleError(`${api} is switched off in your Google Cloud project. turn it on at console.cloud.google.com/apis/library, then press Connect Google on the Butler website.`, "api");
  }
  if (status === 403 && /insufficient|SCOPE|PERMISSION_DENIED/i.test(text)) return new GoogleError(ALLOW_MORE, "permission");
  return new GoogleError(`Google answered ${status}${typeof err === "object" && err?.message ? `: ${err.message}` : ""}`);
}

/** What Google last needed from you, or null when it's working. */
export const problem = async () => (await settings.get("google_problem")) || null;

/** Notes a problem only you can fix, so the website can show it. */
async function noteProblem(e: unknown) {
  if (e instanceof GoogleError && e.fix) await settings.set("google_problem", e.message).catch(() => {});
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error === "invalid_grant" ? new GoogleError(SIGN_IN_AGAIN, "signin") : explainFailure(res.status, data);
    await noteProblem(e);
    throw e;
  }
  return data as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string };
}

/** Finishes signing in: swaps Google's code for tokens and keeps the refresh token. */
export async function connect(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error("Google gave no refresh token; remove Butler at myaccount.google.com/permissions and connect again");
  const email = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;
  await sql`insert into google_account (id, email, refresh_token) values (1, ${email}, ${tokens.refresh_token})
    on conflict (id) do update set email = excluded.email, refresh_token = excluded.refresh_token, connected_at = now()`;
  await settings.set("google_problem", "");
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
  if (!res.ok) {
    if (res.status === 401) cached = null; // the next try fetches a fresh token
    const e = explainFailure(res.status, data);
    await noteProblem(e);
    throw e;
  }
  if (await problem() === SIGN_IN_AGAIN) await settings.set("google_problem", ""); // signed in fine after all
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
  /** For all-day events, the day after the last one, like Google gives it (2026-10-22 for a one-day event on the 21st). */
  until?: string;
}

type When = { dateTime?: string; date?: string };
type Listed = { items?: { summary?: string; status?: string; start?: When; end?: When }[] };

/** The calendars you have ticked in Google Calendar, main one first. Just the main one if Butler can't list them. */
async function calendarIds(): Promise<string[]> {
  try {
    const data = await google<{ items?: { id: string; primary?: boolean; selected?: boolean; hidden?: boolean }[] }>(
      `${API()}/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50`,
    );
    const ids = (data.items ?? []).filter((c) => c.primary || (c.selected && !c.hidden))
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary))).map((c) => c.id);
    return ids.length ? ids.slice(0, 15) : ["primary"];
  } catch (e) {
    if (e instanceof GoogleError && e.fix === "permission") return ["primary"]; // connected before Butler asked for this
    throw e;
  }
}

/** Events on all your calendars that are on between `from` and `to`, in order. */
export async function events(from: Date, to: Date): Promise<Event[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50",
  });
  const ids = await calendarIds();
  const lists = await Promise.allSettled(ids.map((id) =>
    google<Listed>(`${API()}/calendar/v3/calendars/${encodeURIComponent(id)}/events?${params}`)
  ));
  // The main calendar has to work; a broken extra one (a removed share) shouldn't hide the rest.
  if (lists[0].status === "rejected") throw lists[0].reason;
  const seen = new Set<string>();
  const found: Event[] = [];
  for (const list of lists) {
    if (list.status !== "fulfilled") continue;
    for (const e of list.value.items ?? []) {
      const when = e.start?.dateTime ?? e.start?.date;
      if (!when || e.status === "cancelled") continue;
      const event: Event = { title: e.summary || "(no title)", start: dayOrTime(when), allDay: !e.start?.dateTime };
      if (event.allDay && e.end?.date) event.until = e.end.date;
      const key = `${event.title}|${event.start.getTime()}`;
      if (seen.has(key)) continue; // the same event on two calendars
      seen.add(key);
      found.push(event);
    }
  }
  return found.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime()).slice(0, 30);
}

/** An all-day "2026-10-21" is that day, not midnight UTC (the evening before in the Americas). */
const dayOrTime = (when: string) => /^\d{4}-\d{2}-\d{2}$/.test(when) ? new Date(`${when}T12:00:00Z`) : new Date(when);

// --- tasks ------------------------------------------------------------------------------------

export interface Task {
  title: string;
  due: string | null; // the day it's due, like 2026-10-21 (Google Tasks keeps no time)
  list: string;
}

/** Your open Google Tasks, from every list. */
export async function tasks(): Promise<Task[]> {
  const lists = await google<{ items?: { id: string; title?: string }[] }>(`${TASKS()}/tasks/v1/users/@me/lists?maxResults=20`);
  const found: Task[] = [];
  for (const list of lists.items ?? []) {
    const data = await google<{ items?: { title?: string; due?: string; status?: string; parent?: string }[] }>(
      `${TASKS()}/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${new URLSearchParams({
        showCompleted: "false", showHidden: "false", maxResults: "100",
      })}`,
    );
    for (const t of data.items ?? []) {
      if (t.status === "completed" || !t.title?.trim()) continue;
      found.push({ title: t.title.trim(), due: t.due?.slice(0, 10) ?? null, list: list.title ?? "Tasks" });
    }
  }
  return found;
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

// --- new email ------------------------------------------------------------------------------

export interface Arrived {
  id: string;
  at: Date;
  from: string;
  subject: string;
  text: string; // the plain text, or Gmail's snippet when there is none
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

/** The first text/plain part of a message, decoded. */
export function plainText(part: Part | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    const b64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    } catch {
      return "";
    }
  }
  for (const p of part.parts ?? []) {
    const found = plainText(p);
    if (found) return found;
  }
  return "";
}

/**
 * Emails matching a Gmail search (like "from:mybank.com") that arrived after `after`,
 * oldest first, at most `max`. Says plainly when Google needs connecting again.
 */
export async function emailsSince(query: string, after: Date, max = 5): Promise<Arrived[]> {
  const q = `${query} after:${Math.floor(after.getTime() / 1000)}`;
  const list = await google<{ messages?: { id: string }[] }>(
    `${GMAIL()}/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: "20" })}`,
  );
  const found: Arrived[] = [];
  for (const { id } of list.messages ?? []) {
    const m = await google<{ id: string; internalDate: string; snippet?: string; payload?: Part }>(
      `${GMAIL()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    );
    const at = new Date(Number(m.internalDate));
    if (!(at > after)) continue; // Gmail's after: is to the second; this is exact
    const head = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
    const text = plainText(m.payload).trim() || (m.snippet ?? "");
    found.push({ id: m.id, at, from: head("from"), subject: head("subject"), text: text.slice(0, 3000) });
  }
  return found.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, max);
}

export interface Mail {
  from: string; // the sender's name, or their address
  subject: string;
  at: Date;
  unread: boolean;
  snippet: string;
}

/** Just the name from a From line like `"Ada" <ada@x.com>`. */
export const sender = (from: string) => from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from.replace(/[<>]/g, "");

/** The newest emails matching a Gmail search, newest first, at most `max`. */
export async function mail(query: string, max = 8): Promise<Mail[]> {
  const list = await google<{ messages?: { id: string }[] }>(
    `${GMAIL()}/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`,
  );
  const found = await Promise.all((list.messages ?? []).slice(0, max).map(async ({ id }) => {
    const m = await google<{ internalDate: string; snippet?: string; labelIds?: string[]; payload?: Part }>(
      `${GMAIL()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    );
    const head = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
    return {
      from: sender(head("from")), subject: head("subject") || "(no subject)", at: new Date(Number(m.internalDate)),
      unread: m.labelIds?.includes("UNREAD") ?? false, snippet: (m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    };
  }));
  return found.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Gmail's search for email worth your attention: unread, in the inbox, not promotions or social. */
export const IMPORTANT = "in:inbox is:unread -category:promotions -category:social -category:forums newer_than:2d";
