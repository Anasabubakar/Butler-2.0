// Little Butler for Windows: peeks from the bottom-right corner of the screen, and does what
// the GNOME pet does (desktop/gnome), talking to the same Butler server the same way. Its
// window never takes the focus, so Copy, Save and Draft act on the app you're in.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
    app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray,
} from 'electron';
import electronUpdater from 'electron-updater';

import {Butler} from './api.js';
import {loadConfig, saveConfig} from './config.js';
import {COPY, PASTE, press} from './keys.js';
import {describe, inOrder, safeLink} from './messages.js';
import {receiveFiles, sendFiles} from './transfer.js';

const {autoUpdater} = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));

const WIN_W = 400;          // the pet's window: the pet in its bottom-right corner, bubble and menu above
const WIN_H = 620;
const INBOX_WAIT = 25;      // seconds Butler holds each inbox check open
const RETRY_MS = 20_000;    // wait this long when Butler can't be reached
const SYNC_EVERY_MS = 1500; // how often the clipboard is looked at while sync is on
const SYNC_MAX = 20000;     // characters; bigger copies stay here
const UPDATE_EVERY_MS = 6 * 3_600_000;

const configDir = () => app.getPath('userData'); // %APPDATA%\Butler
const downloads = () => path.join(app.getPath('downloads'), 'Butler');
const spotFile = () => path.join(configDir(), 'pet-spot.json');
const syncFile = () => path.join(configDir(), 'clipboard-sync');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

/** The sprites: packed next to the app, or straight from the GNOME pet while developing. */
function petsDir() {
    const packed = path.join(app.getAppPath(), 'pets');
    return fs.existsSync(packed) ? packed : path.join(app.getAppPath(), '..', 'gnome', 'butler-pet@anasmasama.dev', 'pets');
}

let pet = null;
let settings = null;
let tray = null;
let busy = false;
let ringing = false;
let syncOn = false;
let lastSynced = '';
let answer = null;      // resolves the Do it / Send question in the bubble
let stopRequested = false;

if (!app.requestSingleInstanceLock())
    app.quit();

// --- the server ----------------------------------------------------------------------------

/** The Butler client, or an error that opens Settings if it isn't set up yet. */
function butler() {
    const config = loadConfig(configDir());
    if (!config) {
        openSettings();
        throw new Error('set your Butler address and token first (Settings is open)');
    }
    return new Butler(config);
}

// --- the pet's window -------------------------------------------------------------------------

function loadSpot(area) {
    try {
        const {right, bottom} = JSON.parse(fs.readFileSync(spotFile(), 'utf8'));
        if (Number.isFinite(right) && Number.isFinite(bottom))
            return {x: Math.round(area.x + area.width - WIN_W - right), y: Math.round(area.y + area.height - WIN_H - bottom)};
    } catch {
        // never moved yet
    }
    return {x: area.x + area.width - WIN_W, y: area.y + area.height - WIN_H};
}

function createPet() {
    const area = screen.getPrimaryDisplay().workArea;
    const {x, y} = loadSpot(area);
    pet = new BrowserWindow({
        width: WIN_W, height: WIN_H, x, y,
        frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
        backgroundColor: '#00000000',
        webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false},
    });
    pet.setAlwaysOnTop(true, 'screen-saver');
    pet.setVisibleOnAllWorkspaces(true);
    pet.setIgnoreMouseEvents(true, {forward: true}); // clicks pass through, except on the pet, bubble and menu
    pet.loadFile(path.join(here, 'pet.html'));
    pet.once('ready-to-show', () => pet.showInactive());
    pet.webContents.on('will-navigate', e => e.preventDefault());
    pet.webContents.setWindowOpenHandler(({url}) => {
        if (safeLink(url))
            shell.openExternal(url);
        return {action: 'deny'};
    });
}

/** Tells the pet's page what to show: see pet.js for each `type`. */
function ui(type, payload = {}) {
    pet?.webContents.send('ui', {type, ...payload});
}

function working(text, heading = 'This computer • Working', stop = false) {
    ui('working', {text, heading, stop});
}

