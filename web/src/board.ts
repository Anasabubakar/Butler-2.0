// The sticky-note board: laying notes out, picking them up, sticking them down,
// and crumpling them into the bin. Everything here is about how it moves and feels.

export interface Spot { x: number; y: number; tilt: number } // x: share of board width, y: px

export interface BoardHooks {
  /** Whether notes can be moved right now (only on the full board, not in search results). */
  canDrag(): boolean;
  /** A note was stuck somewhere new. */
  onPlace(note: HTMLElement, spot: Spot): void;
  /** A note went in the bin. */
  onTrash(note: HTMLElement): void;
  /** A note was tapped without moving it; `tapped` is the part of it under your finger. */
  onOpen(note: HTMLElement, tapped: Element): void;
}

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GAP = 18;
let topZ = 10;

/** Same note, same little tilt and fastener, every time. */
export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function noteWidth(boardWidth: number): number {
  return boardWidth < 620 ? Math.floor((boardWidth - GAP) / 2) : 220;
}

/**
 * Puts every note on the board: stuck ones where you left them, the rest in
 * tidy columns (each into the shortest column). Sets the board's height to fit.
 */
export function layout(board: HTMLElement, notes: { el: HTMLElement; spot: Spot | null }[]) {
  const width = board.clientWidth;
  const w = noteWidth(width);
  board.style.setProperty("--note-w", `${w}px`);
  const cols = Math.max(1, Math.floor((width + GAP) / (w + GAP)));
  const left0 = (width - (cols * w + (cols - 1) * GAP)) / 2;
  const heights = new Array(cols).fill(8);
  let bottom = 0;
  for (const { el, spot } of notes) {
    const h = el.offsetHeight;
    let x: number, y: number, tilt: number;
    if (spot) {
      x = clamp(spot.x * width, 0, Math.max(0, width - w));
      y = spot.y;
      tilt = spot.tilt;
    } else {
      const c = heights.indexOf(Math.min(...heights));
      x = left0 + c * (w + GAP);
      y = heights[c];
      heights[c] += h + GAP + 10;
      tilt = ((hashOf(el.dataset.id ?? "") % 70) - 35) / 10; // -3.5° to 3.5°
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--tilt", `${tilt}deg`);
    bottom = Math.max(bottom, y + h);
  }
  board.style.height = `${Math.max(bottom, ...heights) + 80}px`;
}

/** Moves notes from where they were to where they are now, smoothly (after a re-layout). */
export function glide(notes: HTMLElement[], before: Map<HTMLElement, DOMRect>) {
  if (calm()) return;
  for (const el of notes) {
    const a = before.get(el);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate(
      [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
      { duration: 550 + Math.random() * 250, easing: "cubic-bezier(.2,.9,.3,1.2)" },
    );
  }
}

// --- fasteners: a pin or a strip of tape ------------------------------------------------

/** The tape tears in two and flies off, or the pin pops out and drops. */
export function unfasten(note: HTMLElement) {
  const tape = note.querySelector<HTMLElement>(".tape");
  const pin = note.querySelector<HTMLElement>(".pin");
  if (calm()) {
    if (tape) tape.style.opacity = "0";
    if (pin) pin.style.opacity = "0";
    return;
  }
  if (tape) {
    const [l, r] = tape.querySelectorAll<HTMLElement>("i");
    const fly = (el: HTMLElement, dir: number) => el.animate([
      { transform: "none", opacity: 1 },
      { transform: `translate(${dir * 6}px, -4px) rotate(${dir * 12}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dir * 46}px, -38px) rotate(${dir * 70}deg)`, opacity: 0 },
    ], { duration: 520, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" });
    fly(l, -1);
    fly(r, 1);
  }
  if (pin) {
    pin.animate([
      { transform: "none", opacity: 1 },
      { transform: "translateY(-16px) rotate(-25deg)", opacity: 1, offset: 0.3 },
      { transform: "translate(18px, 90px) rotate(160deg)", opacity: 0 },
    ], { duration: 620, easing: "cubic-bezier(.4,0,.7,1)", fill: "forwards" });
  }
}

/** A fresh pin pushes in, or a strip of tape slaps down, and the paper gives a little. */
export function fasten(note: HTMLElement) {
  const tape = note.querySelector<HTMLElement>(".tape");
  const pin = note.querySelector<HTMLElement>(".pin");
  const paper = note.querySelector<HTMLElement>(".paper");
  for (const el of [tape, pin, ...(tape ? tape.querySelectorAll<HTMLElement>("i") : [])]) {
    if (!el) continue;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.opacity = "";
  }
  if (calm()) return;
  if (pin) {
    pin.animate([
      { transform: "translateY(-70px) scale(1.9)", opacity: 0 },
      { transform: "translateY(-70px) scale(1.9)", opacity: 1, offset: 0.15 },
      { transform: "translateY(3px) scale(.92)", offset: 0.75 },
      { transform: "none" },
    ], { duration: 520, easing: "cubic-bezier(.5,0,.75,0)" });
  }
  if (tape) {
    tape.animate([
      { transform: "translateX(-50%) rotate(var(--tape-tilt)) scale(1.5, .4) translateY(-30px)", opacity: 0 },
      { transform: "translateX(-50%) rotate(var(--tape-tilt)) scale(1.12, 1.05)", opacity: 1, offset: 0.6 },
      { transform: "translateX(-50%) rotate(var(--tape-tilt))" },
    ], { duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" });
  }
  paper?.animate([
    { transform: "none" }, { transform: "scale(.965)", offset: 0.55 }, { transform: "scale(1.01)", offset: 0.8 }, { transform: "none" },
  ], { duration: 460, delay: 150, easing: "ease-out" });
}

// --- picking up, dragging, sticking -------------------------------------------------

/** Lets a note be picked up and moved: drag with a mouse, or press and hold with a finger. */
export function makeDraggable(note: HTMLElement, board: HTMLElement, bin: HTMLElement, hooks: BoardHooks) {
  let pressed: { x: number; y: number; id: number; touch: boolean } | null = null;
  let dragging = false;
  let hold = 0;
  let grab = { x: 0, y: 0 };
  let lastX = 0, tilt = 0;
  let moved = false;

  const overBin = (x: number, y: number) => {
    const r = bin.getBoundingClientRect();
    return x > r.left - 30 && x < r.right + 30 && y > r.top - 40 && y < r.bottom + 20;
  };

  const begin = (x: number, y: number) => {
    dragging = true;
    const r = note.getBoundingClientRect();
    grab = { x: x - r.left, y: y - r.top };
    lastX = x;
    tilt = 0;
    note.classList.add("lifted");
    document.body.classList.add("dragging-note");
    bin.classList.add("ready");
    note.style.zIndex = String(++topZ); // on top of the others
    unfasten(note);
    if (!calm()) {
      note.querySelector(".paper")?.animate([
        { transform: "rotate(0)" }, { transform: "rotate(-7deg)" }, { transform: "rotate(6deg)" },
        { transform: "rotate(-4deg)" }, { transform: "rotate(3deg)" }, { transform: "rotate(-1.5deg)" }, { transform: "rotate(0)" },
      ], { duration: 560, easing: "ease-out" });
    }
    navigator.vibrate?.(12);
  };

  const move = (x: number, y: number) => {
    const b = board.getBoundingClientRect();
    note.style.left = `${x - b.left - grab.x}px`;
    note.style.top = `${Math.max(0, y - b.top - grab.y)}px`;
    tilt = clamp(tilt * 0.7 + (x - lastX) * 0.9, -16, 16); // swings with how fast you move it
    lastX = x;
    note.style.setProperty("--drag-tilt", `${tilt}deg`);
    bin.classList.toggle("hot", overBin(x, y));
    // Near the top or bottom of the window: scroll, so notes can go anywhere on a long board.
    if (y < 70) scrollBy(0, -14);
    else if (y > innerHeight - 70) scrollBy(0, 14);
  };

  const finish = (x: number, y: number) => {
    dragging = false;
    note.classList.remove("lifted");
    note.style.removeProperty("--drag-tilt");
    document.body.classList.remove("dragging-note");
    const trash = overBin(x, y);
    bin.classList.remove("ready", "hot");
    if (trash) {
      crumpleIntoBin(note, bin).then(() => hooks.onTrash(note));
      return;
    }
    const restTilt = clamp(tilt * 0.25 + (Math.random() * 6 - 3), -6, 6);
    note.style.setProperty("--tilt", `${restTilt}deg`);
    const w = board.clientWidth;
    const left = clamp(parseFloat(note.style.left), 0, Math.max(0, w - note.offsetWidth));
    note.style.left = `${left}px`;
    fasten(note);
    hooks.onPlace(note, { x: w ? left / w : 0, y: parseFloat(note.style.top), tilt: restTilt });
    const bottom = parseFloat(note.style.top) + note.offsetHeight + 80;
    if (bottom > board.offsetHeight) board.style.height = `${bottom}px`;
  };

  note.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button, input, video")) return;
    pressed = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== "mouse" };
    moved = false;
    if (!hooks.canDrag()) return;
    if (pressed.touch) {
      hold = window.setTimeout(() => {
        if (!pressed) return;
        note.setPointerCapture(pressed.id);
        begin(pressed.x, pressed.y);
      }, 300);
    }
  });

  note.addEventListener("pointermove", (e) => {
    if (!pressed || e.pointerId !== pressed.id) return;
    const far = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6;
    if (far) moved = true;
    if (!dragging && pressed.touch && far) clearTimeout(hold); // you're scrolling, not picking it up
    if (!dragging && !pressed.touch && far && hooks.canDrag()) {
      note.setPointerCapture(e.pointerId);
      begin(pressed.x, pressed.y);
    }
    if (dragging) move(e.clientX, e.clientY);
  });

  // Once a finger has picked a note up, the page mustn't scroll under it.
  note.addEventListener("touchmove", (e) => { if (dragging) e.preventDefault(); }, { passive: false });

  const release = (e: PointerEvent, cancelled: boolean) => {
    if (!pressed || e.pointerId !== pressed.id) return;
    clearTimeout(hold);
    const wasTap = !dragging && !moved && !cancelled;
    if (dragging) finish(e.clientX, e.clientY);
    pressed = null;
    if (wasTap && !(e.target as Element).closest("button, input, video, a")) hooks.onOpen(note, e.target as Element);
  };
  note.addEventListener("pointerup", (e) => release(e, false));
  note.addEventListener("pointercancel", (e) => release(e, true));
  note.addEventListener("contextmenu", (e) => { if (dragging || pressed?.touch) e.preventDefault(); });
}

// --- the bin --------------------------------------------------------------------------

/** Scrunches the note into a ball, throws it in an arc into the bin, and the bin shakes. */
export async function crumpleIntoBin(note: HTMLElement, bin: HTMLElement): Promise<void> {
  if (calm()) {
    note.remove();
    return;
  }
  const paper = note.querySelector<HTMLElement>(".paper")!;
  note.classList.add("crumpling");
  unfasten(note);
  await paper.animate([
    { transform: "none", borderRadius: "2px" },
    { transform: "scale(.92) rotate(6deg) skew(5deg, -4deg)", borderRadius: "14% 30% 12% 26%", offset: 0.25 },
    { transform: "scale(.7) rotate(-14deg) skew(-9deg, 7deg)", borderRadius: "34% 22% 40% 28%", offset: 0.5 },
    { transform: "scale(.45) rotate(30deg) skew(6deg, -6deg)", borderRadius: "44% 38% 48% 36%", offset: 0.75 },
    { transform: "scale(.3) rotate(80deg)", borderRadius: "50%" },
  ], { duration: 520, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }).finished;

  // A little hop first, then an arc into the bin's mouth.
  const from = note.getBoundingClientRect();
  const to = bin.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height * 0.25 - (from.top + from.height / 2);
  bin.classList.add("open");
  await note.animate([
    { translate: "0 0", rotate: "0deg" },
    { translate: `${dx * 0.08}px -40px`, rotate: "60deg", offset: 0.18 },
    { translate: `${dx * 0.55}px ${Math.min(dy, 0) - 150}px`, rotate: "200deg", offset: 0.55 },
    { translate: `${dx}px ${dy}px`, rotate: "360deg", scale: "0.7" },
  ], { duration: 820, easing: "cubic-bezier(.35,.1,.6,1)", fill: "forwards" }).finished;
  note.remove();
  bin.classList.remove("open");
  bin.animate([
    { transform: "none" }, { transform: "rotate(-9deg) scale(1.06)" }, { transform: "rotate(8deg)" },
    { transform: "rotate(-6deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(-2deg)" }, { transform: "none" },
  ], { duration: 600, easing: "ease-out" });
  bin.querySelector(".lid")?.animate([
    { transform: "none" }, { transform: "translateY(-10px) rotate(-18deg)" }, { transform: "translateY(2px)" }, { transform: "none" },
  ], { duration: 500, easing: "ease-out" });
}

/** The bin's drawing: a can with a lid that lifts. */
export function binMarkup(): string {
  return `<svg viewBox="0 0 64 72" aria-hidden="true">
    <g class="lid"><rect x="6" y="8" width="52" height="8" rx="3"/><rect x="24" y="2" width="16" height="7" rx="3"/></g>
    <path class="can" d="M10 20h44l-4 46a5 5 0 0 1-5 4H19a5 5 0 0 1-5-4z"/>
    <path class="ribs" d="M24 28v32M32 28v32M40 28v32"/>
  </svg>`;
}
