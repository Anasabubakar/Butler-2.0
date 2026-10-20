// Gemini, for anything that has to see a picture: finding a button on a
// screenshot, explaining or solving what's on screen, and organizing screenshots.
import { z } from "npm:zod@4.3.6";

const base = () => Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com/v1beta";

export const geminiReady = () => Boolean(Deno.env.get("GEMINI_API_KEY"));

// Fastest first, for when Google won't list the models this key can use.
const FALLBACK = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash"];
const LIST_FOR_MS = 6 * 60 * 60 * 1000;
let listed: { base: string; at: number; names: string[] } | null = null;

/** The models this key can call generateContent on, or null if Google won't say. */
async function available(key: string): Promise<string[] | null> {
  if (listed && listed.base === base() && Date.now() - listed.at < LIST_FOR_MS) return listed.names;
  const names: string[] = [];
  let page = "";
  try {
    do {
      const res = await fetch(`${base()}/models?pageSize=1000${page && `&pageToken=${encodeURIComponent(page)}`}`, {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
      if (!Array.isArray(data.models)) return null;
      for (const m of data.models) {
        if (m.name && m.supportedGenerationMethods?.includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
      }
      page = data.nextPageToken ?? "";
    } while (page);
  } catch {
    return null;
  }
  listed = { base: base(), at: Date.now(), names };
  return names;
}

/**
 * The fast general models out of `names`, best first: stable before preview,
 * Flash-Lite before Flash, newest before older ("-latest" counts as newest).
 */
export function fastest(names: string[]): string[] {
  const usable = names.filter((n) => /^gemini-.*flash/.test(n) && !/image|tts|audio|live|exp|embedding|8b|computer/.test(n));
  const version = (n: string) => n.includes("-latest") ? Infinity : Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const preview = (n: string) => /preview/.test(n) ? 1 : 0;
  const lite = (n: string) => n.includes("lite") ? 0 : 1;
  return usable.sort((a, b) => preview(a) - preview(b) || lite(a) - lite(b) || version(b) - version(a) || a.localeCompare(b));
}

/** The models to try, in order: your choice if set, then the fastest this key can use. */
export async function geminiModels(key = Deno.env.get("GEMINI_API_KEY") ?? ""): Promise<string[]> {
  const chosen = Deno.env.get("BUTLER_GEMINI_MODEL");
  const names = await available(key);
  const ranked = names ? fastest(names) : FALLBACK;
  const first = chosen && (!names || names.includes(chosen)) ? [chosen] : [];
  return [...new Set([...first, ...ranked])].slice(0, 4);
}

export interface Picture {
  data: string; // base64
  mediaType: string;
}

/** A public video Gemini fetches itself, such as a YouTube link. */
export interface VideoLink {
  uri: string;
}

export interface AskOptions {
  timeoutMs?: number;
  /** Fewer tokens per video frame, so long videos fit and cost less. */
  lowDetail?: boolean;
}

/**
 * Asks Gemini about a picture (or several attachments, such as a screenshot and a voice
 * clip) and returns its JSON answer, checked against `schema`.
 */
export async function askGemini<T>(
  prompt: string,
  picture: Picture | VideoLink | (Picture | VideoLink)[] | null,
  schema: z.ZodType<T>,
  options: AskOptions = {},
): Promise<T> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const parts: unknown[] = [];
  for (const p of [picture ?? []].flat()) {
    parts.push("uri" in p ? { file_data: { file_uri: p.uri } } : { inline_data: { mime_type: p.mediaType, data: p.data } });
  }
  parts.push({ text: prompt });

  let lastError = "no Gemini model answered";
  for (const model of await geminiModels(key)) {
    // Thinking off is much faster; a model that refuses that gets asked again without it.
    for (const thinking of [true, false]) {
      const res = await fetch(`${base()}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            ...(options.lowDetail && { mediaResolution: "MEDIA_RESOLUTION_LOW" }),
            ...(thinking && { thinkingConfig: { thinkingBudget: 0 } }),
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      });
      if (res.ok) {
        const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch { /* checked below */ }
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new Error(`Gemini gave an unusable answer: ${text.slice(0, 200)}`);
        return parsed.data;
      }
      const body = await res.text();
      lastError = `Gemini ${model} answered ${res.status}: ${body.slice(0, 300)}`;
      if (/API key/i.test(body)) throw new Error(lastError); // a bad key fails on every model
      if (res.status !== 400) break; // 403, 404, 429, 5xx: try the next model
    }
  }
  throw new Error(lastError);
}