function result(text, ok = true, heading = `This computer • ${ok ? 'Complete' : 'Failed'}`) {
    ui('result', {text, ok, heading, reply: true});
}

/** Something to say that isn't a job, like a note from your phone. `tap` runs when it's clicked. */
let noteTap = null;
function note(title, text, tap = null) {
    noteTap = tap;
    if (!busy)
        ui('note', {title, text, tappable: Boolean(tap)});
    if (Notification.isSupported()) {
        const n = new Notification({title: `Butler: ${title}`, body: text.slice(0, 250), silent: true});
        if (tap)
            n.on('click', () => tap());
        n.show();
    }
}

/** Shows `label` while `action` runs, then its answer (or what went wrong) in the bubble. */
async function work(label, action, clip = 'work') {
    if (busy)
        return;
    busy = true;
    stopRequested = false;
    ui('menu', {open: false});
    ui('play', {clip});
    working(label);
    try {
        const done = await action();
        ui('play', {clip: 'success'});
        result(done || 'done.', true);
    } catch (e) {
        ui('play', {clip: 'error'});
        result(`That didn't go through: ${e.message}`, false);
    } finally {
        busy = false;
    }
}

/** Shows what Butler said with `yes` and Cancel under it, and waits (Cancel after 2 minutes). */
function confirm(say, yes) {
    ui('confirm', {text: say, yes});
    return new Promise(resolve => {
        const timer = setTimeout(() => answer?.(false), 120_000);
        answer = ok => {
            clearTimeout(timer);
            answer = null;
            resolve(ok);
        };
    });
}

// --- what's on screen ---------------------------------------------------------------------

/**
 * A screenshot of the screen you're on, without the pet, as a JPEG no wider than 1600 pixels.
 * Windows lets an app see the whole screen, not one window, so that's what Butler gets.
 */
async function snap() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = Math.min(1, 1600 / (display.size.width * display.scaleFactor));
    pet?.setOpacity(0);
    await sleep(150);
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(display.size.width * display.scaleFactor * scale),
                height: Math.round(display.size.height * display.scaleFactor * scale),
            },
        });
        const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0];
        const jpeg = source?.thumbnail.toJPEG(80);
        if (!jpeg?.length || source.thumbnail.isEmpty())
            throw new Error("couldn't take a screenshot of this screen");
        return {field: 'file', name: 'screenshot.jpg', type: 'image/jpeg', data: jpeg};
    } finally {
        pet?.setOpacity(1);
    }
}

/** What you've selected in the app you're in, copied with Ctrl+C. Empty if nothing is selected. */
async function copySelection() {
    const before = clipboard.readText();
    clipboard.writeText('');
    await press(COPY);
    await sleep(250);
    const copied = clipboard.readText().trim();
    if (!copied && before)
        clipboard.writeText(before);
    return copied;
}

// --- the menu's actions -------------------------------------------------------------------------

