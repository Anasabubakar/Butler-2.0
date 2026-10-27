// Files sent between your devices through the server, when they can't reach each other
// directly. The sender uploads each file in pieces (so a dropped connection carries on where
// it stopped), and the other device downloads what has arrived so far, at the same time.
// They're not saves: each transfer is deleted once every device it went to has it, or after
// a day. Kept as plain files, one folder per transfer, so nothing here needs the database.
import { join } from "jsr:@std/path@1.1.6";

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface Transfer {
  id: string;
  created_at: string;
  from_device: string;
  to: string[];
  files: TransferFile[];
  /** Devices that said they have everything. */
  done: string[];
}

export interface FileStatus extends TransferFile {
  received: number;
}

export interface Status extends Omit<Transfer, "files"> {
  files: FileStatus[];
  size: number;
  received: number;
  complete: boolean;
}

/** A piece came for the wrong place: the sender should carry on from `received`. */
export class WrongOffset extends Error {
  constructor(readonly received: number) {
    super(`expected the piece at ${received}`);
  }
}

export const MAX_FILES = 200;
export const MAX_PIECE = 16 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A name that's safe as one path part: no folders, no hidden files, at most 120 characters. */
export function safeName(name: string): string {
  const base = String(name ?? "").split(/[/\\]/).pop() ?? "";
  // deno-lint-ignore no-control-regex
  const clean = base.replace(/[\x00-\x1f<>:"|?*]+/g, "_").replace(/^[.\s]+/, "").trim();
  if (!clean) return "file";
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - ext.length) + ext;
}

/** The files a sender described, checked: names made safe, sizes whole numbers, totals capped. */
export function checkFiles(list: unknown, maxBytes: number): Omit<TransferFile, "id">[] {
  if (!Array.isArray(list) || !list.length) throw new Error("no files to send");
  if (list.length > MAX_FILES) throw new Error(`that's more than ${MAX_FILES} files at once`);
  let total = 0;
  const files = list.map((f) => {
    const size = Number(f?.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("every file needs its size in bytes");
    total += size;
    const mime = typeof f?.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(f.mime) ? f.mime : "application/octet-stream";
    return { name: safeName(f?.name), size, mime };
  });
  if (total > maxBytes) throw new Error(`that's more than ${Math.round(maxBytes / 1024 ** 3)} GB at once`);
  return files;
}

const dirOf = (root: string, id: string) => {
  if (!UUID.test(id)) throw new Deno.errors.NotFound("no such transfer");
  return join(root, id);
};

async function readMeta(root: string, id: string): Promise<Transfer> {
  return JSON.parse(await Deno.readTextFile(join(dirOf(root, id), "meta.json")));
}

async function writeMeta(root: string, t: Transfer) {
  const path = join(dirOf(root, t.id), "meta.json");
  await Deno.writeTextFile(`${path}.tmp`, JSON.stringify(t));
  await Deno.rename(`${path}.tmp`, path);
}

/** Starts a transfer: makes its folder and an empty file for each one to come. */
export async function create(
  root: string,
  from_device: string,
  to: string[],
  files: Omit<TransferFile, "id">[],
): Promise<Transfer> {
  const t: Transfer = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    from_device,
    to,
    files: files.map((f) => ({ ...f, id: crypto.randomUUID() })),
    done: [],
  };
  await Deno.mkdir(dirOf(root, t.id), { recursive: true });
  for (const f of t.files) await Deno.writeFile(join(dirOf(root, t.id), f.id), new Uint8Array());
  await writeMeta(root, t);
  return t;
}

export async function get(root: string, id: string): Promise<Transfer | null> {
  try {
    return await readMeta(root, id);
  } catch {
    return null;
  }
}

async function sizeOf(path: string) {
  return (await Deno.stat(path)).size;
}

/** How far along a transfer is, file by file. */
export async function status(root: string, t: Transfer): Promise<Status> {
  const files = await Promise.all(t.files.map(async (f) => ({
    ...f,
    received: Math.min(await sizeOf(join(dirOf(root, t.id), f.id)).catch(() => 0), f.size),
  })));
  const size = files.reduce((n, f) => n + f.size, 0);
  const received = files.reduce((n, f) => n + f.received, 0);
  return { ...t, files, size, received, complete: received === size };
}

function fileIn(t: Transfer, fileId: string): TransferFile {
  const f = t.files.find((f) => f.id === fileId);
  if (!f) throw new Deno.errors.NotFound("no such file in this transfer");
  return f;
}

// Files a piece is being written to right now: a second piece at the same time would mix them up.
const writing = new Set<string>();

/**
 * Adds one piece of a file at `offset`. Pieces must come in order: if `offset` isn't where the
 * file has got to, nothing is written and WrongOffset says where to carry on from.
 */
export async function append(
  root: string,
  t: Transfer,
  fileId: string,
  offset: number,
  piece: ReadableStream<Uint8Array> | null,
): Promise<number> {
  const f = fileIn(t, fileId);
  const path = join(dirOf(root, t.id), f.id);
  const have = await sizeOf(path);
  if (offset !== have || writing.has(path)) throw new WrongOffset(have);
  if (!piece) return have;
  writing.add(path);
  const file = await Deno.open(path, { write: true, append: true });
  let written = 0;
  try {
    for await (const chunk of piece) {
      written += chunk.length;
      if (written > MAX_PIECE || have + written > f.size) throw new Error("that piece is bigger than it should be");
      let at = 0;
      while (at < chunk.length) at += await file.write(chunk.subarray(at));
    }
  } catch (e) {
    await file.truncate(have).catch(() => {}); // leave it as it was, so the piece can be sent again
    throw e;
  } finally {
    file.close();
    writing.delete(path);
  }
  return have + written;
}

/** Opens a file to read from `start` up to what has arrived so far. */
export async function read(root: string, t: Transfer, fileId: string, start: number) {
  const f = fileIn(t, fileId);
  const path = join(dirOf(root, t.id), f.id);
  const received = Math.min(await sizeOf(path), f.size);
  const from = Math.max(0, Math.min(start, received));
  const file = await Deno.open(path, { read: true });
  await file.seek(from, Deno.SeekMode.Start);
  return { file, from, length: received - from, received, size: f.size };
}

/** A device has everything. Once every device it went to has, the transfer is deleted. */
export async function finish(root: string, t: Transfer, device: string): Promise<boolean> {
  if (!t.done.includes(device)) t.done.push(device);
  if (t.to.every((d) => t.done.includes(d))) {
    await remove(root, t.id);
    return true;
  }
  await writeMeta(root, t);
  return false;
}

export async function remove(root: string, id: string) {
  await Deno.remove(dirOf(root, id), { recursive: true }).catch(() => {});
}

/** Deletes transfers older than `maxAge` (a day by default): nobody came for them. */
export async function sweep(root: string, maxAge = DAY, now = Date.now()): Promise<number> {
  let gone = 0;
  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory || !UUID.test(entry.name)) continue;
      const t = await get(root, entry.name);
      const born = t ? Date.parse(t.created_at) : (await Deno.stat(join(root, entry.name))).mtime?.getTime() ?? 0;
      if (now - born > maxAge) {
        await remove(root, entry.name);
        gone++;
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return gone;
}
