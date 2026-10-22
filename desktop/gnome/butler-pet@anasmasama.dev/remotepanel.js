// The remote control panel on the laptop: turn it on or off, set the secret word,
// stop what's running, and see what your phone asked for lately.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {when} from './cliplist.js';

function button(label, onClick, styleClass = 'butler-history-button') {
    const b = new St.Button({label, style_class: styleClass, can_focus: false});
    b.connect('clicked', () => onClick());
    return b;
}

const EVENTS = {
    'started': 'Started',
    'done': 'Done',
    'failed': 'Failed',
    'refused': 'Refused',
    'stopped': 'Stopped',
    'stop': 'Stop pressed',
    'kill switch': 'Switched off from your phone',
    'turned on': 'Turned on here',
    'turned off': 'Turned off',
    'word changed': 'Secret word changed',
};

export class RemotePanel {
    constructor(remote) {
        this._remote = remote;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'butler-history butler-remote', visible: false, reactive: true});

        const header = new St.BoxLayout({style_class: 'butler-history-header'});
        header.add_child(new St.Label({text: 'Remote control', style_class: 'butler-history-title', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        header.add_child(button('Close', () => this.close()));
        this.actor.add_child(header);

        this._status = new St.Label({style_class: 'butler-remote-status'});
        this._status.clutter_text.line_wrap = true;
        this.actor.add_child(this._status);

        const actions = new St.BoxLayout({style_class: 'butler-remote-actions'});
        this._switch = button('', () => this._remote.setOn(!this._remote.on), 'butler-remote-switch');
        actions.add_child(this._switch);
        this._stop = button('Stop what it\'s doing', () => this._remote.stop(), 'butler-remote-switch butler-remote-danger');
        actions.add_child(this._stop);
        this.actor.add_child(actions);

        this.actor.add_child(new St.Label({text: 'Secret word', style_class: 'butler-remote-heading'}));
        const word = new St.BoxLayout({style_class: 'butler-history-header'});
        this._word = new St.PasswordEntry({hint_text: 'Type a new secret word', style_class: 'butler-ask', can_focus: true, x_expand: true});
        this._word.clutter_text.connect('activate', () => this._saveWord());
        this._word.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        word.add_child(this._word);
        word.add_child(button('Save word', () => this._saveWord()));
        this.actor.add_child(word);
        this._wordNote = new St.Label({style_class: 'butler-history-hint'});
        this._wordNote.clutter_text.line_wrap = true;
        this.actor.add_child(this._wordNote);

        this.actor.add_child(new St.Label({text: 'Lately', style_class: 'butler-remote-heading'}));
        this._log = new St.Label({style_class: 'butler-remote-log'});
        this._log.clutter_text.line_wrap = true;
        this.actor.add_child(this._log);

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

        this._unwatch = this._remote.watch(() => {
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

    open() {
        if (this._grab)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        const width = Math.min(520, monitor.width - 40);
        this.actor.width = width;
        this._word.text = '';
        this._wordNote.text = '';
        this._render();
        this.actor.show();
        const [, height] = this.actor.get_preferred_height(width);
        this.actor.set_position(monitor.x + Math.round((monitor.width - width) / 2),
            monitor.y + Math.max(20, Math.round((monitor.height - height) / 2)));
        this._grab = Main.pushModal(this.actor);
        global.stage.set_key_focus(this._word);
    }

    close() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.actor?.hide();
    }

    _saveWord() {
        const problem = this._remote.setWord(this._word.text);
        this._word.text = '';
        this._wordNote.text = problem ?? 'Saved. Put this word anywhere in a command from your phone. ' +
            'Only a scrambled copy is kept on this laptop, so write it down somewhere safe.';
        this._render();
    }

    _render() {
        const remote = this._remote;
        if (!remote.hasWord)
            this._status.text = 'Off. Set a secret word first, then turn it on. Your phone\'s commands must include that word.';
        else if (remote.on)
            this._status.text = 'On. Your phone can send this laptop commands that include your secret word. ' +
                'Three commands without it in 15 minutes switch it off.';
        else
            this._status.text = 'Off. Commands from your phone are ignored.';
        if (remote.job)
            this._status.text += `\n\nRunning now: ${remote.job.command}`;
        this._switch.label = remote.on ? 'Turn off' : 'Turn on';
        this._switch.reactive = remote.on || remote.hasWord;
        this._switch.opacity = this._switch.reactive ? 255 : 120;
        this._stop.visible = Boolean(remote.job);
        if (!this._wordNote.text)
            this._wordNote.text = remote.hasWord ? 'A word is set. Type a new one to change it.' : 'No word set yet.';

        const lines = remote.recent(8).map(entry => {
            const what = EVENTS[entry.event] ?? entry.event;
            const detail = entry.command ? `: ${entry.command}` : entry.why ? ` (${entry.why})` : '';
            return `${when(Date.parse(entry.at))}  ${what}${detail}`;
        });
        this._log.text = lines.join('\n') || 'Nothing yet.';
    }
}