const actions = {
    save: () => work('Saving this…', async () => {
        const b = butler();
        const text = await copySelection();
        const shot = await snap().catch(() => null);
        if (!text && !shot)
            throw new Error('nothing selected to save');
        const link = /^https?:\/\/\S+$/.test(text) ? text : undefined;
        await b.send('/api/save', {device: b.device, text: text || undefined, url: link}, shot ? [shot] : []);
        return link ? 'Saved the link to Butler' : 'Saved to Butler';
    }),

    copy: () => work('Copying…', async () => {
        if (!await copySelection())
            throw new Error('select something first');
        return 'Copied';
    }),

    analyze: () => look('analyze'),
    solve: () => look('solve'),
    translate: () => look('translate'),

    act: () => work('Reading your screen…', async () => {
        const b = butler();
        const r = await b.send('/api/screen/act', {device: b.device, kind: 'laptop', tz: timeZone()}, [await snap()]);
        if (!r.confirm)
            return r.say || 'nothing to act on here.';
        if (!await confirm(r.say, 'Do it'))
            return 'Left it. Nothing was done.';
        working('On it…');
        const done = await b.send('/api/command/confirm', {confirm: r.confirm});
        const draft = done.steps?.find(s => s.action === 'draft');
        return draft ? `${done.say}\n\n${await typeDraft(b, draft.instruction)}` : done.say;
    }, 'think'),

    draft: () => work('Reading the chat and writing a draft…', () => typeDraft(butler(), 'help me respond'), 'think'),

    sendPhone: () => work('Sending…', async () => {
        const b = butler();
        const selected = await copySelection();
        if (selected) {
            await b.send('/api/send', {device: b.device, target: 'phone', kind: /^https?:\/\/\S+$/.test(selected) ? 'link' : 'clip',
                text: selected, url: /^https?:\/\/\S+$/.test(selected) ? selected : undefined});
            return 'Sent to your phone, ready to paste';
        }
        await b.send('/api/send', {device: b.device, target: 'phone', kind: 'file'}, [await snap()]);
        return 'Nothing was selected, so I sent a screenshot of this screen to your phone';
    }),

    sendFiles: async () => {
        const picked = await dialog.showOpenDialog({title: 'Send files to your phone', properties: ['openFile', 'multiSelections']});
        if (picked.canceled || !picked.filePaths.length)
            return;
        await work(`Sending ${picked.filePaths.length === 1 ? path.basename(picked.filePaths[0]) : `${picked.filePaths.length} files`}…`, async () => {
            const to = await sendFiles(butler(), picked.filePaths, 'phone', (sent, total) => {
                ui('progress', {fraction: total ? sent / total : 1, detail: `${Math.round(100 * sent / (total || 1))}% · ${mb(sent)} of ${mb(total)}`});
            }, () => stopRequested);
            return `Sent to ${to.join(', ')}. They're in its Downloads.`;
        });
    },

    ringPhone: () => work('Ringing your phone…', async () => {
        const b = butler();
        await b.send('/api/send', {device: b.device, target: 'phone', kind: 'ring'});
        return 'your phone rings within 20 seconds, even on silent.';
    }),

    library: () => {
        const config = loadConfig(configDir());
        if (config)
            shell.openExternal(config.url.replace(/\/api\/save\/?$/, '/'));
        else
            openSettings();
    },

    toggleSync: () => setSync(!syncOn),
    settings: () => openSettings(),
};

function look(mode) {
    return work({solve: 'Working it out…', translate: 'Translating…'}[mode] ?? 'Looking at your screen…', async () => {
        const b = butler();
        const {answer: said} = await b.send('/api/screen/look', {mode}, [await snap()]);
        clipboard.writeText(said);
        return `${said}\n\n(Copied, so you can paste it.)`;
    }, 'think');
}

/**
 * Writes a reply for the chat on screen and pastes it where your cursor is (click the chat's
 * message box first). It stays on the clipboard, and it's never sent: you press Enter.
 */
async function typeDraft(b, instruction) {
    const r = await b.send('/api/screen/draft', {device: b.device, kind: 'laptop', instruction, tz: timeZone()}, [await snap()]);
    if (!r.text)
        throw new Error(r.error ?? "couldn't write anything for that chat. try again, or tell me what to say");
    clipboard.writeText(r.text);
    lastSynced = r.text; // a draft isn't sent to the phone's clipboard
    await sleep(120);
    await press(PASTE);
    return `${r.text}\n\nPasted where your cursor was, and it's on your clipboard. Read it over, then send it yourself. Reply here to change it, like "shorter".`;
}

