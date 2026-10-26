// Gemini, for anything that has to see a picture: finding a button on a
// screenshot, explaining or solving what's on screen, and organizing screenshots.
// When Gemini can't answer (out of quota, down), Butler tries your other Gemini keys,
// then any backup providers you've set up: OpenRouter, Groq or OpenAI.
import { z } from "npm:zod@4.3.6";

const base = () => Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com/v1beta";

/** Your Gemini keys. GEMINI_API_KEY can hold several, separated by commas. */
export const geminiKeys = () => (Deno.env.get("GEMINI_API_KEY") ?? "").split(",").map((k) => k.trim()).filter(Boolean);

/** Backups that speak OpenAI's chat API. They can see pictures, but not videos or voice clips. */
const BACKUPS: Record<string, { key: string; url: string; model: string }> = {
  openrouter: { key: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" },
  groq: { key: "GROQ_API_KEY", url: "https://api.groq.com/openai/v1", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  openai: { key: "OPENAI_API_KEY", url: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
};

/** The providers with a key, in the order they're tried (BUTLER_AI_ORDER, or Gemini first). */
export function aiProviders(): string[] {
  const order = (Deno.env.get("BUTLER_AI_ORDER") ?? "gemini,openrouter,groq,openai").split(",").map((p) => p.trim().toLowerCase());
  return [...new Set(order)].filter((p) => p === "gemini" ? geminiKeys().length > 0 : Boolean(BACKUPS[p] && Deno.env.get(BACKUPS[p].key)));
}

/** Whether any provider is set up. */
export const geminiReady = () => aiProviders().length > 0;

// Fastest first, for when Google won't list the models this key can use.
const FALLBACK = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash"];
const LIST_FOR_MS = 6 * 60 * 60 * 1000;
const listed = new Map<string, { at: number; names: string[] }>(); // per URL and key

/** The models this key can call generateContent on, or null if Google won't say. */
async function available(key: string): Promise<string[] | null> {
  const known = listed.get(`${base()} ${key}`);
  if (known && Date.now() - known.at < LIST_FOR_MS) return known.names;
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
  listed.set(`${base()} ${key}`, { at: Date.now(), names });
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
export async function geminiModels(key = geminiKeys()[0] ?? ""): Promise<string[]> {
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
  /** Standing instructions, sent as the system prompt: who Butler is and how it sounds. */
  system?: string;
}

type Attachment = Picture | VideoLink;

/** Checks the model's reply against `schema`. Some models wrap JSON in ``` fences. */
function check<T>(who: string, text: string, schema: z.ZodType<T>): T {
  let json: unknown = null;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch { /* checked below */ }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`${who} gave an unusable answer: ${text.slice(0, 200)}`);
  return parsed.data;
}

/**
 * Asks Gemini about a picture (or several attachments, such as a screenshot and a voice
 * clip) and returns its JSON answer, checked against `schema`. If one key or provider
 * fails, the next is tried; the error lists what each said.
 */
export async function askGemini<T>(
  prompt: string,
  picture: Attachment | Attachment[] | null,
  schema: z.ZodType<T>,
  options: AskOptions = {},
): Promise<T> {
  const attachments = [picture ?? []].flat();
  const onlyImages = attachments.every((a) => !("uri" in a) && a.mediaType.startsWith("image/"));
  const providers = aiProviders();
  if (!providers.length) throw new Error("no AI provider is set: add GEMINI_API_KEY (or a backup) on the server");
  const errors: string[] = [];
  for (const provider of providers) {
    if (provider === "gemini") {
      for (const [i, key] of geminiKeys().entries()) {
        try {
          return await askOneGemini(key, prompt, attachments, schema, options);
        } catch (e) {
          errors.push(`Gemini key ${i + 1}: ${(e as Error).message}`);
        }
      }
    } else if (!onlyImages) {
      errors.push(`${provider}: skipped, it can't take videos or voice clips`);
    } else {
      try {
        return await askBackup(provider, prompt, attachments as Picture[], schema, options);
      } catch (e) {
        errors.push(`${provider}: ${(e as Error).message}`);
      }
    }
  }
  throw new Error(errors.join(" | "));
}

async function askOneGemini<T>(
  key: string,
  prompt: string,
  attachments: Attachment[],
  schema: z.ZodType<T>,
  options: AskOptions,
): Promise<T> {
  const parts: unknown[] = [];
  for (const p of attachments) {
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
          ...(options.system && { systemInstruction: { parts: [{ text: options.system }] } }),
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
        return check("Gemini", data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", schema);
      }
      const body = await res.text();
      lastError = `${model} answered ${res.status}: ${body.slice(0, 300)}`;
      if (/API key/i.test(body)) throw new Error(lastError); // a bad key fails on every model
      if (res.status !== 400) break; // 403, 404, 429, 5xx: try the next model
    }
  }
  throw new Error(lastError);
}

/** One of the backups. URL and model can be changed with e.g. GROQ_URL and BUTLER_GROQ_MODEL. */
async function askBackup<T>(
  provider: string,
  prompt: string,
  pictures: Picture[],
  schema: z.ZodType<T>,
  options: AskOptions,
): Promise<T> {
  const backup = BACKUPS[provider];
  const name = provider.toUpperCase();
  const url = Deno.env.get(`${name}_URL`) ?? backup.url;
  const model = Deno.env.get(`BUTLER_${name}_MODEL`) ?? backup.model;
  const content = [
    { type: "text", text: prompt },
    ...pictures.map((p) => ({ type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } })),
  ];
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get(backup.key)}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [options.system, "Answer with one JSON object only."].filter(Boolean).join("\n\n") },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });
  if (!res.ok) throw new Error(`${model} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return check(model, data.choices?.[0]?.message?.content ?? "", schema);
}
