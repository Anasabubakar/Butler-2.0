// Gemini, for anything that has to see a picture: finding a button on a
// screenshot, explaining or solving what's on screen, and organizing screenshots.
import { z } from "npm:zod@4.3.6";

const base = () => Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com/v1beta";

export const geminiReady = () => Boolean(Deno.env.get("GEMINI_API_KEY"));

/** The chosen model first, then fallbacks, since Google retires model names often. */
function models(): string[] {
  const chosen = Deno.env.get("BUTLER_GEMINI_MODEL");
  return [...new Set([chosen, "gemini-flash-latest", "gemini-2.5-flash"].filter((m): m is string => Boolean(m)))];
}

export interface Picture {
  data: string; // base64
  mediaType: string;
}

/** Asks Gemini about a picture and returns its JSON answer, checked against `schema`. */
export async function askGemini<T>(prompt: string, picture: Picture | null, schema: z.ZodType<T>): Promise<T> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const parts: unknown[] = [];
  if (picture) parts.push({ inline_data: { mime_type: picture.mediaType, data: picture.data } });
  parts.push({ text: prompt });

  let lastError = "no Gemini model answered";
  for (const model of models()) {
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
            ...(thinking && { thinkingConfig: { thinkingBudget: 0 } }),
          },
        }),
        signal: AbortSignal.timeout(45_000),
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
