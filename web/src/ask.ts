// Ask Butler on the website (Figma B2 · 11 AI chat & voice, B2 · 13 Tasks & confirmations).
// Chat and voice share one status language; speaker and microphone are separate switches;
// a laptop task shows its steps and a Stop button the whole time; email waits for your yes.
import { deviceTitle } from "./devices";
import { local } from "./local";
import { href, page } from "./shell";
import { api, busy, button, h, icon, inlineError, reducedMotion, SignedOut, status, type State, toast } from "./ui";

interface Device { name: string; kind: "phone" | "laptop"; last_seen: string }
interface Reply {
  action: string;
  say: string;
  heard?: string;
  open?: string;
  confirm?: string;
}
interface LaptopStatus { device: string; state: string; title: string; text: string; at: string }

const THIS_DEVICE = "this";
const WEB_DEVICE = "Website";

export async function renderAsk(app: HTMLElement) {
  const wanted = new URLSearchParams(location.hash.split("?")[1] ?? "").get("target") ?? THIS_DEVICE;
  const devices = await api<Device[]>("/api/devices").catch(() => [] as Device[]);
  const laptops = devices.filter((d) => d.kind === "laptop");

  const target = h("select", { class: "ask__target", "aria-label": "Where to run this" },
    h("option", { value: THIS_DEVICE }, "This device"),
    ...laptops.map((d) => h("option", { value: d.name }, `Run on ${deviceTitle(d, devices)}`)),
  );
  target.value = laptops.some((d) => d.name === wanted) ? wanted : THIS_DEVICE;

  const log = h("div", { class: "ask__log", "aria-live": "polite" },
    h("p", { class: "ask__hint" }, "Ask about something you saved, set a reminder, add an event, email someone or log a spend."),
  );
  const input = h("input", { class: "ask__input", type: "text", placeholder: "Tell Butler what to do…", "aria-label": "Tell Butler what to do", autocomplete: "off" });
  const send = button("Send", { kind: "quiet", type: "submit" });
  const micOn = local.get("mic", "off") === "on";
  const mic = micOn ? button("", { kind: "quiet", icon: "mic", label: "Speak instead", onclick: () => listen() }) : null;
  const form = h("form", { class: "ask__composer" }, input, mic, send);

  const listening = h("section", { class: "b2-card ask__listening", hidden: true, "aria-live": "assertive" });
  const switches = h("section", { class: "b2-card ask__switches" },
    h("h3", {}, "Two separate switches"),
    h("ul", {},
      h("li", {}, `Speaker: voice replies ${local.get("voice", "off") === "on" ? "on" : "off"}.`),
      h("li", {}, `Microphone: listening ${micOn ? "on when you press it" : "off"}.`),
      h("li", {}, "Wake listening: never on the website."),
      h("li", {}, "Butler always shows when it's recording."),
    ),
    h("a", { href: href("settings") }, "Change these in Settings"),
  );
  const task = h("div", { class: "ask__task" });

  app.replaceChildren(page("ask", "Say it. Let him handle it.",
    "Ask in plain words. Answers cite your saves, and anything that sends or runs elsewhere waits for your yes.",
    h("div", { class: "ask" },
      h("section", { class: "ask__chat b2-card b2-card--ink", "aria-label": "Ask Butler" },
        h("header", { class: "ask__head" },
          h("img", { src: "/brand/butler-app-icon.svg", alt: "", width: "48", height: "48" }),
          h("h2", {}, "Ask Butler"),
          target,
        ),
        log,
        task,
        form,
      ),
      h("div", { class: "ask__side" }, listening, switches),
    ),
  ));
  input.focus();

  const say = (text: string) => {
    if (local.get("voice", "off") !== "on" || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, "")));
  };
  const scroll = () => log.lastElementChild?.scrollIntoView({ block: "end", behavior: reducedMotion() ? "auto" : "smooth" });
  const mine = (text: string) => { log.querySelector(".ask__hint")?.remove(); log.append(h("p", { class: "ask__mine" }, text)); scroll(); };
  const pending = () => {
    const el = h("div", { class: "ask__reply ask__reply--working" }, status("working", "Working…"));
    log.append(el);
    scroll();
    return el;
  };

  async function run(text: string, audio?: Blob) {
    const where = target.value;
    if (text) mine(text);
    if (where !== THIS_DEVICE) return runOnLaptop(where, text);
    const wait = pending();
    const form = new FormData();
    form.set("device", WEB_DEVICE);
    form.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (text) form.set("text", text);
    if (audio) form.set("audio", new File([audio], "voice.webm", { type: audio.type.split(";")[0] }));
    try {
      const r = await api<Reply>("/api/command", { method: "POST", body: form });
      if (r.heard) wait.before(h("p", { class: "ask__mine" }, r.heard));
      wait.replaceWith(answer(r));
      if (r.action !== "confirm") say(r.say);
    } catch (e) {
      if (e instanceof SignedOut) return;
      wait.replaceWith(failed(`That didn't go through: ${(e as Error).message}.`, () => run(text, audio)));
    }
    scroll();
  }

  /** A reply card: the first line as its heading, the rest as text, links as actions. */
  function answer(r: Reply): HTMLElement {
    if (r.action === "confirm" && r.confirm) return confirmCard(r);
    const lines = r.say.split("\n");
    const links: string[] = [];
    const body = lines.slice(1).filter((l) => {
      const url = l.trim().match(/^(https?:\/\/\S+)$/)?.[1];
      if (url) links.push(url);
      return !url && l.trim();
    });
    const actions = h("div", { class: "ask__actions" },
      ...links.map((url) => h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "View source ", icon("external"))),
      r.open && !links.includes(r.open) ? h("a", { href: r.open, target: "_blank", rel: "noopener noreferrer" }, r.action === "calendar" ? "Open the event " : "Open save ", icon("external")) : null,
      r.action === "save" ? h("a", { href: href("library") }, "Open your library") : null,
    );
    const elsewhere = ["send", "screen", "message"].includes(r.action)
      ? h("p", { class: "ask__note" }, "This one needs your phone or laptop: the website can't reach their clipboard, screen or apps. Ask there, or choose Run on My laptop above.")
      : null;
    return h("article", { class: "ask__reply" },
      h("h3", {}, lines[0]),
      ...body.map((l) => h("p", {}, l)),
      elsewhere,
      actions.childElementCount ? actions : null,
    );
  }

  /** "Ready to send": recipient, message and attachment together, confirmed before it leaves. */
  function confirmCard(r: Reply): HTMLElement {
    const [, ...rest] = r.say.split("\n");
    const to = rest.find((l) => l.startsWith("To: ")) ?? "";
    const subject = rest.find((l) => l.startsWith("Subject: ")) ?? "";
    const attachment = rest.find((l) => l.startsWith("Attachment: "));
    const message = rest.filter((l) => l !== to && l !== subject && l !== attachment).join("\n").trim();
    const el = h("article", { class: "ask__reply ask__confirm" },
      h("h3", {}, "Ready to send"),
      h("p", { class: "ask__confirm-to" }, to),
      subject ? h("p", {}, subject) : null,
      h("blockquote", {}, message),
      attachment ? h("p", {}, attachment) : null,
      h("p", { class: "ask__note" }, "Check the recipient and attachment first. Nothing is sent until you press Send."),
    );
    const sendNow = button("Send", {
      kind: "primary",
      onclick: async () => {
        const form = new FormData();
        form.set("confirm", r.confirm!);
        try {
          const done = await busy(sendNow, () => api<{ say: string }>("/api/command/confirm", { method: "POST", body: form }));
          el.replaceWith(h("article", { class: "ask__reply" }, status("complete", "Sent"), h("p", {}, done.say)));
        } catch (e) {
          if (!(e instanceof SignedOut)) el.append(inlineError(`It didn't send: ${(e as Error).message}. Ask again to write it fresh.`));
        }
      },
    });
    const edit = button("Edit message", {
      kind: "secondary",
      onclick: () => { el.replaceWith(h("article", { class: "ask__reply" }, status("stopped", "Not sent"))); input.value = message; input.focus(); },
    });
    el.append(h("div", { class: "ask__buttons" }, sendNow, edit));
    return el;
  }

  function failed(message: string, retry: () => void): HTMLElement {
    const el = h("article", { class: "ask__reply ask__reply--failed" }, status("failed"), h("p", {}, message));
    el.append(h("div", { class: "ask__buttons" }, button("Retry", { kind: "secondary", onclick: () => { el.remove(); retry(); } })));
    return el;
  }

  // --- a task on the laptop: steps, honest states, and Stop always visible (B2 · 13) ----------

  async function runOnLaptop(device: string, text: string) {
    const label = deviceTitle(laptops.find((d) => d.name === device)!, devices);
    const form = new FormData();
    form.set("device", WEB_DEVICE);
    form.set("target", device);
    form.set("text", text);
    const startedAt = Date.now();
    try {
      await api("/api/laptop/task", { method: "POST", body: form });
    } catch (e) {
      if (!(e instanceof SignedOut)) log.append(failed(`${label} didn't get it: ${(e as Error).message}.`, () => runOnLaptop(device, text)));
      return;
    }
    showTask(device, label, text, startedAt);
  }

  function showTask(device: string, label: string, text: string, since: number) {
    const STEPS = ["Request received", "Working on it", "Waiting for your review", "Complete"];
    const steps = h("ol", { class: "task__steps" }, ...STEPS.map((s, i) => h("li", {}, h("span", {}, String(i + 1).padStart(2, "0")), s)));
    const bar = h("div", { class: "task__bar", role: "progressbar", "aria-label": "Steps done", "aria-valuemin": "0", "aria-valuemax": "4" }, h("span"));
    const state = h("div", { class: "task__state" }, status("queued"));
    const said = h("p", { class: "task__said" }, `Queued for ${label}. If it's offline, it waits until it reconnects.`);
    const stop = button("Stop task", {
      kind: "danger", icon: "stop",
      onclick: async () => {
        const f = new FormData();
        f.set("device", WEB_DEVICE);
        f.set("target", device);
        try {
          await busy(stop, () => api("/api/laptop/stop", { method: "POST", body: f }));
          said.textContent = "Asked it to stop. Waiting for it to confirm.";
        } catch (e) {
          if (!(e instanceof SignedOut)) toast(`Couldn't send Stop: ${(e as Error).message}`);
        }
      },
    });
    const box = h("section", { class: "task" },
      h("h3", {}, `Working on ${label}`), h("p", { class: "task__what" }, text), bar, steps, state, said, stop);
    task.replaceChildren(box);

    const show = (step: number, s: State, label2?: string) => {
      bar.style.setProperty("--done", String(step / 4));
      bar.setAttribute("aria-valuenow", String(step));
      [...steps.children].forEach((li, i) => li.classList.toggle("done", i < step));
      state.replaceChildren(status(s, label2));
    };
    show(1, "queued");
    const MAP: Record<string, [number, State, string?]> = {
      started: [1, "working"], working: [2, "working"], done: [4, "complete"], failed: [2, "failed"],
      refused: [1, "stopped", "Didn't run"], stopped: [2, "stopped"], locked: [1, "stopped", "Remote control is locked"],
    };
    const poll = async () => {
      if (!box.isConnected) return;
      const all = await api<LaptopStatus[]>("/api/laptop/status").catch(() => []);
      const s = all.find((x) => x.device === device && new Date(x.at).getTime() >= since - 1000);
      if (s && MAP[s.state]) {
        const [step, st, text2] = MAP[s.state];
        show(step, st, text2);
        if (s.text) said.textContent = s.text;
        if (["done", "failed", "refused", "stopped", "locked"].includes(s.state)) { stop.remove(); return; }
      }
      setTimeout(poll, 3000);
    };
    poll();
  }

  // --- voice: record a short clip and send it; Stop and Type instead are always there -------

  let recorder: MediaRecorder | null = null;
  let endListening: (send: boolean) => void = () => {};
  async function listen() {
    if (recorder) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Microphone access was blocked. Allow it for this site, or type instead.");
      return;
    }
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    let cancelled = false;
    const bars = h("div", { class: "listening__bars", "aria-hidden": "true" }, ...Array.from({ length: 9 }, () => h("span")));
    const end = (send: boolean) => { cancelled = !send; recorder?.stop(); };
    endListening = end;
    listening.hidden = false;
    listening.replaceChildren(
      h("h2", {}, "Listening…"), bars,
      h("p", { class: "listening__state" }, icon("mic"), " Microphone on"),
      h("div", { class: "ask__buttons" },
        button("Stop", { kind: "danger", onclick: () => end(true) }),
        button("Type instead", { kind: "secondary", onclick: () => { end(false); input.focus(); } })),
    );
    // Bars follow your voice, unless motion is reduced.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!recorder || reducedMotion()) return;
      analyser.getByteFrequencyData(data);
      [...bars.children].forEach((b, i) => (b as HTMLElement).style.setProperty("--level", String(0.15 + (data[i * 4 + 2] / 255) * 0.85)));
      requestAnimationFrame(draw);
    };
    draw();
    const limit = setTimeout(() => end(true), 30_000);
    recorder.onstop = () => {
      clearTimeout(limit);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      recorder = null;
      listening.hidden = true;
      if (!cancelled && chunks.length) run("", new Blob(chunks, { type: chunks[0].type || "audio/webm" }));
    };
    recorder.start();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    run(text);
  });
  // Escape stops listening without sending (B2 · 17: Escape tucks things away).
  addEventListener("keydown", (e) => { if (e.key === "Escape" && recorder) endListening(false); });
}
