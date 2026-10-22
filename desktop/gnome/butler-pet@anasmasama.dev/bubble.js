// The speech bubble over the pet's head, like the phone pet's (PetBubble.kt). While it
// works: a spinner, one short line of what it's doing, and Stop. When it's done: a tick
// (or a "!"), the first line of the answer, and Copy and ×. Click the line to read all of it.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';

/** The first non-empty line; the label cuts it short with "…" if it's long. */
export function firstLine(text) {
    return String(text ?? '').trim().split('\n').find(line => line.trim())?.trim() ?? '';
}

function chip(label, styleClass, onClick) {
    const button = new St.Button({label, style_class: `butler-bubble-chip ${styleClass}`, can_focus: false, visible: false});
    button.connect('clicked', () => onClick());
    return button;
}

export class Bubble {
    constructor() {
        this.onClose = null;    // × pressed
        this.onCopy = null;     // Copy pressed, with the whole text
        this.onTap = null;      // the line clicked; return true if that was handled
        this.onResize = null;   // what it says changed, so it can be placed again
        this._full = '';
        this._expanded = false;
        this._working = false;
        this._stopAction = null;

        this.actor = new St.BoxLayout({vertical: true, style_class: 'butler-bubble', visible: false, reactive: true});

        const top = new St.BoxLayout({style_class: 'butler-bubble-top'});
        this._spinner = new Animation.Spinner(16, {animate: true, hideOnStop: true});
        this._spinner.y_align = Clutter.ActorAlign.CENTER;
        top.add_child(this._spinner);
        this._mark = new St.Label({style_class: 'butler-bubble-mark', visible: false, y_align: Clutter.ActorAlign.CENTER});
        top.add_child(this._mark);

        this._line = new St.Label({style_class: 'butler-bubble-line', reactive: true, y_align: Clutter.ActorAlign.CENTER});
        this._line.clutter_text.single_line_mode = true;
        this._line.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._line.connect('button-release-event', () => {
            this._tapped();
            return Clutter.EVENT_STOP;
        });
        top.add_child(this._line);

        this._stop = chip('Stop', 'butler-bubble-stop', () => this._stopAction?.());
        this._copy = chip('Copy', '', () => this.onCopy?.(this._full));
        this._close = chip('×', '', () => this.onClose?.());
        for (const button of [this._stop, this._copy, this._close])
            top.add_child(button);
        this.actor.add_child(top);

        this._body = new St.Label({style_class: 'butler-bubble-body', reactive: true});
        this._body.clutter_text.line_wrap = true;
        this._body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._body.connect('button-release-event', () => {
            this._tapped();
            return Clutter.EVENT_STOP;
        });
        this._scroll = new St.ScrollView({
            style_class: 'butler-bubble-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            visible: false,
            child: new St.BoxLayout({vertical: true}),
        });
        this._scroll.child.add_child(this._body);
        this.actor.add_child(this._scroll);
    }

    destroy() {
        this.actor.destroy();
        this.actor = null;
    }

    /** True while you're reading the whole answer, so it doesn't go away under you. */
    get expanded() {
        return this._expanded;
    }

    get working() {
        return this._working;
    }

    /** All of what it says now. */
    get text() {
        return this._full;
    }

    get visible() {
        return Boolean(this.actor?.visible);
    }

    /** Working on something: spinner, a short line, and Stop (or `stopLabel`) if it can be stopped. */
    working(text, onStop = null, stopLabel = 'Stop') {
        this._working = true;
        this._stopAction = onStop;
        this._show(text, true);
        this._stop.label = stopLabel;
        this._stop.visible = Boolean(onStop);
        this._copy.visible = false;
        this._close.visible = false;
        this._changed();
    }

    /** Changes what it says it's doing, keeping Stop as it was. */
    progress(text) {
        if (!this._working)
            return this.working(text);
        this._full = text;
        this._line.text = firstLine(text);
        this._body.text = text;
        this._changed();
    }

    /** Finished: a tick or a "!", the answer, and Copy and ×. */
    result(text, ok = true) {
        this._working = false;
        this._stopAction = null;
        this._show(text, false);
        this._mark.text = ok ? '✓' : '!';
        this._mark.style_class = `butler-bubble-mark ${ok ? 'butler-bubble-ok' : 'butler-bubble-bad'}`;
        this._mark.visible = true;
        this._stop.visible = false;
        this._copy.visible = text.length > 40;
        this._close.visible = true;
        // Long answers open up straight away; short ones fit on the line.
        if (text.length > 90 || text.includes('\n'))
            this._setExpanded(true);
        this._changed();
    }

    /** Something to say that isn't a job: no spinner or tick, just ×. */
    info(text) {
        this.result(text, true);
        this._mark.visible = false;
        this._changed();
    }

    hide() {
        this._working = false;
        this._stopAction = null;
        this._spinner.stop();
        this._setExpanded(false);
        this.actor.hide();
    }

    _show(text, spinning) {
        this._full = text;
        this._line.text = firstLine(text);
        this._body.text = text;
        if (spinning)
            this._spinner.play();
        else
            this._spinner.stop();
        this._mark.visible = false;
        this._setExpanded(false);
        this.actor.show();
    }

    _tapped() {
        if (this.onTap?.())
            return;
        this._setExpanded(!this._expanded && this._full.trim().length > firstLine(this._full).length);
        this._changed();
    }

    _setExpanded(on) {
        this._expanded = on;
        this._scroll.visible = on;
        this._line.opacity = on ? 150 : 255;
    }

    _changed() {
        this.onResize?.();
    }
}
