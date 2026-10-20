// Each device's inbox: reminders, notes, copied text, links and files sent to it.
// Devices check in every few seconds and take whatever is due.
import { sql } from "./db.ts";

export const DEVICE_KINDS = ["laptop", "phone"] as const;
export type DeviceKind = typeof DEVICE_KINDS[number];

export const MESSAGE_KINDS = ["reminder", "note", "clip", "link", "file", "sync", "ring"] as const;
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
}

export interface NewMessage {
  from_device: string;
  kind: MessageKind;
  body?: string | null;
  url?: string | null;
  item_id?: string | null;
  due_at?: string;
}

/** Records that a device is alive, so other devices can send to it. */
export async function checkIn(name: string, kind: DeviceKind) {
  await sql`insert into devices (name, kind) values (${name}, ${kind})
    on conflict (name) do update set kind = excluded.kind, last_seen = now()`;
}

export function devices() {
  return sql<Device[]>`select name, kind, last_seen from devices order by last_seen desc`;
}

/** Hands over everything due for a device, once. Copied text that synced is then forgotten. */
export async function takeDue(name: string) {
  // A ring that waited more than 5 minutes (the phone was off) would only startle you later.
  await sql`delete from messages where kind = 'ring' and delivered_at is null and due_at < now() - interval '5 minutes'`;
  const due = await sql<Message[]>`
    update messages set delivered_at = now()
    where id in (
      select id from messages
      where to_device = ${name} and delivered_at is null and due_at <= now()
      order by due_at
      limit 20
      for update skip locked)
    returning id, created_at, from_device, kind, body, url, item_id, due_at`;
  if (due.some((m) => m.kind === "sync")) await sql`delete from messages where kind = 'sync' and delivered_at is not null`;
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
  }));
  // Only your latest copy matters: drop older ones still waiting.
  if (message.kind === "sync") await sql`delete from messages where kind = 'sync' and delivered_at is null and to_device = any(${to}::text[])`;
  if (message.kind === "ring") await sql`delete from messages where kind = 'ring' and delivered_at is null and to_device = any(${to}::text[])`;
  await sql`insert into messages ${sql(rows)}`;
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
