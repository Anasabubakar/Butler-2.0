import { test } from "node:test";
import assert from "node:assert/strict";
import {
  doneText,
  fileForTitle,
  fraction,
  namesText,
  pathsFromText,
  pathsFromUris,
  progressText,
  sizeText,
} from "../desktop/gnome/butler-pet@anasmasama.dev/filepick.js";

test("files copied in Files come off the clipboard as paths, spaces and all", () => {
  assert.deepEqual(pathsFromUris("copy\nfile:///home/anas/Pictures/My%20photo.jpg\nfile:///home/anas/a.pdf"), [
    "/home/anas/Pictures/My photo.jpg",
    "/home/anas/a.pdf",
  ]);
  assert.deepEqual(pathsFromUris("# a comment\r\nfile:///tmp/x.txt\r\n"), ["/tmp/x.txt"]);
});

test("web links, other machines' files and plain text aren't files", () => {
  assert.deepEqual(pathsFromUris("https://example.com/a.jpg\nfile://server/share/a.jpg\nhello"), []);
  assert.deepEqual(pathsFromUris(""), []);
  assert.deepEqual(pathsFromUris("file:///a\nfile:///a"), ["/a"]);
});

test("files copied as plain paths count, ordinary text never does", () => {
  assert.deepEqual(pathsFromText("/home/anas/a.jpg\n/home/anas/My file.pdf\n"), ["/home/anas/a.jpg", "/home/anas/My file.pdf"]);
  assert.deepEqual(pathsFromText("file:///home/anas/a%20b.jpg"), ["/home/anas/a b.jpg"]);
  assert.deepEqual(pathsFromText("hello /home/anas/a.jpg"), []);
  assert.deepEqual(pathsFromText("/home/anas/a.jpg\nand some notes"), []);
  assert.deepEqual(pathsFromText("file://server/share/a.jpg"), []);
  assert.deepEqual(pathsFromText(""), []);
});

const XBEL = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="file:///home/anas/Old/photo.jpg" added="2026-10-01T10:00:00Z" modified="2026-10-01T10:00:00Z" visited="2026-10-01T10:00:00Z">
  </bookmark>
  <bookmark href="file:///home/anas/Pictures/photo.jpg" added="2026-10-20T10:00:00Z" modified="2026-10-27T09:00:00.123456Z" visited="2026-10-27T09:00:00Z">
  </bookmark>
  <bookmark href="file:///home/anas/Docs/Tom%20&amp;%20Jerry.pdf" added="2026-10-26T10:00:00Z" modified="2026-10-26T10:00:00Z" visited="2026-10-26T10:00:00Z">
  </bookmark>
  <bookmark href="https://example.com/" added="2026-10-26T10:00:00Z" modified="2026-10-26T10:00:00Z" visited="2026-10-26T10:00:00Z">
  </bookmark>
</xbel>`;

test("the file open in a viewer is found by its title, the latest one used winning", () => {
  assert.equal(fileForTitle(XBEL, "photo.jpg — Image Viewer"), "/home/anas/Pictures/photo.jpg");
  assert.equal(fileForTitle(XBEL, "Tom & Jerry.pdf"), "/home/anas/Docs/Tom & Jerry.pdf");
  assert.equal(fileForTitle(XBEL, "• photo.jpg - GIMP"), "/home/anas/Pictures/photo.jpg");
});

test("a title that only looks a bit like a file's name finds nothing", () => {
  assert.equal(fileForTitle(XBEL, "photo.jpgx"), null);
  assert.equal(fileForTitle(XBEL, "my photo.jpg"), null);
  assert.equal(fileForTitle(XBEL, ""), null);
  assert.equal(fileForTitle("", "photo.jpg"), null);
});

test("sizes and names read well in the bubble", () => {
  assert.equal(sizeText(0), "0 bytes");
  assert.equal(sizeText(1), "1 byte");
  assert.equal(sizeText(1536), "1.5 KB");
  assert.equal(sizeText(27 * 1024 * 1024), "27 MB");
  assert.equal(namesText(["a.jpg"]), "a.jpg");
  assert.equal(namesText(["a.jpg", "b.pdf"]), "a.jpg and b.pdf");
  assert.equal(namesText(["a", "b", "c"]), "a, b and c");
  assert.equal(namesText(["a", "b", "c", "d", "e"], 12), "a, b and 10 more");
});

test("the bubble says what's coming, how far along and which way", () => {
  const p = { direction: "in", names: ["a.jpg", "b.pdf", "c.mp4"], count: 3, done: 512 * 1024, size: 1024 * 1024, via: "wifi" };
  assert.deepEqual(progressText(p), { line: "Receiving 3 files: a.jpg, b.pdf and c.mp4", detail: "50% · 512 KB of 1.0 MB · over Wi-Fi" });
  assert.equal(progressText({ ...p, direction: "out", count: 1, names: ["a.jpg"], via: "server" }).line, "Sending 1 file: a.jpg");
  assert.equal(fraction({ done: 0, size: 0 }), 1);
  assert.equal(fraction({ done: 20, size: 10 }), 1);
});

test("when it's done the pet says where the files are", () => {
  assert.equal(doneText({ direction: "in", paths: ["/home/anas/Downloads/Butler/a.jpg"], folder: "/home/anas/Downloads/Butler", peer: "android-pixel" }, "/home/anas"),
    "Got 1 file from android-pixel. Saved in ~/Downloads/Butler");
  assert.equal(doneText({ direction: "out", paths: ["/a", "/b"], via: "wifi", peer: "android-pixel" }, "/home/anas"),
    "Sent 2 files to android-pixel over Wi-Fi");
});