/** Asks Butler (typed, or a voice clip) and does the part of its answer that happens here. */
async function command(fields, voice = null) {
    const b = butler();
    const shot = await snap().catch(() => null);
    const files = [shot, voice].filter(Boolean);
    const r = await b.send('/api/command', {device: b.device, kind: 'laptop', tz: timeZone(), ...fields}, files);
    if (r.heard)
        working(`“${r.heard}”\n\nWorking…`);
    if (r.action === 'draft' && r.instruction)
        return typeDraft(b, r.instruction);
    if (r.message)
        return handoff(r.message, r.say);
    if (r.goal)
        return `${r.say ? `${r.say}\n\n` : ''}Doing things on screen isn't on the Windows pet yet. Ask on your phone, or do it yourself for now.`;
    if (safeLink(r.open))
        shell.openExternal(r.open);
    if (r.confirm) {
        if (!await confirm(r.say, 'Send'))
            return 'Not sent. Nothing left this computer.';
        working('Sending…');
        return (await b.send('/api/command/confirm', {confirm: r.confirm})).say;
    }
    if (r.send)
        return sendContent(b, r.send, shot, r.say);
    return r.say;
}

/** WhatsApp or Telegram on the web, with the message typed in. You press Send. */
function handoff({app: where, name, phone, text}, say) {
    const digits = phone?.replace(/[^\d]/g, '');
    const url = where === 'telegram'
        ? `https://t.me/share/url?url=${encodeURIComponent(text)}`
        : `https://web.whatsapp.com/send?${digits ? `phone=${digits}&` : ''}text=${encodeURIComponent(text)}`;
    shell.openExternal(url);
    const app = where === 'telegram' ? 'Telegram' : 'WhatsApp';
    return `${say ? `${say}\n\n` : ''}Opened ${app} with the message. ${digits && where !== 'telegram' ? 'Check it and press Send.' : `Pick ${name}, then press Send.`}`;
}

/** "send what I copied to my phone", "send this page"… */
async function sendContent(b, {target, content, text}, shot, say) {
    const fields = {device: b.device, target};
    if (content === 'screen') {
        if (!shot)
            throw new Error("couldn't take a screenshot to send");
        await b.send('/api/send', {...fields, kind: 'file'}, [shot]);
    } else if (content === 'clipboard' || content === 'link') {
        const copied = clipboard.readText().trim();
        if (!copied)
            throw new Error(content === 'link' ? 'copy the page\'s link first (Ctrl+L, then Ctrl+C)' : 'copy something first');
        const isLink = /^https?:\/\/\S+$/.test(copied);
        await b.send('/api/send', {...fields, kind: isLink ? 'link' : 'clip', text: copied, url: isLink ? copied : undefined});
    } else {
        if (!text)
            throw new Error('nothing to send');
        await b.send('/api/send', {...fields, kind: 'note', text});
    }
    return say || `Sent to your ${target}.`;
}

const mb = n => `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;

// --- what arrives from Butler -------------------------------------------------------------------

async function inboxLoop() {
    for (;;) {
        const config = loadConfig(configDir());
        if (!config) {
            await sleep(RETRY_MS);
            continue;
        }
        const b = new Butler(config);
        try {
            const messages = await b.send('/api/inbox', {device: b.device, kind: 'laptop', wait: String(INBOX_WAIT)}, [],
                {timeoutMs: (INBOX_WAIT + 20) * 1000});
            for (const message of inOrder(messages)) {
                await deliver(b, message).catch(e => console.warn(`Butler: couldn't handle a ${message.kind}: ${e.message}`));
            }
        } catch {
            await sleep(RETRY_MS); // offline, or the server is restarting
        }
    }
}

