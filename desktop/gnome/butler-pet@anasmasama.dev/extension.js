// Butler's desktop pet: peeks from the bottom-right corner, hops out when
// tapped, and saves or copies what you're looking at.
//
// It lives inside GNOME Shell, which is what lets it stay on top of every
// window and press keys for you on Wayland.
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// The Little Butler's desktop size (design/little-butler/docs/BEHAVIOR.md).
const PET_W = 88;
const PET_H = 110;
// While peeking, only the top of the peek pose shows: its head, eyes and fingers on the edge.
const PEEK_TOP = 40;    // where its head starts, in pet pixels
const PEEK_H = 60;      // down to just below its fingers
const EDGE = 40;        // gap from the right edge while peeking
const HOP_X = 56;       // how far it moves left when it wakes up
const HOP_Y = 118;      // how far it moves up
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
        ]) {
            const button = new St.Button({label, style_class: 'butler-action', x_expand: true, can_focus: false});
            button.connect('clicked', () => run());
            this._menu.add_child(button);
        }

        this._note = new St.Label({style_class: 'butler-note', visible: false, reactive: true});
        this._note.clutter_text.line_wrap = true;
        this._note.connect('button-release-event', () => {
            this._noteTapped?.();
            return Clutter.EVENT_STOP;
        });

        for (const actor of [this._menu, this._note, this._pet])
            Main.layoutManager.addTopChrome(actor);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place(false));
        this._rest();
    }

    disable() {
        this._drag?.grab.dismiss();
        this._drag = null;
        this._stopClip();
        Main.layoutManager.disconnect(this._monitorsId);
        for (const actor of [this._menu, this._note, this._pet]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._pet = this._face = this._menu = this._note = null;
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
        if (this._busy)
            return;
        if (this._awake) {
            this._goHome();
            return;
        }
        this._unpeek();
        this._awake = true;
        this._note.hide();
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

    /** Copies the current selection in the focused window. */
    async _copySelection() {
        await this._press(Clutter.KEY_Control_L, Clutter.KEY_c);
        await sleep(150);
        return (await this._readClipboard()).trim();
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
        this._work(mode === 'solve' ? 'Working it out…' : 'Having a look…', async () => {
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

    /** Posts a form to Butler (`path` like /api/save) and returns its JSON answer. */
    _send(config, path, fields, shot = null) {
        const form = new Soup.Multipart('multipart/form-data');
        for (const [name, value] of Object.entries(fields))
            form.append_form_string(name, value);
        if (shot)
            form.append_form_file('file', 'screenshot.jpg', 'image/jpeg', shot.jpeg);
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
