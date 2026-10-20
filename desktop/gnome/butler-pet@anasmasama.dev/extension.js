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
        this._pet.connect('button-release-event', () => {
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
            ['Analyze this', () => this._soon()],
            ['Solve this', () => this._soon()],
        ]) {
            const button = new St.Button({label, style_class: 'butler-action', x_expand: true, can_focus: false});
            button.connect('clicked', () => run());
            this._menu.add_child(button);
        }

        this._note = new St.Label({style_class: 'butler-note', visible: false});

        for (const actor of [this._menu, this._note, this._pet])
            Main.layoutManager.addTopChrome(actor);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place(false));
        this._peek();
    }

    disable() {
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

    _place(animate) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const x = monitor.x + monitor.width - PET_W - EDGE - (this._awake ? HOP_X : 0);
        const height = this._peeking ? PEEK_H : PET_H;
        const y = monitor.y + monitor.height - height - (this._awake ? HOP_Y : 0);
        if (animate) {
            this._pet.ease({x, y, height, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        } else {
            this._pet.set_position(x, y);
            this._pet.height = height;
        }
        // The menu and notes sit to the left of the awake pet.
        const right = monitor.x + monitor.width - PET_W - EDGE - HOP_X - 12;
        const [, menuH] = this._menu.get_preferred_height(-1);
        const [, menuW] = this._menu.get_preferred_width(-1);
        this._menu.set_position(right - menuW, monitor.y + monitor.height - HOP_Y - menuH);
        const [, noteW] = this._note.get_preferred_width(-1);
        this._note.set_position(right - noteW, monitor.y + monitor.height - HOP_Y - PET_H + 20);
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

    /** Sinks below the edge, then peeks again. */
    async _goHome() {
        this._awake = false;
        this._menu.hide();
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
        await sleep(2200);
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
        await new Promise((resolve, reject) => {
            new Shell.Screenshot().screenshot_window(false, false, stream, (shot, result) => {
                try {
                    shot.screenshot_window_finish(result);
                    stream.close(null);
                    resolve();
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
        return {jpeg: new GLib.Bytes(jpeg), rect: window.get_frame_rect()};
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

    _soon() {
        this._work('One sec…', () => {
            throw new Error('this needs a vision model on your gateway. Coming next');
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
