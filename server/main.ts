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
import { geminiModels, geminiReady } from "./lib/gemini.ts";
import { LOOK_MODES, type LookMode, locate, look, MAX_STEPS, nextStep } from "./lib/screen.ts";
import * as inbox from "./lib/inbox.ts";
import { calendarUrl, localIso, parseWhen, plan, safeZone } from "./lib/command.ts";
import * as google from "./lib/google.ts";
import * as backup from "./lib/backup.ts";
import * as meaning from "./lib/meaning.ts";
import { recall } from "./lib/recall.ts";
import * as brief from "./lib/brief.ts";
import * as recap from "./lib/recap.ts";
import * as settings from "./lib/settings.ts";

const env = (k: string, fallback?: string) => Deno.env.get(k) ?? fallback;
const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const PORT = Number(env("PORT", "8080"));
const TOKEN = env("BUTLER_TOKEN", "")!;
const PASSWORD_HASH = env("BUTLER_PASSWORD_HASH", "")!;
const SESSION_SECRET = env("SESSION_SECRET", "")!;
const FILES_DIR = env("FILES_DIR", join(ROOT, "data/files"))!;
const BACKUPS_DIR = env("BACKUPS_DIR", join(ROOT, "deploy/backups"))!;
const WEB_DIR = env("WEB_DIR", join(ROOT, "web/dist"))!;
const COOKIE_SECURE = env("COOKIE_SECURE", "true") !== "false";

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_VISION_BYTES = 4 * 1024 * 1024;
const VISION_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const VOICE_TYPES = ["audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg", "audio/aac"] as const;
const MAX_VOICE_BYTES = 4 * 1024 * 1024;
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
    await meaning.embedItem(id).catch((e) => console.error("embedding", id, String(e).slice(0, 200)));
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

// --- devices talking to each other, with the same token as saves --------------------

const deviceToken = (c: Context) => sameSecret(c.req.header("x-butler-token") ?? "", TOKEN);

async function deviceForm(c: Context) {
  const form = await c.req.formData().catch(() => null);
  const text = (k: string, max = 5000) => {
    const v = form?.get(k);
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  };
  const kind = text("kind") as inbox.DeviceKind | null;
  return { form, text, deviceKind: kind && inbox.DEVICE_KINDS.includes(kind) ? kind : null };
}

// Each device checks in every few seconds and takes what's waiting for it.
app.post("/api/inbox", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  const { text, deviceKind } = await deviceForm(c);
  const device = text("device", 100);
  if (!device || !deviceKind) return c.json({ error: "device and kind (laptop or phone) are required" }, 400);
  await inbox.checkIn(device, deviceKind);
  return c.json(await inbox.takeDue(device));
});

// Sends copied text, a link, a note or a screenshot to another device.
app.post("/api/send", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  const { form, text } = await deviceForm(c);
  const device = text("device", 100);
  const target = text("target", 100);
  const kind = text("kind") as inbox.MessageKind | null;
  if (!device || !target || !kind || !["clip", "note", "link", "file", "sync", "ring"].includes(kind)) {
    return c.json({ error: "device, target and kind (clip, note, link, file, sync or ring) are required" }, 400);
  }
  const to = await inbox.resolveTarget(target, device);
  if (!to.length) return c.json({ error: `no ${target} has checked in with Butler yet` }, 404);

  let item_id: string | null = null;
  if (kind === "file") {
    // Files go into the library too, so they're never lost.
    const file = form?.get("file");
    if (!(file instanceof File) || !file.size) return c.json({ error: "file is required" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: "file too large" }, 413);
    const mime = file.type || "application/octet-stream";
    item_id = await db.insertItem({
      device, kind: kindFor({ mime, url: null, hasFile: true }), url: null, body: null,
      note: `Sent to ${target}`, mime, platform: null,
    });
    const name = (file.name || "upload").replace(/[^\w.\-]+/g, "_").slice(-100) || "upload";
    try {
      await Deno.mkdir(join(FILES_DIR, item_id), { recursive: true });
      await Deno.writeFile(join(FILES_DIR, item_id, name), file.stream());
      await db.updateItem(item_id, { file_path: `${item_id}/${name}` });
    } catch (e) {
      await db.updateItem(item_id, { status: "failed", error: `file: ${e}`.slice(0, 500) });
      return c.json({ error: "could not store file" }, 500);
    }
    organizeItem(item_id, await rawFor((await db.getItem(item_id))!));
  }
  const body = text("text", 100_000);
  const url = text("url", 4000);
  if (kind !== "file" && !body && !url) return c.json({ error: "nothing to send" }, 400);
  await inbox.send(to, { from_device: device, kind, body, url, item_id });
  return c.json({ sent_to: to });
});

