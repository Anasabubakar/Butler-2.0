// Butler's desktop pet: peeks from the bottom-right corner, hops out when
// tapped, and saves or copies what you're looking at.
//
// It lives inside GNOME Shell, which is what lets it stay on top of every
// window and press keys for you on Wayland.
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ClipboardHistory} from './history.js';
import {HistoryPanel} from './historypanel.js';

// The Little Butler's desktop size (design/little-butler/docs/BEHAVIOR.md).
const PET_W = 88;
const PET_H = 110;
// While peeking, only the top of the peek pose shows: its head, eyes and fingers on the edge.
const PEEK_TOP = 40;    // where its head starts, in pet pixels
const PEEK_H = 60;      // down to just below its fingers
const EDGE = 40;        // gap from the right edge while peeking
const HOP_X = 56;       // how far it moves left when it wakes up
const HOP_Y = 118;      // how far it moves up
const INBOX_EVERY = 20;  // seconds between checks for reminders and things sent here
const DOWNLOADS = GLib.build_filenamev([GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ?? GLib.get_home_dir(), 'Butler']);
// Clipboard sync is on while this file exists; the menu button makes and removes it.
const SYNC_FLAG = GLib.build_filenamev([GLib.get_user_config_dir(), 'butler', 'clipboard-sync']);
const SYNC_MAX = 20000; // characters; bigger copies stay on the laptop
const RING_SOUND = '/usr/share/sounds/freedesktop/stereo/phone-incoming-call.oga';
const syncLabel = on => `Clipboard sync: ${on ? 'on' : 'off'}`;
// Opens the clipboard history; "historyKey" in pet.json changes it.
const HISTORY_KEY = '<Super><Shift>v';
// Terminals paste with Ctrl+Shift+V.
const TERMINALS = ['terminal', 'ptyxis', 'kitty', 'alacritty', 'wezterm', 'tilix', 'konsole', 'terminator', 'foot', 'ghostty'];
const BROWSERS = ['firefox', 'google-chrome', 'chromium', 'brave-browser', 'microsoft-edge', 'vivaldi', 'opera'];

