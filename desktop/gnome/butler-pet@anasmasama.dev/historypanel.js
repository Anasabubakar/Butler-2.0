// The clipboard history panel: everything you copied, newest first, with search.
// Click a copy to paste it; tick copies to pin or delete several at once.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ordered, preview, search, when} from './cliplist.js';

const SHOW_MAX = 200; // rows at once; searching finds the rest

function iconButton(icon, accessibleName, onClick, styleClass = 'butler-history-icon') {
    const button = new St.Button({style_class: styleClass, can_focus: false, accessible_name: accessibleName,
        child: new St.Icon({icon_name: icon, icon_size: 16})});
    button.connect('clicked', () => onClick());
    return button;
}

function textButton(label, onClick) {
    const button = new St.Button({label, style_class: 'butler-history-button', can_focus: false});
    button.connect('clicked', () => onClick());
    return button;
}

export class HistoryPanel {
    /** `paste(clip)` puts a copy back on the clipboard and pastes it where you were. */
    constructor(history, paste) {
        this._history = history;
        this._paste = paste;
        this._selected = new Set();
        this._shown = [];

        this.actor = new St.BoxLayout({vertical: true, style_class: 'butler-history', visible: false, reactive: true});

        const header = new St.BoxLayout({style_class: 'butler-history-header'});
        header.add_child(new St.Label({text: 'Clipboard', style_class: 'butler-history-title', y_align: Clutter.ActorAlign.CENTER}));
        this._search = new St.Entry({hint_text: 'Search what you copied…', style_class: 'butler-ask', can_focus: true, x_expand: true});
        this._search.clutter_text.connect('text-changed', () => this._render());
        // Enter pastes the first match.
        this._search.clutter_text.connect('activate', () => {
            if (this._shown[0])
                this._choose(this._shown[0]);
        });
        this._search.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        header.add_child(this._search);
        this._pauseButton = textButton('', () => {
            this._history.setPaused(!this._history.paused);
        });
        header.add_child(this._pauseButton);
        header.add_child(iconButton('window-close-symbolic', 'Close', () => this.close()));
        this.actor.add_child(header);

        this._status = new St.Label({style_class: 'butler-history-status', visible: false});
        this.actor.add_child(this._status);

        // Shown while copies are ticked.
        this._bar = new St.BoxLayout({style_class: 'butler-history-bar', visible: false});
        this._count = new St.Label({style_class: 'butler-history-count', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._bar.add_child(this._count);
        this._bar.add_child(textButton('Pin', () => this._pinSelected(true)));
        this._bar.add_child(textButton('Unpin', () => this._pinSelected(false)));
        this._bar.add_child(textButton('Delete', () => this._deleteSelected()));
        this._bar.add_child(textButton('Select all', () => {
            for (const clip of this._shown)
                this._selected.add(clip.id);
            this._render();
        }));
        this._bar.add_child(textButton('Done', () => {
            this._selected.clear();
            this._render();
        }));
        this.actor.add_child(this._bar);

        this._list = new St.BoxLayout({vertical: true, style_class: 'butler-history-list'});
        this._scroll = new St.ScrollView({
            style_class: 'butler-history-scroll',
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this.actor.add_child(this._scroll);

        const footer = new St.BoxLayout({style_class: 'butler-history-footer'});
        footer.add_child(new St.Label({
            text: 'Click to paste · Ctrl+click to select several',
            style_class: 'butler-history-hint',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        footer.add_child(textButton('Clear all but pinned', () => {
            this._history.clearUnpinned();
            this._selected.clear();
        }));
        this.actor.add_child(footer);

        // A click outside the panel closes it.
        this.actor.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const [px, py] = this.actor.get_transformed_position();
            const [w, h] = this.actor.get_transformed_size();
            if (x >= px && x < px + w && y >= py && y < py + h)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });

        this._unwatch = this._history.watch(() => {
            if (this.actor.visible)
                this._render();
        });
        Main.layoutManager.addTopChrome(this.actor);
    }

    destroy() {
        this.close();
        this._unwatch();
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.actor = null;
    }

    get isOpen() {
        return Boolean(this._grab);
    }

    toggle() {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    /** Opens in the middle of the screen and takes the keyboard for the search box. */
    open() {
        if (this.isOpen)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        const width = Math.min(600, monitor.width - 40);
        const height = Math.min(680, Math.round(monitor.height * 0.8));
        this.actor.set_size(width, height);
        this.actor.set_position(monitor.x + Math.round((monitor.width - width) / 2),
            monitor.y + Math.round((monitor.height - height) / 2));
        this._selected.clear();
        this._search.text = '';
        this._render();
        this.actor.show();
        this._grab = Main.pushModal(this.actor);
        global.stage.set_key_focus(this._search);
    }

    close() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.actor?.hide();
    }

    _choose(clip) {
        this.close();
        this._paste(clip);
    }

    _toggleSelected(id) {
        if (this._selected.has(id))
            this._selected.delete(id);
        else
            this._selected.add(id);
        this._render();
    }

    _pinSelected(on) {
        this._history.pin([...this._selected], on);
    }

    _deleteSelected() {
        const ids = [...this._selected];
        this._selected.clear();
        this._history.remove(ids);
    }

    _render() {
        const history = this._history;
        this._pauseButton.label = history.paused ? 'Resume' : 'Pause';
        this._status.visible = history.paused;
        this._status.text = "Paused: new copies aren't kept until you press Resume.";

        // Ticked copies that were deleted aren't ticked any more.
        for (const id of this._selected) {
            if (!history.list.some(clip => clip.id === id))
                this._selected.delete(id);
        }
        this._bar.visible = this._selected.size > 0;
        this._count.text = `${this._selected.size} selected`;

        const matches = ordered(search(history.list, this._search.text));
        this._shown = matches.slice(0, SHOW_MAX);
        this._list.destroy_all_children();
        if (!this._shown.length) {
            this._list.add_child(new St.Label({
                text: history.list.length ? 'Nothing matches.' : 'Nothing copied yet. Press Ctrl+C anywhere and it shows up here.',
                style_class: 'butler-history-empty',
            }));
        }
        for (const clip of this._shown)
            this._list.add_child(this._row(clip));
        if (matches.length > SHOW_MAX) {
            this._list.add_child(new St.Label({
                text: `${matches.length - SHOW_MAX} older copies: search to find them.`,
                style_class: 'butler-history-empty',
            }));
        }
    }

    _row(clip) {
        const selected = this._selected.has(clip.id);
        const row = new St.BoxLayout({style_class: `butler-history-row${selected ? ' selected' : ''}`});

        row.add_child(iconButton(selected ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
            selected ? 'Unselect' : 'Select', () => this._toggleSelected(clip.id), 'butler-history-icon butler-history-check'));

        let content;
        if (clip.kind === 'image') {
            content = new St.Bin({
                style_class: 'butler-history-image',
                x_align: Clutter.ActorAlign.START,
                style: `background-image: url("file://${this._history.thumbPath(clip)}");`,
            });
        } else {
            content = new St.Label({text: preview(clip.text), style_class: 'butler-history-text', x_expand: true});
            content.clutter_text.line_wrap = true;
        }
        const body = new St.Button({style_class: 'butler-history-body', x_expand: true, can_focus: false, child: content,
            x_align: Clutter.ActorAlign.FILL});
        body.connect('clicked', () => {
            const event = Clutter.get_current_event();
            const ctrl = event && (event.get_state() & Clutter.ModifierType.CONTROL_MASK);
            if (ctrl || this._selected.size)
                this._toggleSelected(clip.id);
            else
                this._choose(clip);
        });
        row.add_child(body);

        const side = new St.BoxLayout({vertical: true, style_class: 'butler-history-side'});
        const where = clip.from === 'phone' ? ' · phone' : '';
        side.add_child(new St.Label({text: `${when(clip.at)}${where}`, style_class: 'butler-history-when'}));
        const actions = new St.BoxLayout({style_class: 'butler-history-actions'});
        actions.add_child(iconButton(clip.pinned ? 'starred-symbolic' : 'non-starred-symbolic', clip.pinned ? 'Unpin' : 'Pin',
            () => this._history.pin([clip.id], !clip.pinned), `butler-history-icon${clip.pinned ? ' pinned' : ''}`));
        actions.add_child(iconButton('user-trash-symbolic', 'Delete', () => this._history.remove([clip.id])));
        side.add_child(actions);
        row.add_child(side);
        return row;
    }
}
