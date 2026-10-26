// Switches kept in this browser only: theme, motion, voice and microphone.

export const local = {
  get(key: string, fallback: string): string {
    try { return localStorage.getItem(`butler.${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(`butler.${key}`, value); } catch { /* private window: it lasts this visit */ }
  },
};

/** Applies the theme now: light, dark, or whatever the system says. */
export function applyTheme(choice = local.get("theme", "system")) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());

export function applyMotion(choice = local.get("motion", "system")) {
  if (choice === "reduce") document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}
