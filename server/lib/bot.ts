// Butler in Telegram. Only its owner can use it: everyone else gets silence. It talks the way
// Ask Butler does (the same planner, memory and voice), saves what you send it to the library,
// and is where Butler's reminders, notes and laptop updates reach you when Telegram is open.
// Everything it needs from the rest of Butler comes in through `Butler`, so it's tested alone.
import type { Item } from "./db.ts";
import * as tg from "./telegram.ts";

// --- what Telegram sends (only the parts Butler reads) -------------------------------------------

export interface User { id: number; is_bot?: boolean; first_name?: string; username?: string }
export interface Chat { id: number; type: string; title?: string }
export interface FileRef { file_id: string; file_size?: number; file_name?: string; mime_type?: string }
export interface Photo extends FileRef { width: number; height: number }

export interface Message {
  message_id: number;
  message_thread_id?: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  caption?: string;
  photo?: Photo[];
  document?: FileRef;
  video?: FileRef;
  audio?: FileRef;
  animation?: FileRef;
  video_note?: FileRef;
  voice?: FileRef & { duration?: number };
  sticker?: { emoji?: string };
  location?: unknown;
  contact?: unknown;
  forward_origin?: { type: string; sender_user?: User; sender_user_name?: string; chat?: Chat };
  reply_to_message?: Message;
}

export interface CallbackQuery { id: string; from: User; message?: Message; data?: string }
export interface InlineQuery { id: string; from: User; query: string }
export interface MemberUpdate { chat: Chat; from: User; new_chat_member: { status: string } }

export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
  inline_query?: InlineQuery;
  my_chat_member?: MemberUpdate;
}

/** What the bot asks Telegram to send it. Business and channel updates (Secretary mode) never arrive. */
export const ALLOWED_UPDATES = ["message", "callback_query", "inline_query", "my_chat_member"];

// --- what the bot needs from Butler ----------------------------------------------------------

/** What Ask Butler answered (the body of POST /api/command). */
export interface Reply {
  action?: string;
  say?: string;
  heard?: string;
  confirm?: string;
  open?: string;
  goal?: string;
  error?: string;
  send?: { target: string; content: string; text: string | null };
  message?: { app: string; person: string; name: string; phone: string | null; text: string };
}

export interface Answer { status: number; reply: Reply }

/** Something Butler pushed to every device (an inbox message). */
export interface Pushed {
  kind: string;
  from_device: string;
  body: string | null;
  url: string | null;
  item_id: string | null;
  forget?: boolean;
  expires_at?: string | null;
}

export interface Butler {
  /** Ask Butler, the way the pet and website do. */
  ask(input: { text?: string; audio?: File; picture?: File; replyTo?: string }): Promise<Answer>;
  /** Your yes (or no) to an email or a tool that changes things. */
  confirm(id: string, yes: boolean): Promise<Answer>;
  /** Saves to the library, the way sharing from the phone does. */
  save(input: { text?: string; url?: string; note?: string; file?: File }): Promise<{ status: number; id?: string; error?: string }>;
  item(id: string): Promise<Item | undefined>;
  remove(id: string): Promise<boolean>;
  /** Where a save opens: its link, or its file on the website. */
  link(item: Item): string | null;
  /** A saved file, to send back to you. Null if it's gone; "too big" over what a bot may send. */
  file(item: Item): Promise<File | null | "too big">;
  /** Sends a save, or text, to your laptop or phone. Answers the devices it went to. */
  sendItem(target: string, item: Item): Promise<string[]>;
  sendText(target: string, text: string): Promise<string[]>;
  /** A laptop command (your secret word in it), the way the phone sends one. */
  laptop(command: string): Promise<{ sent: string[]; warning: string | null } | { error: string }>;
  stopLaptop(off: boolean): Promise<string[]>;
  /** A reminder for Telegram only, at `at` (a snooze). */
  remindHere(text: string, at: Date): Promise<void>;
  brief(): Promise<string>;
  mail(): Promise<string>;
  tasks(): Promise<string>;
  recap(): Promise<string>;
  spending(): Promise<string>;
  find(query: string): Promise<Item[]>;
  recent(): Promise<Item[]>;
  ring(target: string): Promise<string>;
  devices(): Promise<{ name: string; kind: string; last_seen: string }[]>;
  newChat(): Promise<void>;
  /** The one Telegram user Butler answers, or null before you connect it from the website. */
  owner(): Promise<number | null>;
  /** Uses a code from the website's Connect Telegram button. True if it was good. */
  pair(code: string, user: number): Promise<boolean>;
  /** Whether Butler's notes and reminders come here too; `on` changes it. */
  alerts(on?: boolean): Promise<boolean>;
  timeZone(): Promise<string>;
}

export interface Options {
  /** The bot's username, without @. */
  username: string;
  /** The library's address (opens as a Mini App), or null without PUBLIC_URL. */
  library: string | null;
  privacy: string | null;
  /** How long before a slow answer gets an "on it" message. */
  slowMs?: number;
  /** How often a save is checked while it's being sorted, and for how long. */
  followMs?: number;
  followFor?: number;
}

type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
type Keyboard = Button[][];
interface Where { chat_id: number; message_thread_id?: number }

/** Butler's own notes come from these senders; anything else came from one of your devices. */
const FROM_BUTLER = /^Butler\b/;
const VOICE_MAX = 4 * 1024 * 1024;
const PICTURE_MAX = 4 * 1024 * 1024;
export const UPLOAD_MAX = 50 * 1024 * 1024; // what a bot may send

