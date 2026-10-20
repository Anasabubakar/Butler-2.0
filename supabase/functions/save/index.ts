// POST /functions/v1/save  — every device saves through here.
//
// Headers:  x-butler-token: <BUTLER_TOKEN>
// Body:     multipart/form-data with any of
//             device (required), text, url, note, file
//
// Responds 201 { id } straight away; organizing happens in the background.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { cleanUrl, extractUrl, kindFor, platformFor } from "../_shared/rules.ts";
import { fetchMeta } from "../_shared/meta.ts";
import { organize, type RawItem } from "../_shared/organize.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TOKEN = Deno.env.get("BUTLER_TOKEN") ?? "";
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_VISION_BYTES = 4 * 1024 * 1024;
const VISION_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function organizeInBackground(id: string, raw: RawItem, url: string | null) {
  try {
    if (url) {
      const meta = await fetchMeta(url, raw.platform);
      raw.pageTitle = meta.title;
      raw.pageDescription = meta.description;
      if (meta.image) await db.from("items").update({ thumbnail: meta.image }).eq("id", id);
    }
    const out = await organize(raw);
    await db.from("items").update({ ...out, status: "organized", error: null }).eq("id", id);
  } catch (e) {
    await db.from("items").update({ status: "failed", error: String(e).slice(0, 500) }).eq("id", id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!sameSecret(req.headers.get("x-butler-token") ?? "", TOKEN)) return json(401, { error: "bad token" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "expected multipart/form-data" });
  }

  const device = field(form, "device");
  if (!device) return json(400, { error: "device is required" });

  const text = field(form, "text");
  const note = field(form, "note");
  const rawUrl = field(form, "url") ?? extractUrl(text);
  const url = rawUrl ? cleanUrl(rawUrl) : null;
  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!url && !text && !hasFile) return json(400, { error: "nothing to save" });
  if (hasFile && file.size > MAX_FILE_BYTES) return json(413, { error: "file too large" });

  const mime = hasFile ? (file.type || "application/octet-stream") : null;
  const kind = kindFor({ mime, url, hasFile });
  const platform = platformFor(url);
  // Shared text that is only the link adds nothing.
  const body = text && text !== rawUrl ? text : null;

  const { data: row, error } = await db
    .from("items")
    .insert({ device, kind, url, body, note, mime, platform })
    .select("id")
    .single();
  if (error) return json(500, { error: error.message });

  let image: RawItem["image"];
  if (hasFile) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeName = (file.name || "upload").replace(/[^\w.\-]+/g, "_").slice(-100);
    const path = `${row.id}/${safeName}`;
    const up = await db.storage.from("items").upload(path, bytes, { contentType: mime! });
    if (up.error) {
      await db.from("items").update({ status: "failed", error: up.error.message }).eq("id", row.id);
      return json(500, { error: up.error.message, id: row.id });
    }
    await db.from("items").update({ file_path: path }).eq("id", row.id);

    const visionType = VISION_TYPES.find((t) => t === mime);
    if (visionType && bytes.length <= MAX_VISION_BYTES) {
      image = { data: encodeBase64(bytes), mediaType: visionType };
    }
  }

  const raw: RawItem = { kind, platform, url, body, note, image };
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
  EdgeRuntime.waitUntil(organizeInBackground(row.id, raw, url));

  return json(201, { id: row.id, kind, platform });
});
