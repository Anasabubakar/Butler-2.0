// Tries Butler's persona on a few sample asks and prints what it would say, so you can
// hear the voice before trusting it. Uses the same AI keys as the server.
//   deno run --allow-read --allow-net --allow-env server/try-persona.ts
// To hear one provider on its own: BUTLER_AI_ORDER=groq deno run ... server/try-persona.ts
// To hear it with teasing off: add "off" at the end.
import { plan } from "./lib/command.ts";
import { aiProviders } from "./lib/gemini.ts";
import { TEASING, type Teasing } from "./lib/persona.ts";

const SAMPLES = [
  "remind me to submit this tomorrow",
  "are you an AI?",
  "no but seriously, am I talking to a real person or an AI right now?",
  "should i add another feature to butler?",
  "i have 17 unfinished projects",
  "i want to quit everything",
  "what's 15% of 24,000?",
  "email tunde@example.com that I'll be 20 minutes late to the meeting",
  "whatsapp Mum that I've landed safely",
];

const teasing = (TEASING as readonly string[]).includes(Deno.args[0]) ? Deno.args[0] as Teasing : "on";
console.log(`providers: ${aiProviders().join(", ") || "none set"} · teasing: ${teasing}\n`);
const ctx = {
  device: "phone",
  timeZone: "Africa/Lagos",
  devices: [{ name: "Pixel", kind: "phone" }, { name: "ThinkPad", kind: "laptop" }],
  teasing,
};
for (const said of SAMPLES) {
  try {
    const p = await plan(said, ctx, null);
    const draft = p.action === "email" || p.action === "message" ? `\n   draft: ${p.text}` : "";
    console.log(`> ${said}\n   [${p.action}] ${p.reply}${draft}\n`);
  } catch (e) {
    console.log(`> ${said}\n   failed: ${(e as Error).message.slice(0, 200)}\n`);
  }
}