export const COMMANDS = [
  { command: "brief", description: "Your day: calendar, tasks, reminders" },
  { command: "find", description: "Search your library, like /find jollof" },
  { command: "tasks", description: "Your to-dos" },
  { command: "inbox", description: "Email that needs you" },
  { command: "remind", description: "Like /remind call Mum at 6pm" },
  { command: "recap", description: "What you saved this week" },
  { command: "spent", description: "What you spent this week" },
  { command: "laptop", description: "Run something on your laptop (secret word needed)" },
  { command: "stop", description: "Stop what your laptop is doing" },
  { command: "ring", description: "Ring your phone so you can find it" },
  { command: "devices", description: "Your devices and when each was last online" },
  { command: "library", description: "Open your library" },
  { command: "new", description: "Start a fresh conversation" },
  { command: "alerts", description: "Turn reminders and notes here on or off" },
  { command: "help", description: "What I can do" },
];

export class Bot {
  private stash = new Map<string, { value: string; at: number }>();
  private seen: number[] = [];

  constructor(private api: tg.Api, private butler: Butler, private opts: Options) {}

  /** Handles one update. Never throws: what went wrong is logged, and said where it can be. */
  async handle(u: Update): Promise<void> {
    if (this.seen.includes(u.update_id)) return; // Telegram sent it again
    this.seen.push(u.update_id);
    if (this.seen.length > 500) this.seen.shift();
    try {
      if (u.message) await this.onMessage(u.message);
      else if (u.callback_query) await this.onButton(u.callback_query);
      else if (u.inline_query) await this.onInline(u.inline_query);
      else if (u.my_chat_member) await this.onMembership(u.my_chat_member);
    } catch (e) {
      console.error("telegram:", String((e as Error).message ?? e).slice(0, 300));
    }
  }

  /** The command menu, the bot's description and the Library button, set once at start. */
  async setup() {
    const steps: [string, Record<string, unknown>][] = [
      ["setMyCommands", { commands: COMMANDS, scope: { type: "all_private_chats" } }],
      ["setMyShortDescription", { short_description: "A private Butler. It only answers the person who runs it." }],
      ["setMyDescription", {
        description: "Butler is a personal assistant that lives on its owner's phone and laptop. " +
          "This bot is private: it only answers its owner and stays silent for everyone else." +
          (this.opts.privacy ? `\n\nPrivacy: ${this.opts.privacy}` : ""),
      }],
    ];
    if (this.opts.library) {
      steps.push(["setChatMenuButton", { menu_button: { type: "web_app", text: "Butler Library", web_app: { url: this.opts.library } } }]);
    }
    for (const [method, params] of steps) {
      await this.api.call(method, params).catch((e) => console.warn("telegram setup:", (e as Error).message));
    }
  }

  // --- messages ----------------------------------------------------------------------------

  private async onMessage(m: Message) {
    const from = m.from;
    if (!from || from.is_bot || m.chat.type !== "private") return; // groups: see onMembership
    const owner = await this.butler.owner();
    const cmd = tg.commandOf(m.text, this.opts.username);
    // Connecting: the website's button opens t.me/bot?start=<code>.
    if (cmd?.name === "start" && /^[0-9a-f]{32}$/.test(cmd.args)) {
      if (await this.butler.pair(cmd.args, from.id)) return this.welcome(where(m), true);
      if (owner !== from.id) return; // a used or made-up code: silence, like anyone else
    }
    if (owner === null || from.id !== owner) return; // not the owner: no answer at all

    if (cmd) return this.command(m, cmd.name, cmd.args);
    if (m.forward_origin) return this.saveForwarded(m);
    if (m.voice) return this.askVoice(m);
    if (m.photo?.length) return m.caption?.trim() ? this.askPhoto(m) : this.saveMedia(m);
    if (m.document || m.video || m.audio || m.animation || m.video_note) return this.saveMedia(m);
    if (m.text?.trim()) {
      const link = tg.onlyLink(m.text);
      return link ? this.saveLink(m, link) : this.askText(where(m), m.text, m);
    }
    if (m.sticker) return void await this.send(where(m), m.sticker.emoji ?? "👀");
    await this.send(where(m), "I can't use that kind of message yet. Send me text, a voice note, a photo, a link or a file.");
  }

  private async command(m: Message, name: string, args: string) {
    const here = where(m);
    switch (name) {
      case "start":
      case "help":
        return this.welcome(here, false);
      case "brief":
      case "today":
        return this.run(here, () => this.butler.brief());
      case "inbox":
      case "mail":
      case "email":
        return this.run(here, () => this.butler.mail());
      case "tasks":
      case "todo":
        return this.run(here, () => this.butler.tasks());
      case "recap":
      case "week":
        return this.run(here, () => this.butler.recap());
      case "spent":
      case "spending":
        return this.run(here, () => this.butler.spending());
      case "find":
      case "search":
        return args ? this.find(here, args) : void await this.send(here, "What should I look for? Like <code>/find jollof recipe</code>.\n\nOr just ask: “what did I save about visas?”");
      case "remind":
        return args
          ? this.askText(here, `remind me ${args}`, m)
          : void await this.send(here, "What and when? Like <code>/remind call Mum at 6pm</code> or <code>/remind me to stretch in 20 minutes</code>.");
      case "laptop":
      case "pc":
        return this.laptop(m, args);
      case "stop":
        return this.stopLaptop(here, false);
      case "ring":
        return this.run(here, () => this.butler.ring(args || "phone"));
      case "devices":
        return this.devices(here);
      case "library":
        return this.openLibrary(here);
      case "new":
      case "reset":
        await this.butler.newChat();
        return void await this.send(here, "Fresh start. I still remember what I know about you; the old conversation just won't steer this one.");
      case "alerts":
        return this.alerts(here, args);
      case "privacy":
        return void await this.send(here, this.opts.privacy ? `Privacy policy: ${tg.escape(this.opts.privacy)}` : "No privacy policy page is set up on this server.");
      case "cancel":
        return void await this.send(here, "Nothing to cancel. Buttons on a message cancel that one.");
      default:
        return void await this.send(here, `I don't know /${tg.escape(name)}. Tap / to see what I can do, or just say it in words.`);
    }
  }

