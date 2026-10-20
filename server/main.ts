// Butler server: device saves, the library API, sign-in, files, and the website.
import { Hono, type Context, type Next } from "jsr:@hono/hono@4.13.10";
import { deleteCookie, getCookie, setCookie } from "jsr:@hono/hono@4.13.10/cookie";
import { serveStatic } from "jsr:@hono/hono@4.13.10/deno";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { dirname, fromFileUrl, join } from "jsr:@std/path@1.1.6";
import {
  newSession, SESSION_COOKIE, SESSION_DAYS, sameSecret, Throttle, validSession, verifyPassword,
} from "./lib/auth.ts";
import * as db from "./lib/db.ts";
import { fetchMeta } from "./lib/meta.ts";
import { organize, type RawItem } from "./lib/organize.ts";
import { cleanUrl, extractUrl, kindFor, platformFor } from "./lib/rules.ts";
import { geminiReady } from "./lib/gemini.ts";
import { LOOK_MODES, type LookMode, locate, look } from "./lib/screen.ts";

const env = (k: string, fallback?: string) => Deno.env.get(k) ?? fallback;
const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const PORT = Number(env("PORT", "8080"));
const TOKEN = env("BUTLER_TOKEN", "")!;
const PASSWORD_HASH = env("BUTLER_PASSWORD_HASH", "")!;
const SESSION_SECRET = env("SESSION_SECRET", "")!;
const FILES_DIR = env("FILES_DIR", join(ROOT, "data/files"))!;
const WEB_DIR = env("WEB_DIR", join(ROOT, "web/dist"))!;
const COOKIE_SECURE = env("COOKIE_SECURE", "true") !== "false";

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_VISION_BYTES = 4 * 1024 * 1024;
const VISION_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

for (const [name, value] of [["BUTLER_TOKEN", TOKEN], ["BUTLER_PASSWORD_HASH", PASSWORD_HASH], ["SESSION_SECRET", SESSION_SECRET]]) {
  if (!value) console.warn(`warning: ${name} is not set, so that kind of sign-in will always be refused`);
}

// --- organizing ------------------------------------------------------------------

async function organizeItem(id: string, raw: RawItem) {
  try {
    if (raw.url) {
      const meta = await fetchMeta(raw.url, raw.platform);
      raw.pageTitle = meta.title;
      raw.pageDescription = meta.description;
      if (meta.image) await db.updateItem(id, { thumbnail: meta.image });
    }
    const out = await organize(raw);
    await db.updateItem(id, { ...out, status: "organized", error: null });
  } catch (e) {
    await db.updateItem(id, { status: "failed", error: String(e).slice(0, 500) }).catch(() => {});
  }
}

async function rawFor(item: db.Item): Promise<RawItem> {
  const raw: RawItem = { kind: item.kind, platform: item.platform, url: item.url, body: item.body, note: item.note };
  const visionType = VISION_TYPES.find((t) => t === item.mime);
  if (item.file_path && visionType) {
    const bytes = await Deno.readFile(join(FILES_DIR, item.file_path)).catch(() => null);
    if (bytes && bytes.length <= MAX_VISION_BYTES) raw.image = { data: encodeBase64(bytes), mediaType: visionType };
  }
  return raw;
}

// --- app ---------------------------------------------------------------------------

const app = new Hono();
const loginThrottle = new Throttle(5, 60_000);

const clientIp = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

async function requireSession(c: Context, next: Next) {
  if (!(await validSession(getCookie(c, SESSION_COOKIE), SESSION_SECRET))) return c.json({ error: "sign in" }, 401);
  await next();
}

app.get("/api/health", (c) => c.json({ ok: true }));

// Devices save through here with the x-butler-token header.
app.post("/api/save", async (c) => {
  if (!sameSecret(c.req.header("x-butler-token") ?? "", TOKEN)) return c.json({ error: "bad token" }, 401);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "expected multipart/form-data" }, 400);
  }
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const device = field("device");
  if (!device) return c.json({ error: "device is required" }, 400);
  const text = field("text");
  const note = field("note");
  const rawUrl = field("url") ?? extractUrl(text);
  const url = rawUrl ? cleanUrl(rawUrl) : null;
  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!url && !text && !hasFile) return c.json({ error: "nothing to save" }, 400);
  if (hasFile && file.size > MAX_FILE_BYTES) return c.json({ error: "file too large" }, 413);

  const mime = hasFile ? (file.type || "application/octet-stream") : null;
  const kind = kindFor({ mime, url, hasFile });
  const platform = platformFor(url);
  const body = text && text !== rawUrl ? text : null;

  const id = await db.insertItem({ device, kind, url, body, note, mime, platform });

  if (hasFile) {
    const name = (file.name || "upload").replace(/[^\w.\-]+/g, "_").slice(-100) || "upload";
    const path = `${id}/${name}`;
    try {
      await Deno.mkdir(join(FILES_DIR, id), { recursive: true });
      await Deno.writeFile(join(FILES_DIR, path), file.stream());
      await db.updateItem(id, { file_path: path });
    } catch (e) {
      await db.updateItem(id, { status: "failed", error: `file: ${e}`.slice(0, 500) });
      return c.json({ error: "could not store file", id }, 500);
    }
  }

  const item = (await db.getItem(id))!;
  organizeItem(id, await rawFor(item)); // runs on after the response
  return c.json({ id, kind, platform }, 201);
});