// Feed pages, where the address bar shows the feed rather than the post you're looking at.
const FEEDS = [
    /^https?:\/\/(www\.)?tiktok\.com\/(foryou|following|explore)?\/?([?#].*)?$/,
    /^https?:\/\/(www\.)?(x|twitter)\.com\/(home|explore)\/?([?#].*)?$/,
    /^https?:\/\/(www\.)?instagram\.com\/(explore\/?)?([?#].*)?$/,
    /^https?:\/\/(www\.|web\.)?facebook\.com\/(watch\/?)?([?#].*)?$/,
    /^https?:\/\/(www\.)?linkedin\.com\/feed\/?([?#].*)?$/,
    /^https?:\/\/(www\.)?youtube\.com\/?([?#].*)?$/,
    /^https?:\/\/(www\.)?threads\.(net|com)\/?([?#].*)?$/,
];
const isFeed = url => FEEDS.some(feed => feed.test(url));

/** This laptop's time zone, like Africa/Lagos, so "at 3pm" means your 3pm. */
function timeZone() {
    const id = GLib.TimeZone.new_local().get_identifier();
    if (/^[A-Za-z]+\/[A-Za-z_+-]+/.test(id))
        return id;
    try {
        return GLib.file_read_link('/etc/localtime').split('zoneinfo/')[1] ?? 'UTC';
    } catch (e) {
        return 'UTC';
    }
}

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

/** Reads ~/.config/butler/pet.json: {"url": "https://…/api/save", "token": "…"}. */
function loadConfig() {
    const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'butler', 'pet.json']);
    try {
        const [, bytes] = GLib.file_get_contents(path);
        const config = JSON.parse(new TextDecoder().decode(bytes));
        if (config.url && config.token)
            return config;
    } catch (e) {
        // fall through
    }
    return null;
}

// Where you last left the pet: its distance from the screen's right and bottom edges.
const SPOT_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'butler', 'pet-spot.json']);
const SNAP = 24;        // dropped this close to the bottom, it docks and peeks again

function loadSpot() {
    try {
        const [, bytes] = GLib.file_get_contents(SPOT_FILE);
        const {right, bottom} = JSON.parse(new TextDecoder().decode(bytes));
        if (Number.isFinite(right) && Number.isFinite(bottom))
            return {right, bottom};
    } catch (e) {
        // never moved yet
    }
    return {right: EDGE, bottom: 0};
}

function saveSpot(spot) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(SPOT_FILE), 0o700);
        GLib.file_set_contents(SPOT_FILE, JSON.stringify(spot));
    } catch (e) {
        console.error('butler-pet: could not remember where the pet is', e);
    }
}

export default class ButlerPetExtension extends Extension {
    enable() {
        this._session = new Soup.Session({timeout: 30});
        const seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        // Made once and kept: a pointer made at the moment of use drops its first events.
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._awake = false;
        this._busy = false;
        this._peeking = false;
        this._clipId = 0;
        this._clips = this._loadClips();
        this._spot = loadSpot();
        this._drag = null;

        this._pet = new St.Widget({
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            width: PET_W,
            height: PEEK_H,
            accessible_name: 'Butler',
        });
        this._face = new St.Bin({width: PET_W, height: PET_H, style_class: 'butler-face'});
        this._pet.add_child(this._face);
        // Press and move to drag it anywhere; a press without moving is a tap.
        this._pet.connect('button-press-event', (_actor, event) => {
            if (this._busy || event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const [px, py] = event.get_coords();
            this._drag = {px, py, x: this._pet.x, y: this._pet.y, moved: false, grab: global.stage.grab(this._pet)};
            return Clutter.EVENT_STOP;
        });
        this._pet.connect('motion-event', (_actor, event) => {
            if (!this._drag)
                return Clutter.EVENT_PROPAGATE;
            const [px, py] = event.get_coords();
            const dx = px - this._drag.px, dy = py - this._drag.py;
            if (!this._drag.moved && Math.hypot(dx, dy) < 8)
                return Clutter.EVENT_STOP;
            if (!this._drag.moved)
                this._startDrag();
            const monitor = Main.layoutManager.primaryMonitor;
            this._pet.set_position(
                Math.min(Math.max(this._drag.x + dx, monitor.x), monitor.x + monitor.width - PET_W),
                Math.min(Math.max(this._drag.y + dy, monitor.y), monitor.y + monitor.height - PET_H));
            return Clutter.EVENT_STOP;
        });
        this._pet.connect('button-release-event', () => {
            const drag = this._drag;
            this._drag = null;
            drag?.grab.dismiss();
            if (drag?.moved)
                this._endDrag();
            else
                this._toggle();
            return Clutter.EVENT_STOP;
        });
        this._pet.connect('touch-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_END)
                this._toggle();
            return Clutter.EVENT_STOP;
        });

        this._menu = new St.BoxLayout({vertical: true, style_class: 'butler-menu', visible: false});
        this._menu.add_child(new St.Label({text: 'What should I do?', style_class: 'butler-menu-title'}));
        for (const [label, run] of [
            ['Save this', () => this._saveThis()],
            ['Copy this', () => this._copyThis()],
            ['Analyze this', () => this._look('analyze')],
            ['Solve this', () => this._look('solve')],
            ['Translate this', () => this._look('translate')],
            ['Send to phone', () => this._sendToPhone()],
            ['Clipboard history', () => this._openHistory()],
            ['Ring my phone', () => this._ringPhone()],
            ['Talk to Butler', () => this._talk()],
        ]) {
            const button = new St.Button({label, style_class: 'butler-action', x_expand: true, can_focus: false});
            button.connect('clicked', () => run());
            this._menu.add_child(button);
        }

        // Clipboard sync: what you copy here lands on your phone's clipboard too. Off until you turn it on.
        this._syncOn = GLib.file_test(SYNC_FLAG, GLib.FileTest.EXISTS);
        this._syncButton = new St.Button({label: syncLabel(this._syncOn), style_class: 'butler-action', x_expand: true, can_focus: false});
        this._syncButton.connect('clicked', () => this._toggleSync());
        this._menu.add_child(this._syncButton);
        this._selection = global.display.get_selection();
        this._selectionId = this._selection.connect('owner-changed', (_selection, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._clipboardChanged();
        });

        // Clipboard history: every Ctrl+C, kept on this laptop. Super+Shift+V or the menu opens it.
        this._history = new ClipboardHistory();
        this._historyPanel = new HistoryPanel(this._history, clip => this._pasteFromHistory(clip));
        this._grabHistoryKey();

        // Ask Butler: always at the top of the menu. Click it, type what you want, press Enter.
        this._ask = new St.Entry({hint_text: 'Ask me anything…', style_class: 'butler-ask', can_focus: true, x_expand: true});
        // Typing only reaches the box once Butler holds the keyboard, so take it on click.
        this._ask.clutter_text.connect('button-press-event', () => {
            this._openAsk();
            return Clutter.EVENT_PROPAGATE;
        });
        this._ask.clutter_text.connect('activate', () => {
            const text = this._ask.text.trim();
            this._closeAsk();
            if (text)
                this._askButler(text);
        });
        this._ask.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this._closeAsk();
            this._goHome();
            return Clutter.EVENT_STOP;
        });
        this._menu.insert_child_at_index(this._ask, 1); // right under the title
        // Whenever the menu goes away, so does Butler's hold on the keyboard.
        this._menu.connect('notify::visible', () => {
            if (!this._menu.visible)
                this._closeAsk();
        });
        // While you're typing, a click anywhere outside the menu closes it.
        this._menu.connect('captured-event', (_actor, event) => {
            if (!this._askGrab || event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const [mx, my] = this._menu.get_transformed_position();
            const [w, h] = this._menu.get_transformed_size();
            if (x >= mx && x < mx + w && y >= my && y < my + h)
                return Clutter.EVENT_PROPAGATE;
            this._goHome();
            return Clutter.EVENT_STOP;
        });

        // Send / Cancel, for things that need your yes first, like an email.
        this._confirmBox = new St.BoxLayout({style_class: 'butler-menu', visible: false});
        for (const [label, yes] of [['Send', true], ['Cancel', false]]) {
            const button = new St.Button({label, style_class: 'butler-action', x_expand: true, can_focus: false});
            button.connect('clicked', () => this._answer?.(yes));
            this._confirmBox.add_child(button);
        }

        this._note = new St.Label({style_class: 'butler-note', visible: false, reactive: true});
        this._note.clutter_text.line_wrap = true;
        this._note.connect('button-release-event', () => {
            this._noteTapped?.();
            return Clutter.EVENT_STOP;
        });

        for (const actor of [this._menu, this._confirmBox, this._note, this._pet])
            Main.layoutManager.addTopChrome(actor);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place(false));
        this._rest();

        // Checks for reminders and things sent from your phone.
        this._checking = false;
        this._inboxId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INBOX_EVERY, () => {
            this._checkInbox();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        this._stopRinging();
        this._drag?.grab.dismiss();
        this._drag = null;
        this._closeAsk();
        if (this._inboxId)
            GLib.source_remove(this._inboxId);
        this._inboxId = 0;
        this._selection?.disconnect(this._selectionId);
        this._selection = null;
        if (this._copyId)
            GLib.source_remove(this._copyId);
        this._copyId = 0;
        this._releaseHistoryKey();
        this._historyPanel?.destroy();
        this._historyPanel = this._history = null;
        this._stopClip();
        Main.layoutManager.disconnect(this._monitorsId);
        this._answer?.(false);
        for (const actor of [this._menu, this._confirmBox, this._note, this._pet]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._pet = this._face = this._menu = this._note = this._ask = this._confirmBox = null;
        this._keyboard = this._pointer = null;
        this._session?.abort();
        this._session = null;
    }

    /** pets/clips.json, written by update-sprites.py: frame count, duration, loop and next clip. */
    _loadClips() {
        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([this.path, 'pets', 'clips.json']));
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    _show(...parts) {
        const file = GLib.build_filenamev([this.path, 'pets', ...parts]);
        this._face.style = `background-image: url("file://${file}"); background-size: contain;`;
    }

    _stopClip() {
        if (this._clipId)
            GLib.source_remove(this._clipId);
        this._clipId = 0;
    }

    /** Plays one of the kit's animations, then whatever it says comes next. */
    _play(name) {
        this._stopClip();
        const clip = this._clips[name];
        const frame = i => this._show(name, `${String(i).padStart(2, '0')}.png`);
        if (!St.Settings.get().enable_animations) {
            // Reduced motion: one still pose per state.
            frame(clip.loop ? 0 : clip.frames - 1);
            return;
        }
        let i = 0;
        frame(i);
        this._clipId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(clip.duration / clip.frames), () => {
            if (++i < clip.frames) {
                frame(i);
                return GLib.SOURCE_CONTINUE;
            }
            if (clip.loop && !(name === 'idle' && Math.random() < 0.4)) {
                frame(i = 0);
                return GLib.SOURCE_CONTINUE;
            }
            this._clipId = 0;
            // Now and then a blink between breaths; one-shot clips hand over to their next clip.
            const next = clip.loop ? 'blink' : clip.next;
            if (this._clips[next])
                this._play(next);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Back in the corner: just its eyes and fingers over the edge, breathing slowly. */
    _peek() {
        this._stopClip();
        this._peeking = true;
        this._show('peek.png');
        this._face.remove_all_transitions();
        this._face.translation_y = -PEEK_TOP;
        this._face.ease({
            translation_y: -PEEK_TOP + 2,
            duration: 1600,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
        this._place(false);
    }

    /** Shows the whole pet, still sitting on the bottom edge. */
    _unpeek() {
        this._peeking = false;
        this._face.remove_all_transitions();
        this._face.translation_y = 0;
        this._place(false);
    }

    /** Docked pets sit on the bottom edge and peek; anywhere else they stand. */
    _docked() {
        return this._spot.bottom <= 0;
    }

    /** Where the resting pet's top-left corner is. */
    _home(monitor) {
        return {
            x: Math.min(Math.max(monitor.x + monitor.width - this._spot.right - PET_W, monitor.x), monitor.x + monitor.width - PET_W),
            y: Math.min(Math.max(monitor.y + monitor.height - this._spot.bottom - PET_H, monitor.y), monitor.y + monitor.height - PET_H),
        };
    }

    _place(animate) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        let {x, y} = this._home(monitor);
        // A docked pet hops up and away from the edge when it wakes; elsewhere it stays put.
        if (this._awake && this._docked()) {
            x = Math.max(x - HOP_X, monitor.x);
            y -= HOP_Y;
        }
        const height = this._peeking ? PEEK_H : PET_H;
        if (this._peeking)
            y = monitor.y + monitor.height - PEEK_H;
        if (animate) {
            this._pet.ease({x, y, height, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        } else {
            this._pet.set_position(x, y);
            this._pet.height = height;
        }
        // The menu and notes sit beside the pet: on its left if there's room, else its right.
        const beside = width => (x - 12 - width >= monitor.x ? x - 12 - width : x + PET_W + 12);
        const within = (top, h) => Math.min(Math.max(top, monitor.y), monitor.y + monitor.height - h);
        const [, menuH] = this._menu.get_preferred_height(-1);
        const [, menuW] = this._menu.get_preferred_width(-1);
        this._menu.set_position(beside(menuW), within(y + PET_H - menuH, menuH));
        const [, boxH] = this._confirmBox.get_preferred_height(-1);
        const [, boxW] = this._confirmBox.get_preferred_width(-1);
        this._confirmBox.set_position(beside(boxW), within(y + PET_H + 8, boxH));
        // Notes grow upwards, so a long answer never covers the pet.
        const [, noteW] = this._note.get_preferred_width(-1);
        const [, noteH] = this._note.get_preferred_height(noteW);
        this._note.set_position(beside(noteW), within(y + 64 - noteH, noteH));
    }

    /** Settles down where it is: peeking on the bottom edge, or standing anywhere else. */
    _rest() {
        if (this._docked()) {
            this._peek();
        } else {
            this._play('idle');
            this._place(false);
        }
    }

    _startDrag() {
        this._drag.moved = true;
        this._awake = false;
        this._menu.hide();
        if (!this._busy)
            this._note.hide();
        if (this._peeking) {
            this._unpeek();
            this._drag.y = this._pet.y;
        }
        this._play('idle');
    }

    /** Stays where it was dropped, and remembers the spot for next time. */
    _endDrag() {
        const monitor = Main.layoutManager.primaryMonitor;
        const right = monitor.x + monitor.width - this._pet.x - PET_W;
        const bottom = monitor.y + monitor.height - this._pet.y - PET_H;
        this._spot = {right: Math.max(0, Math.round(right)), bottom: bottom < SNAP ? 0 : Math.round(bottom)};
        saveSpot(this._spot);
        this._rest();
    }

    _toggle() {
        if (this._ringing) {
            this._stopRinging();
            return;
        }
        if (this._stopRecording) {
            this._stopRecording();
            return;
        }
        if (this._operating) {
            this._operating.stop = true;
            this._say('Stopping…');
            return;
        }
        if (this._busy)
            return;
        if (this._awake) {
            this._goHome();
            return;
        }
        this._unpeek();
        this._awake = true;
        this._note.hide();
        this._closeAsk();
        this._menu.show();
        this._play('summon');
        this._place(true);
    }

    /** Goes back to its spot: sinks below the edge and peeks if docked, or just settles. */
    async _goHome() {
        this._awake = false;
        this._menu.hide();
        if (!this._docked()) {
            this._rest();
            return;
        }
        this._play('hide');
        this._place(true);
        await sleep(this._clips.hide.duration);
        if (this._pet && !this._awake)
            this._peek();
    }

    _say(text) {
        this._note.text = text;
        this._note.show();
        this._place(false);
    }

    /** Waits long enough to read the note (2 to 30 seconds), or until it's tapped. */
    _hold(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.min(30000, Math.max(2200, ms)), () => {
                this._noteTapped = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._noteTapped = () => {
                GLib.source_remove(id);
                this._noteTapped = null;
                resolve();
            };
        });
    }

    /** Wraps an action: hides the menu, shows a working face, then a result. */
    async _work(working, action, clip = 'work') {
        if (this._busy)
            return;
        this._busy = true;
        this._menu.hide();
        this._play(clip);
        this._say(working);
        try {
            const done = await action();
            this._play('success');
            this._say(done);
        } catch (e) {
            this._play('error');
            this._say(`Couldn't do that: ${e.message}`);
        }
        await this._hold(this._note.text.length * 50);
        if (!this._pet)
            return;
        this._note.hide();
        this._busy = false;
        this._goHome();
    }

    async _press(...keyvals) {
        const now = () => GLib.get_monotonic_time();
        for (const key of keyvals)
            this._keyboard.notify_keyval(now(), key, Clutter.KeyState.PRESSED);
        for (const key of keyvals.reverse())
            this._keyboard.notify_keyval(now(), key, Clutter.KeyState.RELEASED);
        await sleep(60);
    }

    /** Moves the mouse to (x, y) and clicks, with small gaps so every event lands. */
    async _click(x, y) {
        const now = () => GLib.get_monotonic_time();
        this._pointer.notify_absolute_motion(now(), x, y);
        await sleep(40);
        this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await sleep(40);
        this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await sleep(40);
    }

    _readClipboard() {
        return new Promise(resolve => St.Clipboard.get_default()
            .get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text ?? '')));
    }

    /**
     * Copies the current selection in the focused window. Empty if nothing is selected,
     * rather than whatever was copied earlier; the old clipboard is put back then.
     */
    async _copySelection() {
        const clipboard = St.Clipboard.get_default();
        const before = await this._readClipboard();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, '');
        await this._press(Clutter.KEY_Control_L, Clutter.KEY_c);
        await sleep(150);
        const copied = (await this._readClipboard()).trim();
        if (!copied && before)
            clipboard.set_text(St.ClipboardType.CLIPBOARD, before);
        return copied;
    }

    /**
     * A screenshot of the focused window, without the pet or its menu, as a JPEG no wider
     * than 1600 pixels (small enough to send quickly), plus where the window is on screen.
     * Null if there is no window.
     */
    async _snapWindow() {
        const window = global.display.focus_window;
        if (!window)
            return null;
        const stream = Gio.MemoryOutputStream.new_resizable();
        const area = await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_window(false, false, stream, (shot, result) => {
                try {
                    const [, captured] = shot.screenshot_window_finish(result);
                    stream.close(null);
                    resolve(captured);
                } catch (e) {
                    reject(new Error("couldn't take a screenshot"));
                }
            });
        });
        let pixbuf = GdkPixbuf.Pixbuf.new_from_stream(
            Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes()), null);
        if (pixbuf.get_width() > 1600) {
            const height = Math.round(pixbuf.get_height() * 1600 / pixbuf.get_width());
            pixbuf = pixbuf.scale_simple(1600, height, GdkPixbuf.InterpType.BILINEAR);
        }
        const [, jpeg] = pixbuf.save_to_bufferv('jpeg', ['quality'], ['85']);
        // The captured area is exactly what the picture shows, so clicks land where Gemini points.
        const rect = area?.width ? area : window.get_frame_rect();
        return {jpeg: new GLib.Bytes(jpeg), rect};
    }

    /** Asks Butler where `target` is on the screenshot and clicks it. False if it isn't there. */
    async _tapOn(config, shot, target) {
        const spot = await this._send(config, '/api/screen/locate', {target}, shot);
        if (!spot.found)
            return false;
        const {x, y, width, height} = shot.rect;
        await this._click(x + spot.x / 1000 * width, y + spot.y / 1000 * height);
        return true;
    }

    /**
     * On a feed, the address bar doesn't hold the post's link, so the pet taps the
     * post's Share button, then Copy link, and reads the link it copied. Null if that fails.
     */
    async _linkFromShare(config, pageUrl) {
        try {
            const shot = await this._snapWindow();
            if (!shot || !await this._tapOn(config, shot, 'the Share button of the main post in view'))
                return null;
            await sleep(900);
            const menu = await this._snapWindow();
            if (!await this._tapOn(config, menu, 'the "Copy link" option'))
                return null;
            await sleep(300);
            const link = (await this._readClipboard()).trim();
            return /^https?:\/\//.test(link) && link !== pageUrl ? link : null;
        } catch (e) {
            return null;
        } finally {
            await this._press(Clutter.KEY_Escape); // closes the share menu if it's still open
        }
    }

    _inBrowser() {
        const wmClass = global.display.focus_window?.get_wm_class()?.toLowerCase() ?? '';
        return BROWSERS.some(name => wmClass.includes(name));
    }

    /**
     * Saves a screenshot of the focused window, plus the page's link in a browser
     * (read from the address bar) or the selected text anywhere else.
     */
    _saveThis() {
        this._work('Grabbing it…', async () => {
            const config = loadConfig();
            if (!config)
                throw new Error('set your save URL and token in ~/.config/butler/pet.json');

            const shot = await this._snapWindow().catch(() => null);
            let text;
            if (this._inBrowser()) {
                await this._press(Clutter.KEY_Control_L, Clutter.KEY_l);
                text = await this._copySelection();
                await this._press(Clutter.KEY_Escape);
                if (isFeed(text)) {
                    this._say('Finding the Share button…');
                    text = await this._linkFromShare(config, text) ?? text;
                }
            } else {
                text = await this._copySelection();
            }
            if (!text && !shot)
                throw new Error('nothing selected to save');

            const fields = {device: 'laptop'};
            if (text)
                fields.text = text;
            await this._send(config, '/api/save', fields, shot);
            return /^https?:\/\//.test(text) ? 'Saved the link to Butler' : 'Saved to Butler';
        });
    }

    _copyThis() {
        this._work('Copying…', async () => {
            const text = await this._copySelection();
            if (!text)
                throw new Error('select something first');
            return 'Copied';
        });
    }

    /** Analyze this (mode=analyze) or Solve this (mode=solve): Butler looks at the window and answers. */
    _look(mode) {
        this._work({solve: 'Working it out…', translate: 'Translating…'}[mode] ?? 'Having a look…', async () => {
            const config = loadConfig();
            if (!config)
                throw new Error('set your save URL and token in ~/.config/butler/pet.json');
            const shot = await this._snapWindow();
            if (!shot)
                throw new Error('open the window you want me to look at');
            const {answer} = await this._send(config, '/api/screen/look', {mode}, shot);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, answer);
            return `${answer}\n\n(Copied, so you can paste it.)`;
        }, 'think');
    }

    // --- Ask Butler -------------------------------------------------------------------

    /** Shows the typing box and takes the keyboard until Enter or Escape. */
    _openAsk() {
        if (this._busy || this._askGrab)
            return;
        this._askGrab = Main.pushModal(this._menu);
        global.stage.set_key_focus(this._ask);
    }

    /** Hands the keyboard back to your apps and empties the box. */
    _closeAsk() {
        if (this._askGrab) {
            Main.popModal(this._askGrab);
            this._askGrab = null;
        }
        if (this._ask)
            this._ask.text = '';
    }

    /** Sends what you typed, plus a screenshot of the window you're on, and does what Butler decides. */
    _askButler(text) {
        this._work('On it…', async () => {
            const config = this._config();
            const shot = await this._snapWindow().catch(() => null);
            return this._doCommand(config, {text}, shot);
        }, 'think');
    }

    /**
     * Talk to Butler: records until you tap the pet or the note (or 20 seconds pass),
     * then sends the clip like a typed request.
     */
    _talk() {
        this._work('Listening… tap me when you\'re done', async () => {
            const config = this._config();
            const shot = await this._snapWindow().catch(() => null);
            const wav = await this._record();
            this._play('think');
            this._say('On it…');
            return this._doCommand(config, {}, shot, [{field: 'audio', name: 'voice.wav', mime: 'audio/wav', bytes: wav}]);
        }, 'summon');
    }

    /** Records the microphone to a WAV clip with PipeWire (or PulseAudio, or ALSA). */
    async _record() {
        const path = GLib.build_filenamev([GLib.get_user_runtime_dir(), `butler-voice-${Date.now()}.wav`]);
        const recorders = [
            ['pw-record', '--rate', '16000', '--channels', '1', path],
            ['parecord', '--rate=16000', '--channels=1', '--file-format=wav', path],
            ['arecord', '-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', path],
        ];
        const argv = recorders.find(([program]) => GLib.find_program_in_path(program));
        if (!argv)
            throw new Error('no audio recorder found (install pipewire-bin or pulseaudio-utils)');
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_SILENCE);
        await new Promise(resolve => {
            const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
                this._noteTapped = null;
                this._stopRecording = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._noteTapped = this._stopRecording = () => {
                GLib.source_remove(id);
                this._noteTapped = this._stopRecording = null;
                resolve();
            };
        });
        proc.send_signal(2); // like Ctrl+C, so the recorder finishes the file properly
        await new Promise(resolve => proc.wait_async(null, () => resolve()));
        try {
            const [, bytes] = GLib.file_get_contents(path);
            if (bytes.length < 8000)
                throw new Error("I didn't hear anything");
            return new GLib.Bytes(bytes);
        } finally {
            GLib.unlink(path);
        }
    }

    /** Asks Butler and does the part of its plan that happens on this laptop. */
    async _doCommand(config, fields, shot, files = []) {
        const result = await this._send(config, '/api/command',
            {device: 'laptop', kind: 'laptop', tz: timeZone(), ...fields}, shot, files);
        if (result.heard)
            this._say(`“${result.heard}”\n\nOn it…`);
        if (result.message)
            return this._handoff(result.message, shot, result.say);
        if (result.goal)
            return this._operate(config, result.goal);
        if (result.open)
            Gio.AppInfo.launch_default_for_uri(result.open, null);
        if (result.confirm) {
            this._say(result.say);
            if (!await this._confirm())
                return 'Okay, not sent.';
            this._say('Sending…');
            return (await this._send(config, '/api/command/confirm', {confirm: result.confirm})).say;
        }
        if (result.send) {
            const {sent_to: to} = await this._sendContent(config, result.send, shot);
            return result.say || `Sent to ${to.join(', ')}`;
        }
        return result.say;
    }

    // --- doing things on screen ----------------------------------------------------------

    /**
     * Works towards `goal` on the focused window one step at a time: a screenshot, Butler
     * picks the next click or keypress, the pet does it, repeat. Tap the pet to stop.
     */
    async _operate(config, goal) {
        const done = [];
        this._operating = {stop: false};
        try {
            for (let i = 1; i <= 15; i++) {
                if (this._operating.stop)
                    return 'Stopped.';
                const shot = await this._snapWindow();
                if (!shot)
                    throw new Error('open the window you want me to work in');
                const step = await this._send(config, '/api/screen/step',
                    {goal, done: JSON.stringify(done), kind: 'laptop'}, shot);
                if (step.do === 'done')
                    return step.say || 'Done.';
                if (step.do === 'stop')
                    return step.say || "I couldn't finish that.";
                if (this._operating.stop)
                    return 'Stopped.';
                this._say(`Step ${i}: ${step.say || step.do}\n\n(Tap me to stop.)`);
                await this._perform(step, shot.rect);
                done.push(`${step.do}${step.text ? ` "${step.text}"` : ''}${step.key ? ` ${step.key}` : ''}: ${step.say}`);
                await sleep(step.do === 'wait' ? 1500 : 800);
            }
            return 'I stopped after 15 steps. Take it from here.';
        } finally {
            this._operating = null;
        }
    }

    /** Does one step. Positions are on the 0 to 1000 grid over the window in `rect`. */
    async _perform(step, rect) {
        const at = (x, y) => [rect.x + x / 1000 * rect.width, rect.y + y / 1000 * rect.height];
        const now = () => GLib.get_monotonic_time();
        // The pet and its note mustn't catch the clicks.
        this._pet.reactive = false;
        this._note.hide();
        try {
            switch (step.do) {
            case 'click':
                await this._click(...at(step.x, step.y));
                break;
            case 'double_click':
                await this._click(...at(step.x, step.y));
                await this._click(...at(step.x, step.y));
                break;
            case 'long_press': {
                this._pointer.notify_absolute_motion(now(), ...at(step.x, step.y));
                await sleep(40);
                this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
                await sleep(700);
                this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
                break;
            }
            case 'type': {
                // Pasting types any language and symbol exactly; your clipboard is put back after.
                const clipboard = St.Clipboard.get_default();
                const before = await this._readClipboard();
                clipboard.set_text(St.ClipboardType.CLIPBOARD, step.text ?? '');
                await sleep(60);
                await this._press(Clutter.KEY_Control_L, Clutter.KEY_v);
                await sleep(200);
                clipboard.set_text(St.ClipboardType.CLIPBOARD, before);
                break;
            }
            case 'key': {
                const keys = {
                    enter: [Clutter.KEY_Return], tab: [Clutter.KEY_Tab], escape: [Clutter.KEY_Escape],
                    backspace: [Clutter.KEY_BackSpace], up: [Clutter.KEY_Up], down: [Clutter.KEY_Down],
                    left: [Clutter.KEY_Left], right: [Clutter.KEY_Right], page_up: [Clutter.KEY_Page_Up],
                    page_down: [Clutter.KEY_Page_Down], home: [Clutter.KEY_Home], back: [Clutter.KEY_Alt_L, Clutter.KEY_Left],
                }[step.key];
                if (keys)
                    await this._press(...keys);
                break;
            }
            case 'scroll': {
                const direction = {
                    up: Clutter.ScrollDirection.UP, down: Clutter.ScrollDirection.DOWN,
                    left: Clutter.ScrollDirection.LEFT, right: Clutter.ScrollDirection.RIGHT,
                }[step.direction ?? 'down'];
                this._pointer.notify_absolute_motion(now(), ...at(step.x ?? 500, step.y ?? 500));
                await sleep(40);
                for (let i = 0; i < 5; i++) {
                    this._pointer.notify_discrete_scroll(now(), direction, Clutter.ScrollSource.WHEEL);
                    await sleep(30);
                }
                break;
            }
            case 'drag': {
                const [fromX, fromY] = at(step.x, step.y);
                const [toX, toY] = at(step.x2 ?? step.x, step.y2 ?? step.y);
                this._pointer.notify_absolute_motion(now(), fromX, fromY);
                await sleep(40);
                this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
                for (let i = 1; i <= 12; i++) {
                    await sleep(25);
                    this._pointer.notify_absolute_motion(now(), fromX + (toX - fromX) * i / 12, fromY + (toY - fromY) * i / 12);
                }
                await sleep(40);
                this._pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
                break;
            }
            }
        } finally {
            if (this._pet) {
                this._pet.reactive = true;
                this._note.show();
            }
        }
    }

    /**
     * WhatsApp or Telegram: opens the chat in your browser with the message typed in, and
     * puts the screenshot on the clipboard if you wanted it sent. You press Send.
     */
    _handoff({app, name, phone, text, attach_screen: attach}, shot, say) {
        const enc = encodeURIComponent;
        const digits = phone?.replace(/[^\d]/g, '');
        const url = app === 'telegram'
            ? `https://t.me/share/url?url=${enc(text)}`
            : digits ? `https://web.whatsapp.com/send?phone=${digits}&text=${enc(text)}`
                : `https://web.whatsapp.com/send?text=${enc(text)}`;
        Gio.AppInfo.launch_default_for_uri(url, null);
        const where = app === 'telegram' ? 'Telegram' : 'WhatsApp';
        const who = digits || app === 'telegram' ? `pick ${name}` : `pick ${name} (I couldn't find their number)`;
        let extra = '';
        if (shot && attach) {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(Gio.MemoryInputStream.new_from_bytes(shot.jpeg), null);
            const [, png] = pixbuf.save_to_bufferv('png', [], []);
            St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(png));
            extra = ' Press Ctrl+V there to add the screenshot.';
        }
        const how = digits && app !== 'telegram' ? 'Check it and press Send.' : `${who[0].toUpperCase()}${who.slice(1)}, then press Send.`;
        return `${say ? `${say}\n\n` : ''}Opened ${where} with the message. ${how}${extra}`;
    }

    /** Shows Send / Cancel under the note and waits for your answer (Cancel after 2 minutes). */
    _confirm() {
        this._confirmBox.show();
        this._place(false);
        return new Promise(resolve => {
            let id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {
                id = 0;
                this._answer?.(false);
                return GLib.SOURCE_REMOVE;
            });
            this._answer = yes => {
                if (id)
                    GLib.source_remove(id);
                this._answer = null;
                this._confirmBox?.hide();
                resolve(yes);
            };
        });
    }

    // --- clipboard sync ----------------------------------------------------------------

    _toggleSync() {
        this._syncOn = !this._syncOn;
        try {
            if (this._syncOn) {
                GLib.mkdir_with_parents(GLib.path_get_dirname(SYNC_FLAG), 0o700);
                GLib.file_set_contents(SYNC_FLAG, '');
            } else {
                GLib.unlink(SYNC_FLAG);
            }
        } catch (e) {
            logError(e, 'Butler: clipboard sync setting');
        }
        this._syncButton.label = syncLabel(this._syncOn);
        this._say(this._syncOn
            ? 'Clipboard sync is on. What you copy here goes to your phone.\n\n(Passwords from password managers are skipped.)'
            : 'Clipboard sync is off.');
    }

    /** Something new was copied: keep it in the history and send it to the phone, once things settle. */
    _clipboardChanged() {
        if (this._busy) // the pet's own copying while it works isn't yours
            return;
        const types = this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
        if (types.includes('x-kde-passwordManagerHint'))
            return;
        if (this._copyId)
            GLib.source_remove(this._copyId);
        this._copyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._copyId = 0;
            this._history?.capture(this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD))
                .catch(e => console.warn(`Butler: clipboard history: ${e.message}`));
            if (this._syncOn)
                this._syncClipboard();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- clipboard history ---------------------------------------------------------------

    _openHistory() {
        this._menu.hide();
        this._goHome();
        this._historyPanel.open();
    }

    _grabHistoryKey() {
        const accelerator = loadConfig()?.historyKey ?? HISTORY_KEY;
        this._historyAction = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.NONE);
        if (this._historyAction === Meta.KeyBindingAction.NONE) {
            console.warn(`Butler: ${accelerator} is taken, so the clipboard history only opens from the pet's menu`);
            return;
        }
        this._historyBinding = Meta.external_binding_name_for_action(this._historyAction);
        Main.wm.allowKeybinding(this._historyBinding, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._acceleratorId = global.display.connect('accelerator-activated', (_display, action) => {
            if (action === this._historyAction)
                this._historyPanel.toggle();
        });
    }

    _releaseHistoryKey() {
        if (this._acceleratorId)
            global.display.disconnect(this._acceleratorId);
        this._acceleratorId = 0;
        if (this._historyBinding) {
            Main.wm.allowKeybinding(this._historyBinding, Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._historyAction);
        }
        this._historyBinding = null;
    }

    /** Puts a copy from the history back on the clipboard and pastes it into the window you were in. */
    async _pasteFromHistory(clip) {
        if (!this._history.copyBack(clip)) {
            this._say("That picture's file is gone, so I can't paste it.");
            return;
        }
        await sleep(150); // the panel lets go of the keyboard and your window gets it back
        const wmClass = global.display.focus_window?.get_wm_class()?.toLowerCase() ?? '';
        if (TERMINALS.some(name => wmClass.includes(name)))
            await this._press(Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v);
        else
            await this._press(Clutter.KEY_Control_L, Clutter.KEY_v);
    }

    async _syncClipboard() {
        const config = loadConfig();
        const text = await this._readClipboard();
        if (!config || !text.trim() || text.length > SYNC_MAX || text === this._lastSynced)
            return;
        this._lastSynced = text;
        try {
            await this._send(config, '/api/send', {device: 'laptop', target: 'phone', kind: 'sync', text});
        } catch (e) {
            // no phone yet, or offline: the next copy tries again
            console.warn(`Butler: clipboard sync failed: ${e.message}`);
        }
    }

    /**
     * Sends something to another device: what you copied ("clipboard"), the page you're
     * on ("link"), a screenshot ("screen") or words ("text").
     */
    async _sendContent(config, {target, content, text}, shot) {
        const fields = {device: 'laptop', target};
        if (content === 'screen') {
            if (!shot)
                throw new Error('open the window you want to send');
            return this._send(config, '/api/send', {...fields, kind: 'file'}, shot);
        }
        if (content === 'link') {
            const link = this._inBrowser() ? await this._addressBar() : '';
            if (!/^https?:\/\//.test(link))
                throw new Error('open the page you want to send in your browser');
            return this._send(config, '/api/send', {...fields, kind: 'link', url: link});
        }
        if (content === 'clipboard') {
            const copied = (await this._readClipboard()).trim();
            if (!copied)
                throw new Error('copy something first');
            return this._send(config, '/api/send', {...fields, kind: 'clip', text: copied});
        }
        if (!text)
            throw new Error('nothing to send');
        return this._send(config, '/api/send', {...fields, kind: 'note', text});
    }

    /** Send to phone: the page in a browser, else the selection, else a screenshot. */
    _sendToPhone() {
        this._work('Sending…', async () => {
            const config = this._config();
            const target = {target: 'phone'};
            if (this._inBrowser()) {
                await this._sendContent(config, {...target, content: 'link'});
                return 'Sent the page to your phone';
            }
            const selected = await this._copySelection();
            if (selected) {
                await this._sendContent(config, {...target, content: 'clipboard'});
                return 'Sent to your phone, ready to paste';
            }
            await this._sendContent(config, {...target, content: 'screen'}, await this._snapWindow());
            return 'Sent a screenshot to your phone';
        });
    }

    // --- "where's my phone?" (and laptop) --------------------------------------------------

    _ringPhone() {
        this._work('Ringing your phone…', async () => {
            await this._send(this._config(), '/api/send', {device: 'laptop', target: 'phone', kind: 'ring'});
            return 'Your phone will ring within 20 seconds, even on silent.';
        });
    }

    /** Rings here for a minute (unmuting first) until the pet is tapped. */
    async _ringHere(from) {
        if (this._ringing)
            return;
        this._ringing = true;
        Main.notify('Butler: I\'m here!', `Ringing your laptop${from}. Tap the pet to stop.`);
        this._spawn(['pactl', 'set-sink-mute', '@DEFAULT_SINK@', '0']);
        if (this._pet && !this._busy) {
            this._unpeek();
            this._play('summon');
            this._say('I\'m here! Tap me to stop.');
        }
        const until = Date.now() + 60000;
        while (this._ringing && this._pet && Date.now() < until) {
            this._ringer = this._spawn(['paplay', RING_SOUND]);
            if (!this._ringer)
                break; // no paplay: the notification and the pet will have to do
            await new Promise(resolve => this._ringer.wait_async(null, () => resolve()));
            this._ringer = null;
        }
        this._stopRinging();
    }

    _stopRinging() {
        if (!this._ringing)
            return;
        this._ringing = false;
        this._ringer?.force_exit();
        this._ringer = null;
        if (this._pet && !this._busy) {
            this._note.hide();
            this._goHome();
        }
    }

    /** Starts a program and returns it, or null if it isn't installed. */
    _spawn(argv) {
        try {
            return Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            return null;
        }
    }

    async _addressBar() {
        await this._press(Clutter.KEY_Control_L, Clutter.KEY_l);
        const text = await this._copySelection();
        await this._press(Clutter.KEY_Escape);
        return text;
    }

    _config() {
        const config = loadConfig();
        if (!config)
            throw new Error('set your save URL and token in ~/.config/butler/pet.json');
        return config;
    }

    // --- the inbox: reminders and things sent from your phone ---------------------

    async _checkInbox() {
        const config = loadConfig();
        if (!config || this._checking)
            return;
        this._checking = true;
        try {
            const messages = await this._send(config, '/api/inbox', {device: 'laptop', kind: 'laptop'});
            for (const message of messages)
                await this._deliver(config, message);
        } catch (e) {
            // offline or the server is restarting: try again next time
        } finally {
            this._checking = false;
        }
    }

    async _deliver(config, message) {
        const from = message.from_device === 'laptop' ? '' : ` from ${message.from_device}`;
        switch (message.kind) {
        case 'reminder':
            return this._announce('Reminder', message.body);
        case 'ring':
            this._ringHere(from);
            return;
        case 'sync':
            this._lastSynced = message.body ?? ''; // so it isn't sent straight back
            this._history?.addText(this._lastSynced, 'phone');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._lastSynced);
            return;
        case 'clip':
            this._history?.addText(message.body ?? '', 'phone');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, message.body ?? '');
            return this._announce(`Copied${from}`, `${(message.body ?? '').slice(0, 200)}\n\n(Ready to paste.)`);
        case 'link':
            return this._announce(`Link${from}`, `${message.url}\n\n(Tap to open it.)`,
                () => Gio.AppInfo.launch_default_for_uri(message.url, null));
        case 'file': {
            const path = await this._download(config, message.item_id);
            return this._announce(`File${from}`, `Saved to ${path.replace(GLib.get_home_dir(), '~')}\n\n(Tap to open it.)`,
                () => Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(path, null), null));
        }
        default:
            return this._announce(`Note${from}`, message.body ?? message.url ?? '');
        }
    }

    /** A desktop notification, plus the pet saying it if it isn't busy. Tapping the note runs `onTap`. */
    async _announce(title, text, onTap = null) {
        Main.notify(`Butler: ${title}`, text);
        if (this._busy || !this._pet)
            return;
        this._busy = true;
        this._menu.hide();
        this._unpeek();
        this._play('summon');
        this._say(`${title}: ${text}`);
        const tapped = await new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
                this._noteTapped = null;
                resolve(false);
                return GLib.SOURCE_REMOVE;
            });
            this._noteTapped = () => {
                GLib.source_remove(id);
                this._noteTapped = null;
                resolve(true);
            };
        });
        if (!this._pet)
            return;
        if (tapped)
            onTap?.();
        this._note.hide();
        this._busy = false;
        this._goHome();
    }

    /** Downloads a file sent here into ~/Downloads/Butler and returns its path. */
    _download(config, itemId) {
        const base = config.url.replace(/\/api\/save\/?$/, '');
        const message = Soup.Message.new('GET', `${base}/api/inbox/file/${itemId}`);
        message.request_headers.append('x-butler-token', config.token);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== 200)
                        throw new Error(`Butler answered ${message.get_status()}`);
                    const disposition = message.response_headers.get_one('content-disposition') ?? '';
                    const name = (disposition.match(/filename="([^"]+)"/)?.[1] ?? 'file').replace(/[/\\]/g, '_');
                    GLib.mkdir_with_parents(DOWNLOADS, 0o755);
                    const path = GLib.build_filenamev([DOWNLOADS, `${GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S')}-${name}`]);
                    GLib.file_set_contents(path, bytes.get_data());
                    resolve(path);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Posts a form to Butler (`path` like /api/save) and returns its JSON answer.
     * `files` are extra attachments: [{field, name, mime, bytes}].
     */
    _send(config, path, fields, shot = null, files = []) {
        const form = new Soup.Multipart('multipart/form-data');
        for (const [name, value] of Object.entries(fields))
            form.append_form_string(name, value);
        if (shot)
            form.append_form_file('file', 'screenshot.jpg', 'image/jpeg', shot.jpeg);
        for (const {field, name, mime, bytes} of files)
            form.append_form_file(field, name, mime, bytes);
        const base = config.url.replace(/\/api\/save\/?$/, '');
        const message = Soup.Message.new_from_multipart(`${base}${path}`, form);
        message.request_headers.append('x-butler-token', config.token);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                let body;
                try {
                    const bytes = session.send_and_read_finish(result);
                    body = JSON.parse(new TextDecoder().decode(bytes.get_data() ?? new Uint8Array()) || '{}');
                } catch (e) {
                    reject(new Error("couldn't reach Butler"));
                    return;
                }
                const status = message.get_status();
                if (status >= 200 && status < 300)
                    resolve(body);
                else if (status === 401)
                    reject(new Error('Butler refused the token'));
                else
                    reject(new Error(body.error ?? `Butler answered ${status}`));
            });
        });
    }
}