  private async welcome(here: Where, paired: boolean) {
    const name = this.opts.username ? `@${this.opts.username}` : "me";
    const text = [
      paired ? "✅ <b>Connected.</b> This bot is yours now, and it stays silent for everyone else.\n" : "",
      "<b>Hey, I'm Butler.</b> Same Butler as on your phone and laptop, now in Telegram.\n",
      "Talk to me like a person: “remind me to call Mum at 6”, “what's my day?”, “email Ada that I'm running late”.\n",
      "📥 Send a link, photo or file and I'll save it to your library.",
      "🎙 Send a voice note and I'll do what you say.",
      "🖼 Send a photo with a question in the caption and I'll look at it.",
      "🔎 /find searches your library. Type " + tg.escape(name) + " in any chat to share something you saved.",
      "💻 /laptop with your secret word runs something on your laptop.",
      "\nYour reminders, morning brief and Butler's notes come here too. /alerts turns that off.",
    ].join("\n").trim();
    const keyboard: Keyboard = [[{ text: "☀️ My day", callback_data: "cmd:brief" }, { text: "✅ Tasks", callback_data: "cmd:tasks" }]];
    if (this.opts.library) keyboard.unshift([{ text: "📚 Open my library", web_app: { url: this.opts.library } }]);
    await this.send(here, text, keyboard);
  }

  /** Runs something that answers in text, with "typing…" while it works. */
  private async run(here: Where, work: () => Promise<string>) {
    const busy = this.working(here);
    let text: string;
    try {
      text = tg.escape(sentence(await work()));
    } catch (e) {
      text = `That didn't work: ${tg.escape(short(e))}`;
    }
    await this.say(here, text, undefined, await busy.stop());
  }

  // --- talking to Butler -----------------------------------------------------------------------

  private async askText(here: Where, text: string, m?: Message) {
    const busy = this.working(here);
    const replied = m?.reply_to_message;
    const replyTo = replied?.from?.is_bot ? replied.text ?? replied.caption : undefined;
    const answer = await this.butler.ask({ text: text.slice(0, 2000), replyTo }).catch((e) => failure(e));
    await this.answer(here, answer, await busy.stop(), { retry: text, link: tg.firstLink(text) });
  }

  private async askVoice(m: Message) {
    const here = where(m);
    const voice = m.voice!;
    if ((voice.file_size ?? 0) > VOICE_MAX) {
      return void await this.send(here, "That voice note is too long for me (over about 4 minutes). Try a shorter one, or type it.");
    }
    const busy = this.working(here);
    let answer: Answer;
    try {
      const { bytes } = await this.api.download(voice.file_id);
      const audio = new File([bytes as BlobPart], "voice.ogg", { type: (voice.mime_type ?? "audio/ogg").split(";")[0] });
      answer = await this.butler.ask({ audio });
    } catch (e) {
      answer = failure(e);
    }
    await this.answer(here, answer, await busy.stop(), {});
  }

  private async askPhoto(m: Message) {
    const here = where(m);
    const photo = biggest(m.photo!, PICTURE_MAX);
    if (!photo) return this.saveMedia(m); // too big to look at, so keep it
    const busy = this.working(here);
    let answer: Answer;
    try {
      const { bytes } = await this.api.download(photo.file_id);
      const picture = new File([bytes as BlobPart], "photo.jpg", { type: "image/jpeg" });
      answer = await this.butler.ask({ text: m.caption!.slice(0, 2000), picture });
    } catch (e) {
      answer = failure(e);
    }
    await this.answer(here, answer, await busy.stop(), { photo: biggest(m.photo!, tg.MAX_DOWNLOAD_BYTES)?.file_id, retry: undefined });
  }

  /** Shows what Butler answered, with the buttons that go with it. */
  private async answer(here: Where, a: Answer, placeholder: number | null, ctx: { retry?: string; link?: string | null; photo?: string }) {
    const r = a.reply;
    if (a.status >= 400 || r.error) {
      const keyboard: Keyboard = ctx.retry ? [[{ text: "🔁 Try again", callback_data: `re:${this.keep(ctx.retry)}` }]] : [];
      return void await this.say(here, problem(a.status, r.error), keyboard, placeholder);
    }
    const lines: string[] = [];
    if (r.heard) lines.push(`🎙 <i>“${tg.escape(r.heard)}”</i>\n`);
    lines.push(tg.escape(r.say?.trim() || "done."));
    const keyboard: Keyboard = [];
    switch (r.action) {
      case "confirm":
        if (r.confirm) {
          keyboard.push([
            { text: /^ready to send/i.test(r.say ?? "") ? "✅ Send it" : "✅ Yes, do it", callback_data: `ok:${r.confirm}` },
            { text: "✖️ Cancel", callback_data: `no:${r.confirm}` },
          ]);
        }
        break;
      case "send":
        lines.push(await this.sendOn(r.send, ctx.link ?? null));
        break;
      case "screen":
        lines.push("\nThat one needs a screen in front of it. Use <code>/laptop</code> with your secret word and I'll have your laptop do it.");
        break;
      case "message": {
        const url = chatLink(r.message);
        if (url) keyboard.push([{ text: r.message?.app === "telegram" ? "💬 Open in Telegram" : "💬 Open WhatsApp", url }]);
        break;
      }
    }
    if (r.open && /^https?:\/\//.test(r.open)) {
      keyboard.push([{ text: r.open.includes("calendar.google.com") ? "📅 Open in Google Calendar" : "↗️ Open", url: r.open }]);
    }
    if (ctx.link && r.action !== "save" && r.action !== "send") keyboard.push([{ text: "📥 Save the link", callback_data: `svl:${this.keep(ctx.link)}` }]);
    if (ctx.photo) keyboard.push([{ text: "📥 Save this photo", callback_data: `svp:${this.keep(ctx.photo)}` }]);
    await this.say(here, lines.join("\n"), keyboard, placeholder);
  }

