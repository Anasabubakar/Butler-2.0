// Butler's desktop pet: peeks from the bottom-right corner, hops out when
// tapped, and saves or copies what you're looking at.
//
// It lives inside GNOME Shell, which is what lets it stay on top of every
// window and press keys for you on Wayland.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PET_W = 84;
const PET_H = 96;
const PEEK_H = 52;      // how much shows while peeking: ears, eyes and paws
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
        this._keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._awake = false;
        this._busy = false;

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
        this._setMood('awake');
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
        this._place(false);
    }

    disable() {
        Main.layoutManager.disconnect(this._monitorsId);
        for (const actor of [this._menu, this._note, this._pet]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._pet = this._face = this._menu = this._note = null;
        this._keyboard = null;
        this._session?.abort();
        this._session = null;
    }

    _setMood(mood) {
        const file = GLib.build_filenamev([this.path, 'pets', `${mood}.svg`]);
        this._face.style = `background-image: url("file://${file}"); background-size: contain;`;
    }

    _place(animate) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const x = monitor.x + monitor.width - PET_W - EDGE - (this._awake ? HOP_X : 0);
        const y = monitor.y + monitor.height - (this._awake ? PET_H + HOP_Y : PEEK_H);
        const height = this._awake ? PET_H : PEEK_H;
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
        this._awake = !this._awake;
        this._note.hide();
        this._menu.visible = this._awake;
        this._place(true);
    }

    _goHome() {
        this._awake = false;
        this._menu.hide();
        this._setMood('awake');
        this._place(true);
    }

    _say(text) {
        this._note.text = text;
        this._note.show();
        this._place(false);
    }

    /** Wraps an action: hides the menu, shows a working face, then a result. */
    async _work(working, action) {
        if (this._busy)
            return;
        this._busy = true;
        this._menu.hide();
        this._setMood('working');
        this._say(working);
        try {
            const done = await action();
            this._setMood('done');
            this._say(done);
        } catch (e) {
            this._setMood('awake');
            this._say(`Couldn't do that: ${e.message}`);
        }
        await sleep(2200);
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

    _inBrowser() {
        const wmClass = global.display.focus_window?.get_wm_class()?.toLowerCase() ?? '';
        return BROWSERS.some(name => wmClass.includes(name));
    }

    /** In a browser: the page's link, read from the address bar. Elsewhere: the selected text. */
    _saveThis() {
        this._work('Grabbing it…', async () => {
            const config = loadConfig();
            if (!config)
                throw new Error('set your save URL and token in ~/.config/butler/pet.json');

            let text;
            if (this._inBrowser()) {
                await this._press(Clutter.KEY_Control_L, Clutter.KEY_l);
                text = await this._copySelection();
                await this._press(Clutter.KEY_Escape);
            } else {
                text = await this._copySelection();
            }
            if (!text)
                throw new Error('nothing selected to save');

            await this._post(config, {device: 'laptop', text});
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
        });
    }

    _post(config, fields) {
        const form = new Soup.Multipart('multipart/form-data');
        for (const [name, value] of Object.entries(fields))
            form.append_form_string(name, value);
        const message = Soup.Message.new_from_multipart(config.url, form);
        message.request_headers.append('x-butler-token', config.token);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    session.send_and_read_finish(result);
                    const status = message.get_status();
                    if (status >= 200 && status < 300)
                        resolve();
                    else
                        reject(new Error(status === 401 ? 'Butler refused the token' : `Butler answered ${status}`));
                } catch (e) {
                    reject(new Error("couldn't reach Butler"));
                }
            });
        });
    }
}
