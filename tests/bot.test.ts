import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "../server/lib/db.ts";
import { type Answer, Bot, type Butler, chatLink, type Message, problem, type Update } from "../server/lib/bot.ts";
import type { Api } from "../server/lib/telegram.ts";

const OWNER = 4242;
const STRANGER = 666;
const CODE = "0123456789abcdef0123456789abcdef";

const item = (over: Partial<Item> = {}): Item => ({
  id: "11111111-1111-1111-1111-111111111111", created_at: "2026-11-01T09:00:00Z", device: "Telegram", kind: "link",
  url: "https://example.com/jollof", body: null, note: null, file_path: null, mime: null, thumbnail: null, platform: null,
  title: "Smoky party jollof", summary: "A recipe.", tags: ["recipe", "nigerian food"], category: "Nigerian Recipes",
  status: "organized", error: null, board_x: null, board_y: null, board_tilt: null, ...over,
});

type Call = { method: string; params: Record<string, unknown> };

/** A pretend Telegram that keeps every call, and a pretend Butler that answers what each test says. */
function setup(over: Partial<Butler> = {}, opts: { slowMs?: number } = {}) {
  const calls: Call[] = [];
  let next = 100;
  const api: Api = {
    call: <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return Promise.resolve((method === "sendMessage" ? { message_id: next++ } : true) as T);
    },
    upload: <T>(method: string, form: FormData) => {
      calls.push({ method, params: Object.fromEntries(form) });
      return Promise.resolve({ message_id: next++ } as T);
    },
    download: (fileId: string) => {
      calls.push({ method: "download", params: { fileId } });
      return Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), path: "voice/file_1.oga" });
    },
  };
  const asked: Parameters<Butler["ask"]>[0][] = [];
  let owner: number | null = OWNER;
  const butler: Butler = {
    ask: (i) => {
      asked.push(i);
      return Promise.resolve({ status: 200, reply: { action: "answer", say: "got you <3" } });
    },
    confirm: () => Promise.resolve({ status: 200, reply: { say: "sent to Ada." } }),
    save: () => Promise.resolve({ status: 201, id: item().id }),
    item: () => Promise.resolve(item()),
    remove: () => Promise.resolve(true),
    link: (i) => i.url,
    file: () => Promise.resolve(null),
    sendItem: () => Promise.resolve(["gamp-laptop"]),
    sendText: () => Promise.resolve(["gamp-laptop"]),
    laptop: () => Promise.resolve({ sent: ["gamp-laptop"], warning: null }),
    stopLaptop: () => Promise.resolve(["gamp-laptop"]),
    remindHere: () => Promise.resolve(),
    brief: () => Promise.resolve("good morning. 2 events today."),
    mail: () => Promise.resolve("no unread email."),
    tasks: () => Promise.resolve("no open tasks."),
    recap: () => Promise.resolve("you saved 3 things."),
    spending: () => Promise.resolve("nothing logged."),
    find: () => Promise.resolve([item()]),
    recent: () => Promise.resolve([item()]),
    ring: () => Promise.resolve("ringing your phone."),
    devices: () => Promise.resolve([{ name: "gamp-laptop", kind: "laptop", last_seen: new Date().toISOString() }]),
    newChat: () => Promise.resolve(),
    owner: () => Promise.resolve(owner),
    pair: (code, user) => {
      if (code !== CODE) return Promise.resolve(false);
      owner = user;
      return Promise.resolve(true);
    },
    alerts: () => Promise.resolve(true),
    timeZone: () => Promise.resolve("Africa/Lagos"),
    ...over,
  };
  const bot = new Bot(api, butler, {
    username: "ButlerVIfred_bot", library: "https://butler.test/?app=telegram", privacy: "https://butler.test/privacy-policy",
    slowMs: opts.slowMs ?? 60_000, followMs: 5, followFor: 200,
  });
  let id = 1;
  const update = (u: Omit<Update, "update_id">) => bot.handle({ update_id: id++, ...u });
  const message = (from: number, m: Partial<Message>) =>
    update({ message: { message_id: 50 + id, from: { id: from, first_name: "A" }, chat: { id: from, type: "private" }, date: 1, ...m } });
  const sent = () => calls.filter((c) => c.method === "sendMessage");
  return { bot, calls, asked, update, message, sent, setOwner: (o: number | null) => (owner = o) };
}