// A file sent to this device, fetched with the device token.
app.get("/api/inbox/file/:id", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.notFound();
  const item = await db.getItem(id);
  if (!item?.file_path) return c.notFound();
  const file = await Deno.open(join(FILES_DIR, item.file_path)).catch(() => null);
  if (!file) return c.notFound();
  return new Response(file.readable, {
    headers: {
      "content-type": item.mime ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${item.file_path.split("/").pop()}"`,
    },
  });
});

// Emails wait here for your yes; they're forgotten after 10 minutes.
const pendingEmails = new Map<string, { email: google.Email; expires: number }>();

function holdEmail(email: google.Email): string {
  const now = Date.now();
  for (const [id, p] of pendingEmails) if (p.expires < now) pendingEmails.delete(id);
  const id = crypto.randomUUID();
  pendingEmails.set(id, { email, expires: now + 10 * 60_000 });
  return id;
}

// Ask Butler: what you typed or said, plus optionally a screenshot of what you're looking at.
app.post("/api/command", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  if (!geminiReady()) return c.json({ error: "no AI model: set GEMINI_API_KEY on the server" }, 503);
  const { form, text, deviceKind } = await deviceForm(c);
  const device = text("device", 100);
  const typed = text("text", 2000);
  const audio = form?.get("audio");
  let voice = null;
  if (audio instanceof File && audio.size) {
    const type = audio.type.split(";")[0];
    if (!VOICE_TYPES.some((t) => t === type)) return c.json({ error: "unsupported voice clip type" }, 400);
    if (audio.size > MAX_VOICE_BYTES) return c.json({ error: "voice clip too long" }, 413);
    voice = { data: encodeBase64(new Uint8Array(await audio.arrayBuffer())), mediaType: type === "audio/x-wav" ? "audio/wav" : type };
  }
  if (!device || (!typed && !voice)) return c.json({ error: "device and text (or a voice clip) are required" }, 400);
  if (deviceKind) await inbox.checkIn(device, deviceKind);

  let picture = null;
  const file = form?.get("file");
  if (file instanceof File && file.size && VISION_TYPES.some((t) => t === file.type)) {
    if (file.size > MAX_VISION_BYTES) return c.json({ error: "screenshot too large" }, 413);
    picture = { data: encodeBase64(new Uint8Array(await file.arrayBuffer())), mediaType: file.type };
  }

  const timeZone = safeZone(text("tz", 100));
  if (timeZone !== "UTC" && timeZone === text("tz", 100)) await settings.set("time_zone", timeZone); // for the morning brief
  let p;
  try {
    p = await plan(typed, { device, timeZone, devices: await inbox.devices() }, picture, voice);
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
  const said = typed ?? p.heard?.trim() ?? "";
  const json = (body: Record<string, unknown>) => c.json({ heard: voice ? said : undefined, ...body });

  switch (p.action) {
    case "remind": {
      const when = parseWhen(p.when);
      if (!when) return json({ action: "answer", say: "When should I remind you?" });
      const everywhere = (await inbox.devices()).map((d) => d.name);
      const due = new Date(Math.max(when.getTime(), Date.now()));
      await inbox.send(everywhere.length ? everywhere : [device], {
        from_device: device, kind: "reminder", body: p.text || said, due_at: due.toISOString(),
      });
      return json({ action: "remind", say: p.reply || "Reminder set." });
    }
    case "calendar": {
      const start = parseWhen(p.when);
      if (!start) return json({ action: "answer", say: "When is it?" });
      const parsedEnd = parseWhen(p.end);
      const end = parsedEnd && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 3_600_000);
      const title = p.text || said;
      if (google.googleConfigured() && await google.account()) {
        try {
          await google.addEvent(title, start, end, timeZone);
          return json({ action: "calendar", say: p.reply || "Added to your calendar." });
        } catch (e) {
          return c.json({ error: String(e).slice(0, 300) }, 502);
        }
      }
      // Google isn't connected: open the event filled in, and you tap Save.
      return json({
        action: "calendar", say: "Here's the event. Tap Save to add it.", open: calendarUrl(title, start, end),
      });
    }
    case "email": {
      if (!google.googleConfigured() || !(await google.account())) {
        return json({ action: "answer", say: "Connect your Google account on the Butler website first, then ask again." });
      }
      const who = (p.person ?? "").trim();
      if (!who) return json({ action: "answer", say: "Who should I email?" });
      let people: { name: string; email: string }[];
      try {
        people = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)
          ? [{ name: who, email: who }]
          : (await google.findPeople(who)).flatMap((p) => (p.email ? [{ name: p.name, email: p.email }] : []));
      } catch (e) {
        return c.json({ error: String(e).slice(0, 300) }, 502);
      }
      if (!people.length) {
        return json({ action: "answer", say: `I couldn't find ${who} in your contacts. Ask again with their email address.` });
      }
      const [to, ...others] = people;
      const subject = p.subject || "From Butler";
      const body = p.text || said;
      const attachment = p.attach_screen && picture
        ? { name: "screenshot.jpg", mime: picture.mediaType, data: new Uint8Array(await (file as File).arrayBuffer()) }
        : undefined;
      const confirm = holdEmail({ to, subject, body, attachment });
      const also = others.length ? `\n(Also found: ${others.map((o) => `${o.name} <${o.email}>`).join(", ")}.)` : "";
      return json({
        action: "confirm",
        say: `Send this to ${to.name} <${to.email}>?\nSubject: ${subject}\n\n${body}${attachment ? "\n\n[screenshot attached]" : ""}${also}`,
        confirm,
      });
    }
    case "send":
      return json({
        action: "send", say: p.reply,
        send: { target: p.target || "laptop", content: p.content ?? "text", text: p.text ?? null },
      });
    case "save": {
      const id = await db.insertItem({
        device, kind: "text", url: null, body: p.text || said, note: null, mime: null, platform: null,
      });
      organizeItem(id, await rawFor((await db.getItem(id))!));
      return json({ action: "save", say: p.reply || "Saved to Butler." });
    }
    case "screen":
      return json({ action: "screen", say: p.reply, goal: p.text || said });
    case "brief": {
      const now = new Date();
      return json({ action: "answer", say: brief.compose(await brief.gather(now, timeZone, env("PUBLIC_URL")), now, timeZone) });
    }
    case "recap":
      return json({ action: "answer", say: recap.compose(await recap.gather(new Date(), env("PUBLIC_URL"))) });
    case "recall": {
      try {
        const found = await findInLibrary(p.text || said);
        return json({ action: "answer", ...await recall(said, found, env("PUBLIC_URL")) });
      } catch (e) {
        return c.json({ error: String(e).slice(0, 300) }, 502);
      }
    }
    case "message": {
      const who = (p.person ?? "").trim();
      if (!who) return json({ action: "answer", say: "Who should I message?" });
      let name = who;
      let phone = /^\+?[\d\s()-]{7,}$/.test(who) ? who.replace(/[^\d+]/g, "") : null;
      if (!phone && google.googleConfigured() && await google.account()) {
        const found = (await google.findPeople(who).catch(() => [])).find((f) => f.phone);
        if (found) ({ name, phone } = { name: found.name, phone: found.phone });
      }
      return json({
        action: "message",
        say: p.reply,
        message: { app: p.app ?? "whatsapp", person: who, name, phone, text: p.text || said, attach_screen: Boolean(p.attach_screen) },
      });
    }
    default:
      return json({ action: "answer", say: p.reply || "I'm not sure how to help with that yet." });
  }
});