  /** Does Ask Butler's "send it to my laptop", for what can be sent from here. */
  private async sendOn(send: Reply["send"], link: string | null): Promise<string> {
    if (!send) return "";
    const target = send.target || "laptop";
    let words: string | null = null;
    if (send.content === "text") words = send.text;
    else if (send.content === "link") words = link;
    if (!words?.trim()) {
      return "\nFrom here I can send text, links and files. Send me the thing first, then tap the button under it.";
    }
    const to = await this.butler.sendText(target, words).catch(() => [] as string[]);
    return to.length ? `\n✓ Sent to ${tg.escape(to.join(", "))}.` : `\nNo ${tg.escape(target)} has checked in with Butler yet, so I couldn't send it.`;
  }

  // --- saving ------------------------------------------------------------------------------

  private async saveLink(m: Message, url: string) {
    const here = where(m);
    const r = await this.butler.save({ url }).catch((e) => ({ status: 500, error: short(e) }));
    await this.saved(here, r, m.message_id);
  }

  private async saveForwarded(m: Message) {
    const o = m.forward_origin!;
    const who = o.sender_user ? [o.sender_user.first_name, o.sender_user.username && `@${o.sender_user.username}`].filter(Boolean).join(" ")
      : o.sender_user_name ?? o.chat?.title ?? null;
    const note = who ? `Forwarded from ${who}` : "Forwarded in Telegram";
    if (m.photo?.length || m.document || m.video || m.audio || m.animation || m.video_note || m.voice) return this.saveMedia(m, note);
    const text = (m.text ?? m.caption ?? "").trim();
    if (!text) return void await this.send(where(m), "There's nothing in that message I can save.");
    const url = tg.onlyLink(text);
    const r = await this.butler.save(url ? { url, note } : { text, note }).catch((e) => ({ status: 500, error: short(e) }));
    await this.saved(where(m), r, m.message_id);
  }

  private async saveMedia(m: Message, note?: string) {
    const here = where(m);
    const photo = m.photo?.length ? biggest(m.photo, tg.MAX_DOWNLOAD_BYTES) : null;
    const f: FileRef | undefined = m.document ?? m.video ?? m.audio ?? m.animation ?? m.video_note ?? m.voice ?? photo ?? undefined;
    if (!f) return void await this.send(here, "Telegram didn't give me that file. Try sending it again.");
    if ((f.file_size ?? 0) > tg.MAX_DOWNLOAD_BYTES) {
      return void await this.send(here, "Telegram only lets bots download files up to 20 MB, so I can't save this one. Share it to Butler from your phone instead.");
    }
    const busy = this.working(here, "upload_document");
    let r: { status: number; id?: string; error?: string };
    try {
      const { bytes, path } = await this.api.download(f.file_id);
      const name = f.file_name ?? path.split("/").pop() ?? "file";
      const type = f.mime_type ?? (photo ? "image/jpeg" : m.voice ? "audio/ogg" : "application/octet-stream");
      const caption = m.caption?.trim();
      r = await this.butler.save({ file: new File([bytes as BlobPart], name, { type }), note: [note, caption].filter(Boolean).join("\n") || undefined });
    } catch (e) {
      r = { status: 500, error: short(e) };
    }
    await busy.stop();
    await this.saved(here, r, m.message_id);
  }

  /** "Saved", then the save's title and collection once Butler has sorted it. */
  private async saved(here: Where, r: { status: number; id?: string; error?: string }, replyTo?: number) {
    if (!r.id) {
      return void await this.send(here, `Couldn't save that: ${tg.escape(r.error ?? `the server answered ${r.status}`)}.`);
    }
    const id = r.id;
    const sent = await this.send(here, "📥 Saved. Sorting it…", [[{ text: "🗑 Delete", callback_data: `del:${id}` }]], replyTo);
    if (sent) this.follow(here.chat_id, sent, id);
  }

  /** Checks on a save until it's sorted, then shows it. Runs in the background. */
  private follow(chat: number, message: number, id: string) {
    const every = this.opts.followMs ?? 2500;
    const until = Date.now() + (this.opts.followFor ?? 90_000);
    const check = async () => {
      const item = await this.butler.item(id).catch(() => undefined);
      if (!item) return;
      if (item.status === "pending" && Date.now() < until) return void setTimeout(check, every);
      await this.api.call("editMessageText", { chat_id: chat, message_id: message, ...this.card(item) })
        .catch((e) => notModified(e) || console.warn("telegram save card:", (e as Error).message));
    };
    setTimeout(check, every);
  }

