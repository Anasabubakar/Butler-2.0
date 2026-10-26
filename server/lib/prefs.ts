// Preferences that follow you to every device (Figma B2 · 16 Settings & preferences).
// Per-device switches (voice replies, microphone, wake listening) stay on each device.
import { TEASING, type Teasing } from "./persona.ts";
import * as settings from "./settings.ts";

export interface Prefs {
  /** How much of the persona's sass and light roasting you get. On unless you turn it down. */
  teasing: Teasing;
  /** Silence non-essential cues and interruptions on every device. */
  quiet: boolean;
  /** Butler learns lasting facts about you from what you say (you can see and forget them). */
  memory: boolean;
}

export const DEFAULTS: Prefs = { teasing: "on", quiet: false, memory: true };

export async function load(): Promise<Prefs> {
  const teasing = await settings.get("pref_teasing");
  const quiet = await settings.get("pref_quiet");
  const memory = await settings.get("pref_memory");
  return {
    teasing: TEASING.includes(teasing as Teasing) ? teasing as Teasing : DEFAULTS.teasing,
    quiet: quiet === null ? DEFAULTS.quiet : quiet === "on",
    memory: memory === null ? DEFAULTS.memory : memory === "on",
  };
}

/** Applies only the fields that are valid; anything else is ignored. */
export async function save(input: Record<string, unknown>): Promise<Prefs> {
  if (typeof input.teasing === "string" && TEASING.includes(input.teasing as Teasing)) {
    await settings.set("pref_teasing", input.teasing);
  }
  if (typeof input.quiet === "boolean") await settings.set("pref_quiet", input.quiet ? "on" : "off");
  if (typeof input.memory === "boolean") await settings.set("pref_memory", input.memory ? "on" : "off");
  return load();
}