async function deliver(b, message) {
    const shown = describe(message, b.device);
    switch (shown.silent) {
    case 'clipboard':
        lastSynced = shown.clip; // so it isn't sent straight back
        clipboard.writeText(shown.clip);
        return;
    case 'ring':
        return ringHere(message.from_device);
    case 'stop':
        stopRequested = true;
        return;
    case 'task':
        // Remote control (Claude Code on this computer, from your phone) isn't on Windows yet: say so.
        return b.send('/api/laptop/status', {device: b.device, state: 'refused', job: message.job ?? '',
            text: "Remote control isn't on the Windows pet yet. Use the Linux laptop for that for now."});
    case 'transfer': {
        const transfer = JSON.parse(message.body ?? '{}');
        const saved = await receiveFiles(b, transfer, downloads(), (got, total) => {
            if (!busy)
                ui('working', {text: `Receiving from ${message.from_device}…`, heading: 'This computer • Receiving', progress: {fraction: total ? got / total : 1}});
        });
        return note(`Files from ${message.from_device}`, `Saved ${saved.length === 1 ? path.basename(saved[0]) : `${saved.length} files`} to Downloads\\Butler.\n\n(Tap to open the folder.)`,
            () => shell.showItemInFolder(saved[0]));
    }
    case 'file': {
        const file = await b.download(message.item_id, downloads());
        return note(`File from ${message.from_device}`, `Saved to Downloads\\Butler\\${path.basename(file)}\n\n(Tap to open it.)`,
            () => shell.openPath(file));
    }
    case 'status':
        return;
    default:
        break;
    }
    if (shown.clip) {
        lastSynced = shown.clip;
        clipboard.writeText(shown.clip);
    }
    const tap = shown.tap?.open ? () => shell.openExternal(shown.tap.open)
        : shown.tap?.copy ? () => {
            clipboard.writeText(shown.tap.copy);
            lastSynced = shown.tap.copy; // a code isn't sent back to the phone
        } : null;
    note(shown.title, shown.text, tap);
}

/** Rings here for a minute, until the pet is tapped. The sound plays in the pet's page. */
async function ringHere(from) {
    if (ringing)
        return;
    ringing = true;
    note('right here 🙋', `Butler is ringing this computer${from ? ` for ${from}` : ''}. Tap the pet to stop.`);
    ui('ring', {on: true});
    const until = Date.now() + 60_000;
    while (ringing && Date.now() < until)
        await sleep(500);
    stopRinging();
}

function stopRinging() {
    ringing = false;
    ui('ring', {on: false});
}

// --- clipboard sync ---------------------------------------------------------------------------

function setSync(on) {
    syncOn = on;
    try {
        if (on)
            fs.writeFileSync(syncFile(), '');
        else
            fs.rmSync(syncFile(), {force: true});
    } catch {
        // it just won't be remembered
    }
    lastSynced = clipboard.readText(); // what's already there stays here
    refreshTray();
    ui('sync', {on});
}

async function syncLoop() {
    for (;;) {
        await sleep(SYNC_EVERY_MS);
        if (!syncOn)
            continue;
        const text = clipboard.readText();
        if (!text.trim() || text === lastSynced || text.length > SYNC_MAX)
            continue;
        lastSynced = text;
        const config = loadConfig(configDir());
        if (!config)
            continue;
        const b = new Butler(config);
        await b.send('/api/send', {device: b.device, target: 'phone', kind: 'sync', text})
            .catch(e => console.warn(`Butler: clipboard sync failed: ${e.message}`));
    }
}

// --- settings, tray and updates ---------------------------------------------------------------

function openSettings() {
    if (settings) {
        settings.focus();
        return;
    }
    settings = new BrowserWindow({
        width: 460, height: 520, title: 'Butler settings', resizable: false, autoHideMenuBar: true,
        icon: path.join(petsDir(), 'peek.png'),
        webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false},
    });
    settings.loadFile(path.join(here, 'settings.html'));
    settings.on('closed', () => {
        settings = null;
    });
}

function refreshTray() {
    tray?.setContextMenu(Menu.buildFromTemplate([
        {label: 'Show Butler', click: () => pet?.showInactive()},
        {label: 'Hide Butler', click: () => pet?.hide()},
        {type: 'separator'},
        {label: `Clipboard sync: ${syncOn ? 'on' : 'off'}`, click: () => setSync(!syncOn)},
        {label: 'Settings…', click: openSettings},
        {label: 'Check for updates', click: () => checkUpdates(true)},
        {type: 'separator'},
        {label: 'Quit Butler', click: () => app.quit()},
    ]));
}

/**
 * New versions come from the GitHub releases (electron-updater): downloaded in the background
 * and installed when Butler next quits. While the repository is private this can't reach them,
 * so it says so only when you asked.
 */
