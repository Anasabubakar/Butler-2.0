// Preferences that follow you to every device (Figma B2 · 16 Settings & preferences).
// Per-device switches (voice replies, microphone, wake listening) stay on each device.
import { TEASING, type Teasing } from "./command.ts";
import * as settings from "./settings.ts";

export interface Prefs {
  /** Occasional dry remarks between tasks. Off unless you turn it on. */
  teasing: Teasing;
  /** Silence non-essential cues and interruptions on every device. */
  quiet: boolean;
}

export const DEFAULTS: Prefs = { teasing: "off", quiet: false };

export async function load(): Promise<Prefs> {
  const teasing = await settings.get("pref_teasing");
  const quiet = await settings.get("pref_quiet");
  return {
    teasing: TEASING.includes(teasing as Teasing) ? teasing as Teasing : DEFAULTS.teasing,
    quiet: quiet === null ? DEFAULTS.quiet : quiet === "on",
  };
}

/** Applies only the fields that are valid; anything else is ignored. */
export async function save(input: Record<string, unknown>): Promise<Prefs> {
  if (typeof input.teasing === "string" && TEASING.includes(input.teasing as Teasing)) {
    await settings.set("pref_teasing", input.teasing);
  }
  if (typeof input.quiet === "boolean") await settings.set("pref_quiet", input.quiet ? "on" : "off");
  return load();
}
