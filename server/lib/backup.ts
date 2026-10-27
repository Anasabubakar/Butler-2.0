// Off-site backups: copies the nightly database dump and every saved file to a
// "Butler backups" folder in your Google Drive, so losing the server loses nothing.
import { join, relative } from "jsr:@std/path@1.1.6";
import { sql } from "./db.ts";
import { account, authorized, googleConfigured } from "./google.ts";

const DRIVE = () => Deno.env.get("GOOGLE_DRIVE_URL") ?? "https://www.googleapis.com";
const FOLDER = "application/vnd.google-apps.folder";
export const KEEP_DUMPS = 14;

export interface BackupStatus {
  at: string;
  ok: boolean;
  note: string;
}

let last: BackupStatus | null = null;
export const lastBackup = () => last;

async function drive<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorized(`${DRIVE()}${path}`, init, 120_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res.status, data.error?.message ?? ""));
  return data as T;
}

/** Google's errors, in words that say what to do. */
function explain(status: number, message: string): string {
  if (/has not been used|is disabled/i.test(message)) return "turn on the Google Drive API in your Google Cloud project";
  if (status === 403 && /insufficient|scope/i.test(message)) return "reconnect Google on the website to allow backups";
  return `Google Drive answered ${status}: ${message}`.trim();
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The id of a folder Butler made, making it if needed. */
async function folder(name: string, parent?: string): Promise<string> {
  const q = [`name = ${quote(name)}`, `mimeType = '${FOLDER}'`, "trashed = false", parent ? `${quote(parent)} in parents` : null]
    .filter(Boolean).join(" and ");
  const found = await drive<{ files: { id: string }[] }>(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (found.files[0]) return found.files[0].id;
  const made = await drive<{ id: string }>("/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent && { parents: [parent] }) }),
  });
  return made.id;
}

/** Uploads a file in one resumable session, which handles any size. */
async function upload(name: string, parent: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
  const start = await authorized(`${DRIVE()}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-content-type": mime },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  if (!start.ok) throw new Error(explain(start.status, (await start.json().catch(() => ({}))).error?.message ?? ""));
  const session = start.headers.get("location");
  if (!session) throw new Error("Google Drive gave no upload address");
  const res = await fetch(session, { method: "PUT", headers: { "content-type": mime }, body: bytes, signal: AbortSignal.timeout(600_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res.status, data.error?.message ?? ""));
  return data.id;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith(".")) continue; // .transfers: files passing between devices, not saves
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* walk(path);
    else if (entry.isFile) yield path;
  }
}

/** Uploads the newest dump (once) and keeps the last KEEP_DUMPS in Drive. */
async function backUpDumps(dumpsDir: string, root: string): Promise<string> {
  const dumps: string[] = [];
  for await (const e of Deno.readDir(dumpsDir)) if (/^butler-.*\.sql\.gz$/.test(e.name)) dumps.push(e.name);
  const newest = dumps.sort().at(-1);
  if (!newest) return "no database dump yet";
  const dir = await folder("database", root);
  const list = await drive<{ files: { id: string; name: string }[] }>(
    `/drive/v3/files?q=${encodeURIComponent(`${quote(dir)} in parents and trashed = false`)}&fields=files(id,name)&pageSize=1000`,
  );
  if (!list.files.some((f) => f.name === newest)) {
    list.files.push({ id: await upload(newest, dir, await Deno.readFile(join(dumpsDir, newest)), "application/gzip"), name: newest });
  }
  const old = list.files.sort((a, b) => b.name.localeCompare(a.name)).slice(KEEP_DUMPS);
  for (const f of old) await drive(`/drive/v3/files/${f.id}`, { method: "DELETE" }).catch(() => {});
  return newest;
}

/** Uploads saved files that aren't in Drive yet. */
async function backUpFiles(filesDir: string, root: string): Promise<number> {
  const done = new Set((await sql<{ path: string }[]>`select path from backed_up_files`).map((r) => r.path));
  let dir: string | null = null;
  let count = 0;
  try {
    await Deno.stat(filesDir);
  } catch {
    return 0; // nothing saved yet
  }
  for await (const path of walk(filesDir)) {
    const rel = relative(filesDir, path);
    if (done.has(rel)) continue;
    dir ??= await folder("files", root);
    const id = await upload(rel.replaceAll("/", "__"), dir, await Deno.readFile(path), "application/octet-stream");
    await sql`insert into backed_up_files (path, drive_id) values (${rel}, ${id}) on conflict (path) do nothing`;
    count++;
  }
  return count;
}

/** One backup round. Safe to run any time: it only uploads what's missing. */
export async function backUp(dumpsDir: string, filesDir: string): Promise<BackupStatus> {
  const at = new Date().toISOString();
  try {
    if (!googleConfigured() || !(await account())) {
      last = { at, ok: false, note: "connect Google on the website to turn on backups" };
      return last;
    }
    const root = await folder("Butler backups");
    const dump = await backUpDumps(dumpsDir, root).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return "no database dumps folder";
      throw e;
    });
    const files = await backUpFiles(filesDir, root);
    last = { at, ok: true, note: `database ${dump}, ${files} new file${files === 1 ? "" : "s"}` };
  } catch (e) {
    last = { at, ok: false, note: e instanceof Error ? e.message : String(e) };
  }
  return last;
}