async function checkUpdates(asked = false) {
    if (!app.isPackaged)
        return;
    try {
        const found = await autoUpdater.checkForUpdatesAndNotify();
        if (asked && !found?.updateInfo)
            note('Updates', 'You have the newest Butler.');
    } catch (e) {
        if (asked)
            note('Updates', `Couldn't check for updates: ${e.message.split('\n')[0]}. Run update-pet.ps1, or get the newest installer from the Releases page.`);
    }
}

// --- the page's messages --------------------------------------------------------------------------

ipcMain.handle('pets', () => {
    const dir = petsDir();
    return {dir: `file:///${dir.replace(/\\/g, '/')}`, clips: JSON.parse(fs.readFileSync(path.join(dir, 'clips.json'), 'utf8'))};
});
ipcMain.on('mouse', (_e, over) => pet?.setIgnoreMouseEvents(!over, {forward: true}));
ipcMain.on('typing', (_e, on) => {
    // Typing needs the keyboard, so the pet's window may take the focus until you're done.
    if (!pet)
        return;
    pet.setFocusable(on);
    if (on)
        pet.focus();
    else
        pet.blur();
});
ipcMain.on('drag', (_e, {dx, dy}) => {
    if (!pet)
        return;
    const [x, y] = pet.getPosition();
    pet.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('dropped', () => {
    if (!pet)
        return;
    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    const [x, y] = pet.getPosition();
    try {
        fs.mkdirSync(configDir(), {recursive: true});
        fs.writeFileSync(spotFile(), JSON.stringify({right: area.x + area.width - WIN_W - x, bottom: area.y + area.height - WIN_H - y}));
    } catch {
        // it just won't be remembered
    }
});
ipcMain.on('action', (_e, name) => actions[name]?.());
ipcMain.on('ask', (_e, {text, replyTo}) => {
    const said = String(text ?? '').trim().slice(0, 2000);
    if (said)
        work('Working…', () => command(replyTo ? {text: said, reply_to: String(replyTo).slice(0, 4000)} : {text: said}), 'think');
});
ipcMain.on('voice', (_e, {data, type}) => {
    const clean = String(type ?? 'audio/webm').split(';')[0];
    work('Working…', () => command({}, {field: 'audio', name: 'voice.webm', type: clean, data: Buffer.from(data)}), 'think');
});
ipcMain.on('answer', (_e, yes) => answer?.(Boolean(yes)));
ipcMain.on('stop', () => {
    stopRequested = true;
    stopRinging();
});
ipcMain.on('tapped-note', () => {
    const tap = noteTap;
    noteTap = null;
    tap?.();
});
ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('settings:load', () => loadConfig(configDir()) ?? {url: '', token: '', device: 'laptop'});
ipcMain.handle('settings:save', (_e, values) => {
    const saved = saveConfig(configDir(), values);
    settings?.close();
    note('Settings saved', `This computer talks to ${saved.url.replace(/\/api\/save\/?$/, '')} as "${saved.device}".`);
    return true;
});

// --- start ---------------------------------------------------------------------------------------

app.on('second-instance', () => pet?.showInactive());
app.on('window-all-closed', () => {
    // Settings closing mustn't quit the pet; Quit is in the tray menu.
});

app.whenReady().then(() => {
    app.setAppUserModelId('dev.butler.desktop'); // so Windows shows "Butler" on its notifications
    // The microphone, for Talk to Butler; nothing else is asked for.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
    if (app.isPackaged && !app.getLoginItemSettings().openAtLogin)
        app.setLoginItemSettings({openAtLogin: true});
    syncOn = fs.existsSync(syncFile());
    lastSynced = clipboard.readText();
    tray = new Tray(nativeImage.createFromPath(path.join(petsDir(), 'peek.png')).resize({width: 16, height: 16}));
    tray.setToolTip('Butler');
    tray.on('click', () => (pet?.isVisible() ? pet.hide() : pet?.showInactive()));
    refreshTray();
    createPet();
    if (!loadConfig(configDir()))
        openSettings();
    inboxLoop();
    syncLoop();
    checkUpdates();
    setInterval(() => checkUpdates(), UPDATE_EVERY_MS);
});