// Your yes to an email Ask Butler wrote.
app.post("/api/command/confirm", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  const { text } = await deviceForm(c);
  const id = text("confirm", 100) ?? "";
  const pending = pendingEmails.get(id);
  pendingEmails.delete(id);
  if (!pending || pending.expires < Date.now()) return c.json({ error: "that email expired, ask again" }, 410);
  try {
    await google.sendEmail(pending.email);
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
  return c.json({ say: `Sent to ${pending.email.to.name}.` });
});

// The screen helper: the next single step towards a goal, from a screenshot.
app.post("/api/screen/step", async (c) => {
  const got = await screenshotForm(c);
  if (got.error) return got.error;
  const goal = got.text("goal");
  if (!goal) return c.json({ error: "goal is required" }, 400);
  let done: string[] = [];
  try {
    const parsed = JSON.parse(got.text("done") ?? "[]");
    if (Array.isArray(parsed)) done = parsed.map((d) => String(d).slice(0, 200));
  } catch { /* none yet */ }
  if (done.length >= MAX_STEPS) return c.json({ do: "stop", say: `I stopped after ${MAX_STEPS} steps. Take it from here.` });
  try {
    return c.json(await nextStep(got.picture, goal, done, got.text("kind") === "phone" ? "phone" : "laptop"));
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

// The phone app opens the library inside itself: its device token buys a website session,
// handed back for the app to put in its own browser's cookies.
app.post("/api/device-session", async (c) => {
  if (!deviceToken(c)) return c.json({ error: "bad token" }, 401);
  return c.json({ cookie: SESSION_COOKIE, value: await newSession(SESSION_SECRET), days: SESSION_DAYS });
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

/** Items in the order of `ranked`, each with its closeness score. */
async function rankedItems(ranked: { id: string; score: number }[]) {
  const items = ranked.length ? await db.itemsById(ranked.map((r) => r.id)) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return ranked.flatMap((r) => (byId.has(r.id) ? [{ ...byId.get(r.id)!, score: Math.round(r.score * 100) / 100 }] : []));
}

/** Up to 8 saved items that might answer `query`: closest in meaning first, then matching words. */
async function findInLibrary(query: string) {
  const close = meaning.meaningReady()
    ? (await meaning.nearest(await meaning.embed(query, "query"), 8)).filter((r) => r.score > 0.45)
    : [];
  const byMeaning = await rankedItems(close);
  const byWords = await db.listItems({ q: query, limit: 5 }).catch(() => []);
  const seen = new Set(byMeaning.map((i) => i.id));
  return [...byMeaning, ...byWords.filter((i) => !seen.has(i.id))].slice(0, 8);
}

// Things like this one.
app.get("/api/items/:id/similar", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const vector = await meaning.embeddingOf(id);
  if (!vector) return c.json([]);
  return c.json(await rankedItems((await meaning.nearest(vector, 12, id)).filter((r) => r.score > 0.55)));
});

// Search by meaning: "that video about saving money" finds it without the exact words.
app.use("/api/meaning", requireSession);
app.get("/api/meaning", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q || !meaning.meaningReady()) return c.json([]);
  try {
    const vector = await meaning.embed(q, "query");
    return c.json(await rankedItems((await meaning.nearest(vector, 20)).filter((r) => r.score > 0.5)));
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
});

// --- your Google account, connected from the website ------------------------------------

app.use("/api/google/*", requireSession);

app.get("/api/google/status", async (c) => {
  const account = google.googleConfigured() ? await google.account() : null;
  return c.json({
    configured: google.googleConfigured(),
    connected: Boolean(account),
    email: account?.email ?? null,
    backup: backup.lastBackup(),
  });
});

app.get("/api/google/connect", (c) => {
  if (!google.googleConfigured()) return c.json({ error: "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server" }, 503);
  const state = crypto.randomUUID();
  setCookie(c, "butler_google_state", state, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: "Lax", path: "/api/google", maxAge: 600,
  });
  return c.redirect(google.consentUrl(state));
});

app.get("/api/google/callback", async (c) => {
  const state = getCookie(c, "butler_google_state");
  deleteCookie(c, "butler_google_state", { path: "/api/google", secure: COOKIE_SECURE });
  const code = c.req.query("code");
  if (!state || !sameSecret(state, c.req.query("state") ?? "") || !code) return c.redirect("/?google=failed");
  try {
    await google.connect(code);
  } catch (e) {
    console.error("google connect:", e);
    return c.redirect("/?google=failed");
  }
  backUpSoon(); // a fresh connection may have just allowed backups
  return c.redirect("/?google=connected");
});

app.post("/api/google/disconnect", async (c) => {
  await google.disconnect();
  return c.json({ ok: true });
});

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

// --- backups to Google Drive -------------------------------------------------------------

let backingUp = false;
function backUpSoon() {
  if (backingUp) return;
  backingUp = true;
  backup.backUp(BACKUPS_DIR, FILES_DIR)
    .then((r) => (r.ok ? console.log : console.warn)("backup:", r.note))
    .finally(() => (backingUp = false));
}

// --- the morning brief -----------------------------------------------------------------

const BRIEF_AT = env("BUTLER_BRIEF_AT", "08:00")!;

/** Your time zone, as your devices last said it. */
async function ownerZone() {
  return safeZone(await settings.get("time_zone") ?? env("BUTLER_TZ"));
}

/** Sends the brief to every device once a day, at BUTLER_BRIEF_AT your time (unless it's past noon). */
async function briefIfDue(now = new Date()) {
  if (env("BUTLER_BRIEF") === "off") return;
  const timeZone = await ownerZone();
  const local = localIso(now, timeZone);
  const day = local.slice(0, 10);
  const time = local.slice(11, 16);
  if (time < BRIEF_AT || time >= "12:00" || await settings.get("brief_sent_on") === day) return;
  const devices = (await inbox.devices()).map((d) => d.name);
  if (!devices.length) return;
  await settings.set("brief_sent_on", day);
  const body = brief.compose(await brief.gather(now, timeZone, env("PUBLIC_URL")), now, timeZone);
  await inbox.send(devices, { from_device: "Butler", kind: "note", body });
  console.log(`brief: sent to ${devices.join(", ")}`);
}

const RECAP_AT = env("BUTLER_RECAP_AT", "18:00")!;

/** Sends the weekly recap to every device on Sunday at BUTLER_RECAP_AT your time. */
async function recapIfDue(now = new Date()) {
  if (env("BUTLER_RECAP") === "off") return;
  const timeZone = await ownerZone();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  const local = localIso(now, timeZone);
  const day = local.slice(0, 10);
  if (weekday !== "Sunday" || local.slice(11, 16) < RECAP_AT || await settings.get("recap_sent_on") === day) return;
  const devices = (await inbox.devices()).map((d) => d.name);
  if (!devices.length) return;
  await settings.set("recap_sent_on", day);
  const body = recap.compose(await recap.gather(now, env("PUBLIC_URL")));
  await inbox.send(devices, { from_device: "Butler", kind: "note", body });
  console.log(`recap: sent to ${devices.join(", ")}`);
}

// --- start ---------------------------------------------------------------------------

if (import.meta.main) {
  await db.migrate(join(ROOT, "db/migrations"));
  for (const item of await db.stalePending()) organizeItem(item.id, await rawFor(item));
  meaning.backfill().catch((e) => console.error("embedding backfill:", e)); // items saved before this existed
  setTimeout(backUpSoon, 60_000); // once things settle, then every 6 hours
  setInterval(backUpSoon, 6 * 60 * 60 * 1000);
  setInterval(() => briefIfDue().catch((e) => console.error("brief:", e)), 5 * 60_000);
  setInterval(() => recapIfDue().catch((e) => console.error("recap:", e)), 5 * 60_000);
  if (geminiReady()) geminiModels().then((m) => console.log("Gemini models, in order:", m.join(", ")));
  Deno.serve({ port: PORT, hostname: env("HOST", "0.0.0.0") }, app.fetch);
}

export { app };
