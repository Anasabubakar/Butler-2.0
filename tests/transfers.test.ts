import { test } from "node:test";
import assert from "node:assert/strict";
import * as transfers from "../server/lib/transfers.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const stream = (text: string) => new Blob([bytes(text)]).stream();

async function readAll(file: Deno.FsFile, length: number) {
  const out = new Uint8Array(length);
  let at = 0;
  while (at < length) {
    const n = await file.read(out.subarray(at));
    if (n === null) break;
    at += n;
  }
  file.close();
  return new TextDecoder().decode(out.subarray(0, at));
}

test("names lose folders, hidden dots and characters other systems refuse", () => {
  assert.equal(transfers.safeName("../../etc/passwd"), "passwd");
  assert.equal(transfers.safeName("C:\\Users\\me\\photo.jpg"), "photo.jpg");
  assert.equal(transfers.safeName(".bashrc"), "bashrc");
  assert.equal(transfers.safeName('a<b>c:"d|e?.txt'), "a_b_c_d_e_.txt");
  assert.equal(transfers.safeName(""), "file");
  assert.equal(transfers.safeName("..."), "file");
  const long = transfers.safeName("x".repeat(300) + ".jpeg");
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".jpeg"));
});

test("a list of files needs sizes, and is capped in count and bytes", () => {
  assert.deepEqual(transfers.checkFiles([{ name: "a.jpg", size: 3, mime: "image/jpeg" }], 10), [
    { name: "a.jpg", size: 3, mime: "image/jpeg" },
  ]);
  assert.equal(transfers.checkFiles([{ name: "a", size: 0, mime: "not a type" }], 10)[0].mime, "application/octet-stream");
  assert.throws(() => transfers.checkFiles([], 10), /no files/);
  assert.throws(() => transfers.checkFiles([{ name: "a", size: -1 }], 10), /size/);
  assert.throws(() => transfers.checkFiles([{ name: "a", size: 1.5 }], 10), /size/);
  assert.throws(() => transfers.checkFiles([{ name: "a", size: 6 }, { name: "b", size: 6 }], 10), /GB/);
  assert.throws(() => transfers.checkFiles(Array(transfers.MAX_FILES + 1).fill({ name: "a", size: 1 }), 1e9), /files/);
});

test("pieces arrive in order, can be read while still coming, and a wrong offset says where to carry on", async () => {
  const root = await Deno.makeTempDir();
  try {
    const t = await transfers.create(root, "phone", ["laptop"], [{ name: "a.txt", size: 11, mime: "text/plain" }]);
    const f = t.files[0].id;
    assert.equal(await transfers.append(root, t, f, 0, stream("hello ")), 6);
    await assert.rejects(transfers.append(root, t, f, 0, stream("again")), (e: unknown) => e instanceof transfers.WrongOffset && e.received === 6);
    // Asking with no piece just says how far it got.
    assert.equal(await transfers.append(root, t, f, 6, null), 6);

    const half = await transfers.read(root, t, f, 2);
    assert.equal(half.length, 4);
    assert.equal(await readAll(half.file, half.length), "llo ");

    let s = await transfers.status(root, t);
    assert.equal(s.received, 6);
    assert.equal(s.complete, false);

    assert.equal(await transfers.append(root, t, f, 6, stream("world")), 11);
    s = await transfers.status(root, t);
    assert.equal(s.complete, true);
    const all = await transfers.read(root, t, f, 0);
    assert.equal(await readAll(all.file, all.length), "hello world");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

test("a piece that would make the file bigger than it said is thrown away whole", async () => {
  const root = await Deno.makeTempDir();
  try {
    const t = await transfers.create(root, "phone", ["laptop"], [{ name: "a", size: 4, mime: "text/plain" }]);
    await assert.rejects(transfers.append(root, t, t.files[0].id, 0, stream("too long")), /bigger/);
    assert.equal((await transfers.status(root, t)).received, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

test("a transfer is deleted once every device has it, or after a day", async () => {
  const root = await Deno.makeTempDir();
  try {
    const t = await transfers.create(root, "laptop", ["phone-a", "phone-b"], [{ name: "a", size: 0, mime: "text/plain" }]);
    assert.equal(await transfers.finish(root, t, "phone-a"), false);
    assert.ok(await transfers.get(root, t.id));
    assert.equal(await transfers.finish(root, (await transfers.get(root, t.id))!, "phone-b"), true);
    assert.equal(await transfers.get(root, t.id), null);

    const old = await transfers.create(root, "laptop", ["phone"], [{ name: "a", size: 0, mime: "text/plain" }]);
    assert.equal(await transfers.sweep(root, 60_000, Date.now() + 30_000), 0);
    assert.equal(await transfers.sweep(root, 60_000, Date.now() + 120_000), 1);
    assert.equal(await transfers.get(root, old.id), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

test("ids that aren't transfer ids never become paths", async () => {
  assert.equal(await transfers.get("/tmp", "../etc"), null);
  assert.equal(await transfers.sweep("/no/such/folder"), 0);
});