  /** A save as a message: what it is, where it went, and what you can do with it. */
  private card(item: Item) {
    const title = item.title ?? item.url ?? item.body?.slice(0, 80) ?? "Your save";
    const where = [item.category, ...item.tags.slice(0, 4).map((t) => `#${t.replace(/\s+/g, "_")}`)].filter(Boolean).join(" · ");
    const lines = [`📥 <b>${tg.escape(title)}</b>`];
    if (where) lines.push(`<i>${tg.escape(where)}</i>`);
    if (item.summary) lines.push(tg.escape(item.summary.slice(0, 400)));
    if (item.status === "failed") lines.push("\nSaved, but I couldn't sort it. It's in your library under Unsorted.");
    if (item.status === "pending") lines.push("\nSaved. Still sorting it; it'll show up sorted in your library.");
    const keyboard: Keyboard = [];
    const link = this.butler.link(item);
    if (link) keyboard.push([{ text: "↗️ Open", url: link }]);
    keyboard.push([{ text: "💻 To laptop", callback_data: `snl:${item.id}` }, { text: "📱 To phone", callback_data: `snp:${item.id}` }]);
    keyboard.push([{ text: "🗑 Delete", callback_data: `del:${item.id}` }]);
    return { text: lines.join("\n"), parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard }, link_preview_options: { is_disabled: true } };
  }

  // --- the library -------------------------------------------------------------------------

  private async find(here: Where, query: string) {
    const busy = this.working(here);
    let text: string;
    try {
      const found = await this.butler.find(query.slice(0, 200));
      text = found.length
        ? [`🔎 <b>${tg.escape(query)}</b>`, ...found.map((item, i) => {
          const title = tg.escape(item.title ?? item.url ?? item.body?.slice(0, 60) ?? "untitled");
          const link = this.butler.link(item);
          const name = link ? `<a href="${tg.escape(link)}">${title}</a>` : title;
          return `${i + 1}. ${name}${item.category ? ` · <i>${tg.escape(item.category)}</i>` : ""}`;
        })].join("\n")
        : `Nothing in your library matches “${tg.escape(query)}”. Try other words, or ask me in a sentence.`;
    } catch (e) {
      text = `Searching didn't work: ${tg.escape(short(e))}`;
    }
    await this.say(here, text, undefined, await busy.stop());
  }

  private async openLibrary(here: Where) {
    if (!this.opts.library) return void await this.send(here, "The server has no PUBLIC_URL set, so I don't know where your library is.");
    await this.send(here, "Your library:", [[{ text: "📚 Open my library", web_app: { url: this.opts.library } }]]);
  }

  /** "@Butler jollof" in any chat: your saves, to share. Strangers get nothing. */
  private async onInline(q: InlineQuery) {
    if (q.from.id !== await this.butler.owner()) {
      return void await this.api.call("answerInlineQuery", { inline_query_id: q.id, results: [], cache_time: 300, is_personal: true });
    }
    const items = await (q.query.trim() ? this.butler.find(q.query.trim().slice(0, 200)) : this.butler.recent()).catch(() => [] as Item[]);
    const results = items.slice(0, 20).map((item) => {
      const title = item.title ?? item.url ?? item.body?.slice(0, 60) ?? "untitled";
      const link = this.butler.link(item);
      const body = item.body && !item.title ? item.body.slice(0, 3000) : null;
      return {
        type: "article",
        id: item.id.replace(/-/g, ""),
        title: title.slice(0, 200),
        description: [item.category, item.summary].filter(Boolean).join(" · ").slice(0, 200) || undefined,
        thumbnail_url: item.thumbnail?.startsWith("https://") ? item.thumbnail : undefined,
        input_message_content: {
          message_text: body ? tg.escape(body) : `<b>${tg.escape(title)}</b>${link ? `\n${tg.escape(link)}` : ""}`,
          parse_mode: "HTML",
        },
        ...(link ? { url: link, hide_url: true } : {}),
      };
    });
    await this.api.call("answerInlineQuery", {
      inline_query_id: q.id, results, cache_time: 5, is_personal: true,
      ...(this.opts.library ? { button: { text: "📚 Open my library", web_app: { url: this.opts.library } } } : {}),
    });
  }

  // --- devices and the laptop ----------------------------------------------------------------

  private async laptop(m: Message, command: string) {
    const here = where(m);
    if (!command) {
      return void await this.send(here, "Put your secret word in the command, like:\n<code>/laptop mango open YouTube</code>\n\n" +
        "Your laptop checks the word and takes it out. I delete your message straight after, so the word doesn't stay in this chat.");
    }
    const r = await this.butler.laptop(command.slice(0, 2000)).catch((e) => ({ error: short(e) }));
    // The command holds your secret word: it shouldn't stay in the chat (bots can delete your messages to them).
    const deleted = await this.api.call("deleteMessage", { chat_id: m.chat.id, message_id: m.message_id }).then(() => true, () => false);
    const wiped = deleted
      ? "\n\n🧹 I deleted your message so your secret word isn't left in this chat."
      : "\n\n⚠️ I couldn't delete your message. Delete it yourself so your secret word isn't left in this chat.";
    if ("error" in r) return void await this.send(here, `Couldn't send that to your laptop: ${tg.escape(r.error)}${wiped}`);
    const text = `💻 Sent to ${tg.escape(r.sent.join(", "))}. It'll tell you here how it goes.` +
      (r.warning ? `\n\n⚠️ ${tg.escape(r.warning)}` : "") + wiped;
    await this.send(here, text, laptopButtons());
  }

  private async stopLaptop(here: Where, off: boolean) {
    const to = await this.butler.stopLaptop(off).catch(() => [] as string[]);
    await this.send(here, !to.length ? "No laptop has checked in with Butler yet."
      : off ? `⛔ Remote control is being switched off on ${tg.escape(to.join(", "))}. Only you, at the laptop, can turn it back on.`
      : `🛑 Stopping what ${tg.escape(to.join(", "))} is doing.`);
  }

  private async devices(here: Where) {
    const list = await this.butler.devices().catch(() => []);
    if (!list.length) return void await this.send(here, "No devices have checked in with Butler yet.");
    const now = Date.now();
    const icon = (kind: string) => (kind === "laptop" ? "💻" : kind === "phone" ? "📱" : "✈️");
    const lines = list.map((d) => {
      const mins = Math.round((now - new Date(d.last_seen).getTime()) / 60_000);
      const when = mins < 2 ? "online" : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
      return `${icon(d.kind)} <b>${tg.escape(d.name)}</b> · ${when}`;
    });
    await this.send(here, lines.join("\n"));
  }

  private async alerts(here: Where, args: string) {
    const want = /^(on|yes|1)$/i.test(args) ? true : /^(off|no|0|stop)$/i.test(args) ? false : undefined;
    const on = await this.butler.alerts(want);
    await this.send(here, on
      ? "🔔 Reminders, your brief and Butler's notes come here as well as to your devices. <code>/alerts off</code> stops that."
      : "🔕 Reminders and notes only go to your phone and laptop now. <code>/alerts on</code> brings them back here.");
  }

  // --- buttons -------------------------------------------------------------------------------

  private async onButton(q: CallbackQuery) {
    if (q.from.id !== await this.butler.owner()) return; // not yours: no answer
    const data = q.data ?? "";
    const [kind, arg = ""] = [data.slice(0, data.indexOf(":") === -1 ? data.length : data.indexOf(":")), data.slice(data.indexOf(":") + 1)];
    const msg = q.message;
    const here: Where | null = msg ? where(msg) : null;
    const toast = (text = "", alert = false) =>
      this.api.call("answerCallbackQuery", { callback_query_id: q.id, text: text.slice(0, 200), show_alert: alert }).catch(() => {});
    const plain = msg?.text ?? msg?.caption ?? "";
    const edit = (text: string, keyboard: Keyboard = []) => msg
      ? this.api.call("editMessageText", {
        chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }, link_preview_options: { is_disabled: true },
      }).catch((e) => notModified(e) || console.warn("telegram edit:", (e as Error).message))
      : Promise.resolve();
    const unbutton = () => msg
      ? this.api.call("editMessageReplyMarkup", { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {})
      : Promise.resolve();

    switch (kind) {
      case "ok":
      case "no": {
        await toast(kind === "ok" ? "On it…" : "Cancelled");
        await unbutton();
        const r = await this.butler.confirm(arg, kind === "ok").catch((e) => failure(e));
        if (!here) return;
        if (kind === "no" && (r.status < 400 || r.status === 410)) return void await this.send(here, "Okay, cancelled. Nothing was sent or changed.");
        if (r.status === 410) return void await this.send(here, "That expired (I only hold these for a while). Ask me again.");
        return void await this.answer(here, r, null, {});
      }
      case "re": {
        const text = this.take(arg);
        await toast(text ? "Trying again…" : "That's too old to retry. Send it again.");
        if (text && here) {
          await unbutton();
          await this.askText(here, text);
        }
        return;
      }
      case "svl":
      case "svp": {
        const value = this.take(arg);
        if (!value || !here) return void await toast("That's too old now. Send it again.");
        await toast("Saving…");
        await unbutton();
        if (kind === "svl") return this.saved(here, await this.butler.save({ url: value }).catch((e) => ({ status: 500, error: short(e) })));
        try {
          const { bytes } = await this.api.download(value);
          return this.saved(here, await this.butler.save({ file: new File([bytes as BlobPart], "photo.jpg", { type: "image/jpeg" }) }));
        } catch (e) {
          return void await this.send(here, `Couldn't save the photo: ${tg.escape(short(e))}`);
        }
      }
      case "snl":
      case "snp": {
        const item = await this.butler.item(arg);
        if (!item) return void await toast("That save is gone from your library.", true);
        const target = kind === "snl" ? "laptop" : "phone";
        const to = await this.butler.sendItem(target, item).catch(() => [] as string[]);
        return void await toast(to.length ? `Sent to ${to.join(", ")}` : `No ${target} has checked in with Butler yet.`, !to.length);
      }
      case "del":
        await toast();
        return void await edit(`${tg.escape(plain)}\n\n<b>Delete this from your library?</b>`, [[
          { text: "🗑 Yes, delete it", callback_data: `dly:${arg}` }, { text: "Keep it", callback_data: `kep:${arg}` },
        ]]);
      case "dly": {
        const gone = await this.butler.remove(arg).catch(() => false);
        await toast(gone ? "Deleted" : "It was already gone");
        return void await edit("🗑 Deleted from your library.");
      }
      case "kep": {
        await toast();
        const item = await this.butler.item(arg);
        if (!item || !msg) return void await edit("That save is gone from your library.");
        return void await this.api.call("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, ...this.card(item) })
          .catch((e) => notModified(e) || console.warn("telegram edit:", (e as Error).message));
      }
      case "snz": {
        const minutes = Math.min(Math.max(Number(arg) || 10, 1), 24 * 60);
        const what = plain.replace(/^⏰\s*/, "").replace(/\n\n💤 Snoozed.*$/s, "").trim();
        const at = new Date(Date.now() + minutes * 60_000);
        await this.butler.remindHere(what, at);
        const time = new Intl.DateTimeFormat("en-GB", { timeZone: await this.butler.timeZone(), hour: "2-digit", minute: "2-digit" }).format(at);
        await toast(`Snoozed until ${time}`);
        return void await edit(`⏰ ${tg.escape(what)}\n\n💤 Snoozed until ${time}. I'll remind you here.`);
      }
      case "dne":
        await toast("Nice");
        return void await edit(`⏰ <s>${tg.escape(plain.replace(/^⏰\s*/, ""))}</s>\n✓ Done`);
      case "stp":
      case "off":
        await toast(kind === "off" ? "Switching remote control off…" : "Stopping…");
        if (here) await this.stopLaptop(here, kind === "off");
        return;
      case "cmd":
        await toast();
        if (here && ["brief", "tasks", "inbox", "recap", "devices", "library"].includes(arg)) {
          return this.command({ message_id: 0, chat: { id: here.chat_id, type: "private" }, date: 0, message_thread_id: here.message_thread_id }, arg, "");
        }
        return;
      default:
        return void await toast();
    }
  }

  /** Added to a group or channel: Butler is private, so it leaves straight away. */
  private async onMembership(u: MemberUpdate) {
    if (u.chat.type === "private") return;
    if (!["member", "administrator"].includes(u.new_chat_member.status)) return;
    await this.api.call("leaveChat", { chat_id: u.chat.id }).catch(() => {});
  }

  // --- what Butler pushes to you ---------------------------------------------------------------

  /**
   * Shows something Butler sent to every device: a reminder, a note, a link, copied text, a
   * file, or how a laptop job is going. Answers the message's id (null if nothing was shown).
   */
  async push(m: Pushed): Promise<number | null> {
    const chat = await this.butler.owner();
    if (!chat) return null;
    const here: Where = { chat_id: chat };
    const body = m.body?.trim() ?? "";
    const fromButler = FROM_BUTLER.test(m.from_device);
    const opener: Keyboard = m.url && /^https?:\/\//.test(m.url) ? [[{ text: "↗️ Open", url: m.url }]] : [];
    switch (m.kind) {
      case "reminder":
        return this.send(here, `⏰ ${tg.escape(body || "Reminder")}`, [
          [{ text: "💤 10 min", callback_data: "snz:10" }, { text: "💤 1 hour", callback_data: "snz:60" }, { text: "✓ Done", callback_data: "dne:" }],
          ...opener,
        ]);
      case "note":
        if (!body) return null;
        return this.send(here, fromButler ? tg.escape(body) : `📝 <b>From your ${tg.escape(m.from_device)}</b>\n${tg.escape(body)}`, opener);
      case "link": {
        const url = m.url ?? body;
        if (!url) return null;
        return this.send(here, `🔗 <b>From your ${tg.escape(m.from_device)}</b>\n${tg.escape(url)}${m.url && body ? `\n${tg.escape(body)}` : ""}`, opener, undefined, true);
      }
      case "clip":
        if (!body) return null;
        return this.send(here, `📋 <b>Copied on your ${tg.escape(m.from_device)}</b>\n<code>${tg.escape(body.slice(0, 3500))}</code>`);
      case "file":
        return this.pushFile(here, m);
      case "status":
        return this.pushStatus(here, body);
      default:
        return null; // clipboard sync, rings, laptop commands and transfers are for the apps
    }
  }

  private async pushFile(here: Where, m: Pushed): Promise<number | null> {
    const item = m.item_id ? await this.butler.item(m.item_id) : undefined;
    if (!item) return null;
    const caption = `📎 <b>From your ${tg.escape(m.from_device)}</b>`;
    const file = await this.butler.file(item);
    if (!file || file === "too big" || file.size > UPLOAD_MAX) {
      const link = this.butler.link(item);
      const why = file ? " (too big to send here, so here's the link)" : " (I couldn't find the file on the server)";
      return this.send(here, `${caption}\n${tg.escape(item.title ?? "A file")}${why}`, link ? [[{ text: "↗️ Open", url: link }]] : []);
    }
    const form = new FormData();
    form.set("chat_id", String(here.chat_id));
    form.set("document", file, file.name);
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    const sent = await this.api.upload<{ message_id: number }>("sendDocument", form).catch((e) => {
      console.warn("telegram file:", (e as Error).message);
      return null;
    });
    return sent?.message_id ?? null;
  }

  private pushStatus(here: Where, body: string): Promise<number | null> {
    let s: { state?: string; title?: string; text?: string };
    try {
      s = JSON.parse(body);
    } catch {
      return Promise.resolve(null);
    }
    const busy = s.state === "started" || s.state === "working";
    const icon = { done: "✅", failed: "❌", refused: "🚫", stopped: "🛑", locked: "🔒" }[s.state ?? ""] ?? "💻";
    const text = `${icon} <b>${tg.escape(s.title ?? "Your laptop")}</b>${s.text ? `\n${tg.escape(s.text.slice(0, 3000))}` : ""}`;
    return this.send(here, text, busy ? laptopButtons() : []);
  }

  /** Deletes a message later shown (a login code that shouldn't stay in the chat). */
  async unsay(message: number): Promise<void> {
    const chat = await this.butler.owner();
    if (chat) await this.api.call("deleteMessage", { chat_id: chat, message_id: message }).catch(() => {});
  }

  // --- sending ---------------------------------------------------------------------------------

  /** Sends HTML text, split if it's long, with buttons on the last part. Answers the last part's id. */
  private async send(here: Where, html: string, keyboard: Keyboard = [], replyTo?: number, preview = false): Promise<number | null> {
    return this.say(here, html, keyboard, null, replyTo, preview);
  }

  /**
   * Shows `html`: in place of the "on it" message when there is one (`edit`), otherwise as a
   * new message. Long text goes in several messages; the buttons go on the last.
   */
  private async say(here: Where, html: string, keyboard: Keyboard = [], edit: number | null = null, replyTo?: number, preview = false): Promise<number | null> {
    const parts = tg.chunks(html);
    let last: number | null = null;
    for (const [i, part] of parts.entries()) {
      const markup = i === parts.length - 1 && keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};
      const common = { parse_mode: "HTML", link_preview_options: { is_disabled: !preview }, ...markup };
      if (i === 0 && edit) {
        const ok = await this.api.call("editMessageText", { chat_id: here.chat_id, message_id: edit, text: part, ...common })
          .then(() => true, (e) => notModified(e));
        if (ok) {
          last = edit;
          continue;
        }
      }
      last = await this.post(here, part, common, i === 0 ? replyTo : undefined);
    }
    return last;
  }

  private async post(here: Where, text: string, common: Record<string, unknown>, replyTo?: number): Promise<number | null> {
    const params: Record<string, unknown> = {
      chat_id: here.chat_id, text, ...common,
      ...(here.message_thread_id ? { message_thread_id: here.message_thread_id } : {}),
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    };
    try {
      return (await this.api.call<{ message_id: number }>("sendMessage", params)).message_id;
    } catch (e) {
      // Formatting Telegram didn't accept: send it as plain words rather than not at all.
      if (/can't parse entities/i.test((e as Error).message)) {
        const { parse_mode: _, ...rest } = params;
        return (await this.api.call<{ message_id: number }>("sendMessage", { ...rest, text: text.replace(/<[^>]+>/g, "") })
          .catch(() => null))?.message_id ?? null;
      }
      console.warn("telegram send:", (e as Error).message);
      return null;
    }
  }

  /**
   * Shows "typing…" until stopped, and after a few seconds an "on it" message, so a slow answer
   * never looks ignored. stop() answers that message's id, for the answer to replace.
   */
  private working(here: Where, action = "typing") {
    const tick = () => this.api.call("sendChatAction", { chat_id: here.chat_id, action, ...(here.message_thread_id ? { message_thread_id: here.message_thread_id } : {}) }).catch(() => {});
    tick();
    const timer = setInterval(tick, 4500);
    let shown: Promise<number | null> | null = null;
    const slow = setTimeout(() => {
      shown = this.post(here, "on it… <i>(the AI is thinking)</i>", { parse_mode: "HTML" });
    }, this.opts.slowMs ?? 6000);
    return {
      stop: async () => {
        clearInterval(timer);
        clearTimeout(slow);
        return shown ? await shown : null;
      },
    };
  }

  /** Keeps a value for a button for an hour (button data can only hold 64 bytes). */
  private keep(value: string): string {
    const now = Date.now();
    for (const [k, v] of this.stash) if (now - v.at > 3_600_000) this.stash.delete(k);
    if (this.stash.size > 300) this.stash.delete(this.stash.keys().next().value!);
    const key = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.stash.set(key, { value, at: now });
    return key;
  }

  private take(key: string): string | null {
    const v = this.stash.get(key);
    return v && Date.now() - v.at < 3_600_000 ? v.value : null;
  }
}

