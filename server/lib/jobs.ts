// Laptop commands and what became of them (db/migrations/022_laptop_jobs.sql). The command
// itself goes through the inbox and is forgotten once delivered; a job keeps only how it went,
// so the phone and website can always say why one didn't run.
import { sql } from "./db.ts";
import * as inbox from "./inbox.ts";
import { missedReason, PICKUP_MINUTES, silentReason, type State, statusTitle } from "./laptop.ts";

export type JobState = State | "queued" | "missed";

export interface Job {
  id: string;
  created_at: Date;
  from_device: string;
  to_devices: string[];
  picked_up_at: Date | null;
  picked_up_by: string | null;
  state: JobState;
  text: string;
  updated_at: Date;
}

const FINAL = ["done", "failed", "refused", "stopped", "locked", "missed"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends a command to the laptops `to` as one job, and returns the job's id. */
export async function send(from: string, to: string[], command: string): Promise<string> {
  const [{ id }] = await sql<{ id: string }[]>`
    insert into laptop_jobs (from_device, to_devices) values (${from}, ${to}::text[]) returning id`;
  await inbox.send(to, { from_device: from, kind: "task", body: command, job: id });
  return id;
}

/** Marks the jobs among `messages` as taken by `device`. */
export async function pickedUp(messages: inbox.Message[], device: string) {
  const ids = messages.filter((m) => m.kind === "task" && m.job).map((m) => m.job!);
  if (!ids.length) return;
  await sql`update laptop_jobs
    set picked_up_at = coalesce(picked_up_at, now()), picked_up_by = coalesce(picked_up_by, ${device}), updated_at = now()
    where id = any(${ids}::uuid[])`;
}

/** When each device last checked in. */
async function lastSeen(names: string[]): Promise<Date | null> {
  const times = (await inbox.devices()).filter((d) => names.includes(d.name)).map((d) => new Date(d.last_seen).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * Drops commands no laptop took within PICKUP_MINUTES (they mustn't start out of the blue when
 * the laptop wakes), marks their jobs missed, and tells the phone that sent each one why.
 */
export async function expire() {
  const gone = await sql<{ job: string | null }[]>`
    delete from messages where kind = 'task' and delivered_at is null
      and due_at < now() - make_interval(mins => ${PICKUP_MINUTES})
    returning job`;
  const ids = [...new Set(gone.map((g) => g.job).filter((j): j is string => Boolean(j)))];
  if (ids.length) {
    // Missed only when no laptop took it: it may have gone to an old laptop and a current one.
    const missed = await sql<Job[]>`select * from laptop_jobs j
      where id = any(${ids}::uuid[]) and picked_up_at is null
        and not exists (select 1 from messages m where m.job = j.id and m.delivered_at is null)`;
    for (const job of missed) {
      const text = missedReason(await lastSeen(job.to_devices));
      await sql`update laptop_jobs set state = 'missed', text = ${text}, updated_at = now() where id = ${job.id}`;
      // The phone that sent it hears why, the way it hears how any laptop job went. The website asks.
      const to = await inbox.resolveTarget(job.from_device, "");
      const body = JSON.stringify({ state: "failed", title: statusTitle("failed"), text, job: job.id });
      await inbox.send(to, { from_device: job.to_devices[0] ?? "laptop", kind: "status", body });
    }
  }
  await sql`delete from laptop_jobs where created_at < now() - interval '30 days'`;
}

/**
 * Records how a job is going, as the laptop reports it. Without a job id (a laptop running an
 * older Butler), it's the newest unfinished job that laptop took.
 */
export async function report(device: string, id: string | null, state: State, text: string) {
  if (id && UUID_RE.test(id)) {
    await sql`update laptop_jobs set state = ${state}, text = ${text}, updated_at = now() where id = ${id}`;
    return;
  }
  await sql`update laptop_jobs set state = ${state}, text = ${text}, updated_at = now()
    where id = (select id from laptop_jobs where picked_up_by = ${device} and not (state = any(${FINAL}::text[]))
      order by created_at desc limit 1)`;
}

/** A job as the phone and website show it, with the laptop's last check-in. Null if there's no such job. */
export async function get(id: string) {
  if (!UUID_RE.test(id)) return null;
  await expire();
  const [job] = await sql<Job[]>`select * from laptop_jobs where id = ${id}`;
  if (!job) return null;
  const last_seen = await lastSeen(job.picked_up_by ? [job.picked_up_by] : job.to_devices);
  const silent = silentReason(job.state, new Date(job.updated_at));
  return { ...job, state: silent ? "failed" as const : job.state, text: silent ?? job.text, last_seen };
}
