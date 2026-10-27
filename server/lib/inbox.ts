// Each device's inbox: reminders, notes, copied text, links and files sent to it.
// Devices check in every few seconds and take whatever is due.
import { sql } from "./db.ts";

export const DEVICE_KINDS = ["laptop", "phone"] as const;
export type DeviceKind = typeof DEVICE_KINDS[number];

export const MESSAGE_KINDS = ["reminder", "note", "clip", "link", "file", "sync", "ring", "task", "stop", "status", "transfer"] as const;

// Kept only until the device has them: copies, laptop commands (which carry your secret word),
// and word of files on their way (the device keeps track of those itself).
const FORGET_ONCE_DELIVERED = ["sync", "task", "stop", "status", "transfer"];
export type MessageKind = typeof MESSAGE_KINDS[number];

export interface Device {
  name: string;
  kind: DeviceKind;
  last_seen: string;
}

export interface Message {
  id: string;
  created_at: string;
  from_device: string;
  kind: MessageKind;
  body: string | null;
  url: string | null;
  item_id: string | null;
  due_at: string;
  job: string | null; // for a 'task': its laptop job (see jobs.ts)
}

export interface NewMessage {
  from_device: string;
  kind: MessageKind;
  body?: string | null;
  url?: string | null;
  item_id?: string | null;
  due_at?: string;
  job?: string | null;
}

/** Records that a device is alive, so other devices can send to it. */
export async function checkIn(name: string, kind: DeviceKind) {
  await sql`insert into devices (name, kind) values (${name}, ${kind})
    on conflict (name) do update set kind = excluded.kind, last_seen = now()`;
}

/**
 * How to reach a device directly on the same network: the port its link listens on, its
 * certificate's fingerprint and its addresses. Null forgets it (the link is switched off).
 */
export interface Local {
  port: number;
  fingerprint: string;
  addresses: string[];
}

/** Checks a device's own description of its direct link; anything odd is dropped. */
export function cleanLocal(raw: unknown): Local | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const port = Number(r.port);
  const fingerprint = String(r.fingerprint ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || fingerprint.length !== 64) return null;
  const addresses = (Array.isArray(r.addresses) ? r.addresses : [])
    .map((a) => String(a).trim())
    .filter((a) => /^(\d{1,3}\.){3}\d{1,3}$/.test(a) && !a.startsWith("127."))
    .slice(0, 8);
  return { port, fingerprint, addresses };
}

export async function setLocal(name: string, local: Local | null) {
  await sql`update devices set local = ${local ? sql.json(local as never) : null} where name = ${name}`;
}

/** Your other devices and how to reach them directly, for a device's token. */
export function peers(except: string) {
  return sql<(Device & { local: Local | null })[]>`
    select name, kind, last_seen, local from devices where name <> ${except} order by last_seen desc`;
}

export function devices() {
  return sql<Device[]>`select name, kind, last_seen from devices order by last_seen desc`;
}

/** Hands over everything due for a device, once. Copied text that synced is then forgotten. */
export async function takeDue(name: string) {
  // A ring that waited more than 5 minutes (the phone was off) would only startle you later.
  await sql`delete from messages where kind = 'ring' and delivered_at is null and due_at < now() - interval '5 minutes'`;
  // Nor should a Stop from 10 minutes ago (old laptop commands are dropped by jobs.expire).
  // Switching remote control off ("stop" with body "off") still counts whenever it arrives.
  await sql`delete from messages where kind = 'stop' and body is distinct from 'off'
    and delivered_at is null and due_at < now() - interval '10 minutes'`;
  const due = await sql<Message[]>`
    update messages set delivered_at = now()
    where id in (
      select id from messages
      where to_device = ${name} and delivered_at is null and due_at <= now()
      order by due_at
      limit 20
      for update skip locked)
    returning id, created_at, from_device, kind, body, url, item_id, due_at, job`;
  if (due.some((m) => FORGET_ONCE_DELIVERED.includes(m.kind))) {
    await sql`delete from messages where kind = any(${FORGET_ONCE_DELIVERED}::text[]) and delivered_at is not null`;
  }
  return due;
}

/** Sends one message to each named device. */
export async function send(to: string[], message: NewMessage) {
  if (!to.length) return;
  const rows = to.map((to_device) => ({
    from_device: message.from_device,
    to_device,
    kind: message.kind,
    body: message.body ?? null,
    url: message.url ?? null,
    item_id: message.item_id ?? null,
    due_at: message.due_at ?? new Date().toISOString(),
    job: message.job ?? null,
  }));
  // Only your latest copy matters: drop older ones still waiting.
  if (message.kind === "sync") await sql`delete from messages where kind = 'sync' and delivered_at is null and to_device = any(${to}::text[])`;
  if (message.kind === "ring") await sql`delete from messages where kind = 'ring' and delivered_at is null and to_device = any(${to}::text[])`;
  await sql`insert into messages ${sql(rows)}`;
  for (const name of to) wake(name);
}

// Devices waiting for their next message (see waitForMessage).
const waiting = new Map<string, Set<() => void>>();

function wake(name: string) {
  for (const resolve of waiting.get(name) ?? []) resolve();
  waiting.delete(name);
}

/**
 * Waits up to `ms` for a message to be sent to `name`, so a device can hold one request open
 * instead of asking every few seconds: a command from the phone reaches the laptop at once.
 */
export function waitForMessage(name: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.get(name)?.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
    if (!waiting.has(name)) waiting.set(name, new Set());
    waiting.get(name)!.add(done);
  });
}

/** Deletes messages from `from` that haven't been delivered yet, and says how many. */
export async function cancelFrom(from: string): Promise<number> {
  const gone = await sql`delete from messages where from_device = ${from} and delivered_at is null returning id`;
  return gone.length;
}

/** The devices a message for `target` should go to: a device name, a kind, or "all". */
export async function resolveTarget(target: string, from: string): Promise<string[]> {
  const all = await devices();
  const t = target.trim().toLowerCase();
  if (t === "all" || t === "everywhere") return all.map((d) => d.name);
  const byName = all.filter((d) => d.name.toLowerCase() === t);
  if (byName.length) return byName.map((d) => d.name);
  const kind = /phone|android|mobile/.test(t) ? "phone" : /laptop|computer|pc|desktop/.test(t) ? "laptop" : null;
  return all.filter((d) => d.kind === kind && d.name !== from).map((d) => d.name);
}

/** What the website's Inbox shows: things to read, not copies or commands. */
const SHOWN = ["reminder", "note", "link", "file"];

export interface Sent {
  id: string;
  from_device: string;
  kind: MessageKind;
  body: string | null;
  url: string | null;
  item_id: string | null;
  due_at: string;
  to_devices: string[];
  delivered: boolean;
}

/** What was sent lately, newest first, once each even when it went to every device. */
export function recent(limit = 50) {
  return sql<Sent[]>`
    select min(id::text) as id, from_device, kind, body, url, item_id, due_at,
      array_agg(to_device order by to_device) as to_devices,
      bool_and(delivered_at is not null) as delivered
    from messages
    where kind = any(${SHOWN}::text[])
    group by from_device, kind, body, url, item_id, due_at
    order by due_at desc
    limit ${limit}`;
}