// --- the desktop pet asks about a screenshot here, with the same token as saves --------

async function screenshotForm(c: Context) {
  if (!sameSecret(c.req.header("x-butler-token") ?? "", TOKEN)) return { error: c.json({ error: "bad token" }, 401) };
  if (!geminiReady()) return { error: c.json({ error: "no vision model: set GEMINI_API_KEY on the server" }, 503) };
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File) || !VISION_TYPES.some((t) => t === file.type)) {
    return { error: c.json({ error: "expected a screenshot in the file field" }, 400) };
  }
  if (file.size > MAX_VISION_BYTES) return { error: c.json({ error: "screenshot too large" }, 413) };
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
  };
  const picture = { data: encodeBase64(new Uint8Array(await file.arrayBuffer())), mediaType: file.type };
  return { picture, text };
}

// Where a button is: {found, x, y} on a 0 to 1000 grid over the screenshot.
app.post("/api/screen/locate", async (c) => {
  const got = await screenshotForm(c);
  if (got.error) return got.error;
  const target = got.text("target");
  if (!target) return c.json({ error: "target is required" }, 400);
  try {
    return c.json(await locate(got.picture, target));
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
});

// Explains (mode=analyze) or solves (mode=solve) what's on the screenshot.
app.post("/api/screen/look", async (c) => {
  const got = await screenshotForm(c);
  if (got.error) return got.error;
  const mode = got.text("mode") as LookMode | null;
  if (!mode || !LOOK_MODES.includes(mode)) return c.json({ error: "mode must be analyze or solve" }, 400);
  try {
    return c.json({ answer: await look(got.picture, mode, got.text("question")) });
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
});

app.post("/api/login", async (c) => {
  if (!loginThrottle.allow(clientIp(c))) return c.json({ error: "Too many tries. Wait a minute." }, 429);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!password || !PASSWORD_HASH || !(await verifyPassword(password, PASSWORD_HASH))) {
    return c.json({ error: "Wrong password" }, 401);
  }
  setCookie(c, SESSION_COOKIE, await newSession(SESSION_SECRET), {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: COOKIE_SECURE });
  return c.json({ ok: true });
});

app.use("/api/me", requireSession);
app.get("/api/me", (c) => c.json({ ok: true }));

app.use("/api/items/*", requireSession);
app.use("/api/items", requireSession);
app.use("/api/facets", requireSession);
app.use("/files/*", requireSession);

app.get("/api/items", async (c) => {
  const q = (k: string) => c.req.query(k)?.trim() || undefined;
  const ids = q("ids")?.split(",").filter((s) => UUID_RE.test(s));
  if (ids) return c.json(ids.length ? await db.itemsById(ids) : []);
  const before = q("before");
  return c.json(await db.listItems({
    q: q("q"), category: q("category"), platform: q("platform"), tag: q("tag"),
    before: before && !Number.isNaN(Date.parse(before)) ? before : undefined,
    limit: Math.min(Math.max(Number(q("limit")) || 40, 1), 100),
  }));
});

app.delete("/api/items/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const item = await db.deleteItem(id);
  if (!item) return c.json({ error: "not found" }, 404);
  if (item.file_path) await Deno.remove(join(FILES_DIR, id), { recursive: true }).catch(() => {});
  return c.json({ ok: true });
});

app.get("/api/facets", async (c) => c.json(await db.facets()));

// Saved files, only for the signed-in owner. Paths come from the database, never the URL.
app.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.notFound();
  const item = await db.getItem(id);
  if (!item?.file_path) return c.notFound();
  try {
    const file = await Deno.open(join(FILES_DIR, item.file_path));
    const { size } = await file.stat();
    return new Response(file.readable, {
      headers: {
        "content-type": item.mime ?? "application/octet-stream",
        "content-length": String(size),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  } catch {
    return c.notFound();
  }
});

// The website: built files, falling back to index.html.
app.use("/*", serveStatic({ root: WEB_DIR }));
app.get("*", async (c) => {
  const index = await Deno.readTextFile(join(WEB_DIR, "index.html")).catch(() => null);
  return index ? c.html(index) : c.text("Website not built: run npm run build in web/", 404);
});

// --- start ---------------------------------------------------------------------------

if (import.meta.main) {
  await db.migrate(join(ROOT, "db/migrations"));
  for (const item of await db.stalePending()) organizeItem(item.id, await rawFor(item));
  Deno.serve({ port: PORT, hostname: env("HOST", "0.0.0.0") }, app.fetch);
}

export { app };