const buttons = (c: Call) => ((c.params.reply_markup as { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } | undefined)
  ?.inline_keyboard.flat() ?? []);

test("strangers get no answer at all, whatever they send", async () => {
  const t = setup();
  await t.message(STRANGER, { text: "hello" });
  await t.message(STRANGER, { text: "/start" });
  await t.message(STRANGER, { text: "/start ffffffffffffffffffffffffffffffff" }); // a made-up code
  await t.message(STRANGER, { text: "https://evil.example" });
  await t.update({ callback_query: { id: "q", from: { id: STRANGER }, data: "dly:11111111-1111-1111-1111-111111111111" } });
  assert.equal(t.calls.length, 0);
  assert.equal(t.asked.length, 0);
});

test("other bots and group chats are ignored, and Butler leaves a group it's added to", async () => {
  const t = setup();
  await t.update({ message: { message_id: 1, from: { id: OWNER, is_bot: true }, chat: { id: OWNER, type: "private" }, date: 1, text: "hi" } });
  await t.update({ message: { message_id: 2, from: { id: OWNER }, chat: { id: -100, type: "group" }, date: 1, text: "hi" } });
  assert.equal(t.calls.length, 0);
  await t.update({ my_chat_member: { chat: { id: -100, type: "supergroup" }, from: { id: STRANGER }, new_chat_member: { status: "member" } } });
  assert.deepEqual(t.calls.map((c) => c.method), ["leaveChat"]);
});

test("the website's Connect link makes you the owner, once", async () => {
  const t = setup();
  t.setOwner(null);
  await t.message(OWNER, { text: "hi" });
  assert.equal(t.calls.length, 0); // not connected yet: silence
  await t.message(OWNER, { text: `/start ${CODE}` });
  assert.match(String(t.sent()[0].params.text), /Connected/);
  assert.ok(buttons(t.sent()[0]).some((b) => b.text.includes("library")));
});

test("what you type goes to Ask Butler, with typing shown, and the answer is escaped", async () => {
  const t = setup();
  await t.message(OWNER, { text: "what's on tomorrow?" });
  assert.equal(t.asked[0].text, "what's on tomorrow?");
  assert.equal(t.calls[0].method, "sendChatAction");
  assert.equal(t.sent()[0].params.text, "got you &lt;3");
  assert.equal(t.sent()[0].params.parse_mode, "HTML");
});

test("a reply to one of Butler's messages says what it answers", async () => {
  const t = setup();
  await t.message(OWNER, { text: "yes", reply_to_message: { message_id: 9, from: { id: 1, is_bot: true }, chat: { id: OWNER, type: "private" }, date: 1, text: "Want me to remind you?" } });
  assert.equal(t.asked[0].replyTo, "Want me to remind you?");
});

test("a slow answer gets an 'on it' message straight away, replaced by the answer", async () => {
  const t = setup({
    ask: () => new Promise<Answer>((r) => setTimeout(() => r({ status: 200, reply: { action: "answer", say: "done thinking" } }), 40)),
  }, { slowMs: 5 });
  await t.message(OWNER, { text: "think hard" });
  const placeholder = t.sent()[0];
  assert.match(String(placeholder.params.text), /on it/);
  const edit = t.calls.find((c) => c.method === "editMessageText")!;
  assert.equal(edit.params.text, "done thinking");
  assert.equal(edit.params.message_id, 100);
  assert.equal(t.sent().length, 1);
});