// --- helpers -----------------------------------------------------------------------------------

const where = (m: Message): Where => ({ chat_id: m.chat.id, ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });

const laptopButtons = (): Keyboard => [[{ text: "🛑 Stop", callback_data: "stp:" }, { text: "⛔ Turn remote control off", callback_data: "off:" }]];

/** The biggest version of a photo that's no larger than `max`. */
function biggest(sizes: Photo[], max: number): Photo | null {
  const fits = sizes.filter((p) => (p.file_size ?? 0) <= max);
  return fits.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

const failure = (e: unknown): Answer => ({ status: 500, reply: { error: short(e) } });

/** Telegram refuses an edit that changes nothing; that's fine, not a failure. */
const notModified = (e: unknown) => /message is not modified/i.test(String((e as Error)?.message ?? e));

/** Butler's notes start lowercase, the way it talks in the pet's bubble; here they're sentences. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An error from Ask Butler, said plainly, with what to do about it. */
export function problem(status: number, error?: string): string {
  const detail = error ? `\n\n<i>${tg.escape(error.slice(0, 200))}</i>` : "";
  if (status === 503) return "I can't think right now: the server has no AI model set up (GEMINI_API_KEY or a backup)." + detail;
  if (status === 401) return "The server turned me away. BUTLER_TOKEN isn't set the same way for the Telegram bot.";
  if (status === 413) return "That's too big for me: voice notes up to about 4 minutes, pictures up to 4 MB.";
  if (status === 410) return "That expired (I only hold these for a while). Ask me again.";
  if (status === 404 && error) return `${tg.escape(sentence(error))}.`;
  if (status === 400 && error) return `I couldn't use that: ${tg.escape(error)}.`;
  return "Something went wrong on my side and I didn't get an answer (the AI may be busy). Try again in a moment." + detail;
}

/** A link that opens WhatsApp or Telegram with the message written, for you to tap Send. */
export function chatLink(m: Reply["message"]): string | null {
  if (!m?.text) return null;
  const text = encodeURIComponent(m.text);
  if (m.app === "telegram") return `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${text}`;
  const phone = m.phone?.replace(/[^\d]/g, "");
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}