test("an email to send waits for your tap, and Cancel sends nothing", async () => {
  let confirmed: [string, boolean] | null = null;
  const t = setup({
    ask: () => Promise.resolve({ status: 200, reply: { action: "confirm", say: "ready to send. To: Ada", confirm: "c0ffee00-0000-0000-0000-000000000000" } }),
    confirm: (id, yes) => {
      confirmed = [id, yes];
      return Promise.resolve({ status: 200, reply: { say: "sent to Ada." } });
    },
  });
  await t.message(OWNER, { text: "email Ada I'm late" });
  const b = buttons(t.sent()[0]);
  assert.deepEqual(b.map((x) => x.callback_data), ["ok:c0ffee00-0000-0000-0000-000000000000", "no:c0ffee00-0000-0000-0000-000000000000"]);
  assert.equal(b[0].text, "✅ Send it");
  await t.update({ callback_query: { id: "q1", from: { id: OWNER }, message: { message_id: 100, chat: { id: OWNER, type: "private" }, date: 1, text: "ready to send" }, data: b[1].callback_data } });
  assert.deepEqual(confirmed, ["c0ffee00-0000-0000-0000-000000000000", false]);
  assert.match(String(t.sent().at(-1)!.params.text), /cancelled/i);
});

test("tapping Send uses your yes and shows what happened", async () => {
  const t = setup({
    ask: () => Promise.resolve({ status: 200, reply: { action: "confirm", say: "Use Notion/create?", confirm: "abc" } }),
  });
  await t.message(OWNER, { text: "add it to notion" });
  await t.update({ callback_query: { id: "q1", from: { id: OWNER }, message: { message_id: 100, chat: { id: OWNER, type: "private" }, date: 1, text: "Use Notion/create?" }, data: "ok:abc" } });
  assert.ok(t.calls.some((c) => c.method === "answerCallbackQuery"));
  assert.ok(t.calls.some((c) => c.method === "editMessageReplyMarkup")); // the buttons go, so it can't be tapped twice
  assert.equal(t.sent().at(-1)!.params.text, "sent to Ada.");
});

test("a link on its own is saved, then shown with its collection once sorted", async () => {
  let saved: unknown = null;
  const t = setup({
    save: (i) => {
      saved = i;
      return Promise.resolve({ status: 201, id: item().id });
    },
  });
  await t.message(OWNER, { text: "https://example.com/jollof" });
  assert.deepEqual(saved, { url: "https://example.com/jollof" });
  assert.match(String(t.sent()[0].params.text), /Saved/);
  await new Promise((r) => setTimeout(r, 30));
  const card = t.calls.find((c) => c.method === "editMessageText")!;
  assert.match(String(card.params.text), /Smoky party jollof/);
  assert.match(String(card.params.text), /Nigerian Recipes · #recipe · #nigerian_food/);
  assert.deepEqual(buttons(card).map((b) => b.text), ["↗️ Open", "💻 To laptop", "📱 To phone", "🗑 Delete"]);
});

test("a link inside a question is asked about, with a button to save it", async () => {
  const t = setup();
  await t.message(OWNER, { text: "what's this about? https://example.com/x" });
  assert.equal(t.asked.length, 1);
  assert.ok(buttons(t.sent()[0]).some((b) => b.text === "📥 Save the link"));
});

test("files and forwarded messages are saved, and over-20 MB files are explained", async () => {
  const saves: Parameters<Butler["save"]>[0][] = [];
  const t = setup({
    save: (i) => {
      saves.push(i);
      return Promise.resolve({ status: 201, id: item().id });
    },
  });
  await t.message(OWNER, { document: { file_id: "d1", file_name: "cv.pdf", mime_type: "application/pdf", file_size: 1000 }, caption: "my CV" });
  assert.equal(saves[0].file?.name, "cv.pdf");
  assert.equal(saves[0].file?.type, "application/pdf");
  assert.equal(saves[0].note, "my CV");
  await t.message(OWNER, { text: "meet at 5", forward_origin: { type: "user", sender_user: { id: 7, first_name: "Ada" } } });
  assert.deepEqual(saves[1], { text: "meet at 5", note: "Forwarded from Ada" });
  await t.message(OWNER, { video: { file_id: "v", file_size: 30 * 1024 * 1024 } });
  assert.equal(saves.length, 2);
  assert.match(String(t.sent().at(-1)!.params.text), /20 MB/);
});

test("a voice note is heard and answered", async () => {
  const t = setup({
    ask: (i) => {
      assert.equal(i.audio?.type, "audio/ogg");
      return Promise.resolve({ status: 200, reply: { action: "remind", say: "reminder's set.", heard: "remind me at 6" } });
    },
  });
  await t.message(OWNER, { voice: { file_id: "v1", file_size: 5000, mime_type: "audio/ogg" } });
  assert.ok(t.calls.some((c) => c.method === "download"));
  assert.match(String(t.sent()[0].params.text), /remind me at 6/);
  assert.match(String(t.sent()[0].params.text), /reminder's set/);
});

test("a photo with a question is looked at; one without is saved", async () => {
  const saves: unknown[] = [];
  const t = setup({ save: (i) => (saves.push(i), Promise.resolve({ status: 201, id: item().id })) });
  const photo = [{ file_id: "small", width: 90, height: 90, file_size: 1000 }, { file_id: "big", width: 1280, height: 960, file_size: 200_000 }];
  await t.message(OWNER, { photo, caption: "what plant is this?" });
  assert.equal(t.asked[0].text, "what plant is this?");
  assert.equal(t.asked[0].picture?.type, "image/jpeg");
  assert.deepEqual(t.calls.find((c) => c.method === "download")!.params, { fileId: "big" });
  assert.ok(buttons(t.sent()[0]).some((b) => b.text === "📥 Save this photo"));
  await t.message(OWNER, { photo });
  assert.equal(saves.length, 1);
});

test("a laptop command is sent, and your message with the secret word is deleted", async () => {
  let sent = "";
  const t = setup({ laptop: (c) => ((sent = c), Promise.resolve({ sent: ["gamp-laptop"], warning: "your laptop was last online 3 hours ago" })) });
  await t.message(OWNER, { text: "/laptop mango open YouTube" });
  assert.equal(sent, "mango open YouTube");
  const del = t.calls.find((c) => c.method === "deleteMessage")!;
  assert.equal(del.params.chat_id, OWNER);
  const reply = String(t.sent()[0].params.text);
  assert.match(reply, /Sent to gamp-laptop/);
  assert.match(reply, /3 hours ago/);
  assert.match(reply, /deleted your message/);
  assert.deepEqual(buttons(t.sent()[0]).map((b) => b.callback_data), ["stp:", "off:"]);
});

test("/laptop on its own explains, and never sends anything", async () => {
  let called = false;
  const t = setup({ laptop: () => ((called = true), Promise.resolve({ sent: [], warning: null })) });
  await t.message(OWNER, { text: "/laptop" });
  assert.equal(called, false);
  assert.match(String(t.sent()[0].params.text), /secret word/);
});

test("reminders arrive with snooze buttons, and snoozing sets a new one here", async () => {
  let snoozed: [string, Date] | null = null;
  const t = setup({ remindHere: (text, at) => ((snoozed = [text, at]), Promise.resolve()) });
  const id = await t.bot.push({ kind: "reminder", from_device: "Butler", body: "Call Mum", url: null, item_id: null });
  assert.equal(id, 100);
  const msg = t.sent()[0];
  assert.equal(msg.params.text, "⏰ Call Mum");
  assert.deepEqual(buttons(msg).map((b) => b.callback_data), ["snz:10", "snz:60", "dne:"]);
  const before = Date.now();
  await t.update({ callback_query: { id: "q", from: { id: OWNER }, message: { message_id: 100, chat: { id: OWNER, type: "private" }, date: 1, text: "⏰ Call Mum" }, data: "snz:60" } });
  assert.equal(snoozed![0], "Call Mum");
  assert.ok(Math.abs(snoozed![1].getTime() - before - 3_600_000) < 5000);
  assert.match(String(t.calls.find((c) => c.method === "editMessageText")!.params.text), /Snoozed until/);
});

test("pushes: Butler's notes as they are, other devices' things say where they came from, app-only kinds are skipped", async () => {
  const t = setup();
  await t.bot.push({ kind: "note", from_device: "Butler", body: "Good morning <3", url: "https://pay.example/x", item_id: null });
  await t.bot.push({ kind: "clip", from_device: "gamp-laptop", body: "npm run build", url: null, item_id: null });
  await t.bot.push({ kind: "status", from_device: "gamp-laptop", body: JSON.stringify({ state: "working", title: "Working on it", text: "Editing main.ts" }), url: null, item_id: null });
  assert.equal(await t.bot.push({ kind: "sync", from_device: "gamp-laptop", body: "x", url: null, item_id: null }), null);
  assert.equal(await t.bot.push({ kind: "ring", from_device: "phone", body: null, url: null, item_id: null }), null);
  const [note, clip, status] = t.sent();
  assert.equal(note.params.text, "Good morning &lt;3");
  assert.deepEqual(buttons(note).map((b) => b.url), ["https://pay.example/x"]);
  assert.match(String(clip.params.text), /Copied on your gamp-laptop<\/b>\n<code>npm run build<\/code>/);
  assert.match(String(status.params.text), /Working on it/);
  assert.deepEqual(buttons(status).map((b) => b.callback_data), ["stp:", "off:"]);
});

test("a file sent to every device arrives as a document", async () => {
  const t = setup({
    item: () => Promise.resolve(item({ file_path: "x/cv.pdf", mime: "application/pdf", url: null })),
    file: () => Promise.resolve(new File([new Uint8Array([1])], "cv.pdf", { type: "application/pdf" })),
  });
  await t.bot.push({ kind: "file", from_device: "gamp-phone", body: null, url: null, item_id: item().id });
  const doc = t.calls.find((c) => c.method === "sendDocument")!;
  assert.equal(doc.params.chat_id, String(OWNER));
  assert.equal((doc.params.document as File).name, "cv.pdf");
});

test("inline search shows your saves to you and nothing to anyone else", async () => {
  const t = setup();
  await t.update({ inline_query: { id: "i1", from: { id: STRANGER }, query: "jollof" } });
  assert.deepEqual(t.calls[0].params.results, []);
  await t.update({ inline_query: { id: "i2", from: { id: OWNER }, query: "jollof" } });
  const results = t.calls[1].params.results as { title: string; input_message_content: { message_text: string } }[];
  assert.equal(results[0].title, "Smoky party jollof");
  assert.match(results[0].input_message_content.message_text, /example\.com\/jollof/);
  assert.equal(t.calls[1].params.is_personal, true);
});

test("when the AI fails you're told plainly, with Try again", async () => {
  let tries = 0;
  const t = setup({
    ask: () => (++tries === 1
      ? Promise.resolve({ status: 502, reply: { error: "Error: all providers failed" } })
      : Promise.resolve({ status: 200, reply: { action: "answer", say: "second time lucky" } })),
  });
  await t.message(OWNER, { text: "hello?" });
  const first = t.sent()[0];
  assert.match(String(first.params.text), /didn't get an answer/);
  const retry = buttons(first)[0];
  assert.equal(retry.text, "🔁 Try again");
  await t.update({ callback_query: { id: "q", from: { id: OWNER }, message: { message_id: 100, chat: { id: OWNER, type: "private" }, date: 1, text: "x" }, data: retry.callback_data } });
  assert.equal(tries, 2);
  assert.equal(t.sent().at(-1)!.params.text, "second time lucky");
});

test("the same update twice is handled once", async () => {
  const t = setup();
  const u: Update = { update_id: 999, message: { message_id: 1, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, date: 1, text: "hi" } };
  await t.bot.handle(u);
  await t.bot.handle(u);
  assert.equal(t.asked.length, 1);
});

test("replies stay in the topic they were asked in", async () => {
  const t = setup();
  await t.message(OWNER, { text: "/brief", message_thread_id: 77 });
  assert.equal(t.sent()[0].params.message_thread_id, 77);
  assert.equal(t.sent()[0].params.text, "Good morning. 2 events today.");
});

test("errors and chat links read plainly", () => {
  assert.match(problem(503), /no AI model/);
  assert.match(problem(404, "that save is gone"), /That save is gone/);
  assert.equal(chatLink({ app: "whatsapp", person: "Ada", name: "Ada", phone: "+234 801 234", text: "hi there" }), "https://wa.me/234801234?text=hi%20there");
  assert.equal(chatLink({ app: "whatsapp", person: "Ada", name: "Ada", phone: null, text: "hi" }), "https://wa.me/?text=hi");
  assert.match(chatLink({ app: "telegram", person: "Ada", name: "Ada", phone: null, text: "hi" })!, /^https:\/\/t\.me\/share\/url\?/);
});
