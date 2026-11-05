// B2/PetBubble over the pet's head (Figma B2 · 17), like the phone pet's (PetBubble.kt):
// where and what state on top ("My laptop • Working") beside Stop, and what it's doing under
// that. When it's done: a tick (or a "!"), Copy and × on top, the answer under them, wrapped
// over as many lines as it needs, and a reply box to answer back. A long answer shows its first
// lines and "Show more"; open, it scrolls inside the bubble so every word can be read.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';

import {preview, whole} from './fit.js';

/** The text's width: wide enough to read comfortably, narrow enough to sit over the pet. */
const TEXT_W = 320;

/** The first non-empty line. */
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
        this.onReply = null;    // you typed a reply and pressed Enter: (what you said, what the bubble said)
        this.onTyping = null;   // the reply box wants the keyboard (true) or is done with it (false)
        this._typing = false;
        this._full = '';
        this._expanded = false;
        this._working = false;
        this._stopAction = null;

        this.actor = new St.BoxLayout({vertical: true, style_class: 'butler-bubble', visible: false, reactive: true});

        // Top row: spinner or tick, where and what state, then the buttons. The text goes under
        // it at the bubble's full width, so the buttons never squeeze it down to a few words.
        const top = new St.BoxLayout({style_class: 'butler-bubble-top'});
        this._spinner = new Animation.Spinner(16, {animate: true, hideOnStop: true});
        this._spinner.y_align = Clutter.ActorAlign.CENTER;
        top.add_child(this._spinner);
        this._mark = new St.Label({style_class: 'butler-bubble-mark', visible: false, y_align: Clutter.ActorAlign.CENTER});
        top.add_child(this._mark);
        this._heading = new St.Label({style_class: 'butler-bubble-heading', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._heading.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        top.add_child(this._heading);

        this._stop = chip('Stop', 'butler-bubble-stop', () => this._stopAction?.());
        this._copy = chip('Copy', '', () => this.onCopy?.(this._full));
        this._close = chip('×', '', () => this.onClose?.());
        for (const button of [this._stop, this._copy, this._close])
            top.add_child(button);
        this.actor.add_child(top);

        // What Butler says: wrapped, never cut to one line. Closed, the first few lines; open,
        // all of it, scrolling once it's taller than about half the screen.
        this._line = new St.Label({style_class: 'butler-bubble-line', reactive: true, x_align: Clutter.ActorAlign.START});
        this._line.clutter_text.line_wrap = true;
        this._line.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._line.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._line.connect('button-release-event', () => {
            this._tapped();
            return Clutter.EVENT_STOP;
        });
        const holder = new St.BoxLayout({vertical: true});
        holder.add_child(this._line);
        this._scroll = new St.ScrollView({
            style_class: 'butler-bubble-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            child: holder,
        });
        this.actor.add_child(this._scroll);

        // Only there when something is hidden, or to close it again.
        this._more = chip('Show more', 'butler-bubble-more', () => this._tapped(true));
        this._more.x_align = Clutter.ActorAlign.START;
        this.actor.add_child(this._more);
        this._cut = false;

        // Files on their way: a bar that fills, and how far along under it ("45% · 12 MB of 27 MB").
        this._track = new St.Widget({style_class: 'butler-bubble-track', x_expand: true, visible: false});
        this._fill = new St.Widget({style_class: 'butler-bubble-fill'});
        this._track.add_child(this._fill);
        this._track.connect('notify::allocation', () => this._sizeFill());
        this.actor.add_child(this._track);
        this._detail = new St.Label({style_class: 'butler-bubble-detail', visible: false});
        this.actor.add_child(this._detail);
        this._fraction = 0;

        // One thing to do with the result, such as "Open folder".
        this._action = chip('', 'butler-bubble-action', () => this._actionRun?.());
        this._action.x_align = Clutter.ActorAlign.START;
        this.actor.add_child(this._action);

        // Answer back: a follow-up, a correction, a new order. Butler remembers the conversation.
        this._reply = new St.Entry({hint_text: 'Reply to Butler…', style_class: 'butler-bubble-reply', can_focus: true, x_expand: true, visible: false});
        // Typing only reaches the box once the pet holds the keyboard, so take it on click.
        this._reply.clutter_text.connect('button-press-event', () => {
            this._setTyping(true);
            return Clutter.EVENT_PROPAGATE;
        });
        this._reply.clutter_text.connect('activate', () => {
            const text = this._reply.text.trim();
            this._reply.text = '';
            this._setTyping(false);
            if (text)
                this.onReply?.(text, this._full);
        });
        this._reply.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this._setTyping(false);
            return Clutter.EVENT_STOP;
        });
        this.actor.add_child(this._reply);
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

    /** True while you're typing a reply, so it doesn't go away under you either. */
    get replying() {
        return this._typing;
    }

    /** The reply box, to give it the keyboard. */
    get replyEntry() {
        return this._reply;
    }

    /** All of what it says now. */
    get text() {
        return this._full;
    }

    get visible() {
        return Boolean(this.actor?.visible);
    }

    /**
     * Working on something: spinner, a short line, and Stop (or `stopLabel`) if it can be
     * stopped. `heading` says where and what state, such as "My laptop • Working".
     */
    working(text, onStop = null, stopLabel = 'Stop', heading = 'My laptop • Working') {
        this._working = true;
        this._stopAction = onStop;
        this._show(text, true);
        this.heading(heading);
        this._stop.label = stopLabel;
        this._stop.visible = Boolean(onStop);
        this._copy.visible = false;
        this._close.visible = false;
        this._showReply(false);
        this._changed();
    }

    /** Changes what it says it's doing, keeping Stop as it was. */
    progress(text) {
        if (!this._working)
            return this.working(text);
        this._full = text;
        this._setText();
        this._changed();
    }

    /**
     * How far along files are (0 to 1), with the detail line under the bar. Null hides the bar.
     * Only while working: the result takes it away.
     */
    bar(fraction, detail = '') {
        const on = fraction !== null && fraction !== undefined;
        this._fraction = on ? Math.min(1, Math.max(0, fraction)) : 0;
        this._track.visible = on;
        this._detail.text = detail;
        this._detail.visible = on && Boolean(detail);
        this._sizeFill();
        this._changed();
    }

    _sizeFill() {
        const width = this._track.width;
        if (width > 0)
            this._fill.set_size(Math.round(width * this._fraction), this._track.height);
    }

    /** A button under the result, such as "Open folder". Null takes it away. */
    offer(label, run) {
        this._actionRun = run;
        this._action.label = label ?? '';
        this._action.visible = Boolean(label && run);
        this._changed();
    }

    /** Finished: a tick or a "!", the answer, and Copy and ×, under "My laptop • Complete" or "• Failed". */
    result(text, ok = true, heading = `My laptop • ${ok ? 'Complete' : 'Failed'}`) {
        this._working = false;
        this._stopAction = null;
        this._show(text, false);
        this.heading(heading);
        this._mark.text = ok ? '✓' : '!';
        this._mark.style_class = `butler-bubble-mark ${ok ? 'butler-bubble-ok' : 'butler-bubble-bad'}`;
        this._mark.visible = true;
        this._stop.visible = false;
        this._copy.visible = text.length > 40;
        this._close.visible = true;
        this._showReply(Boolean(this.onReply));
        this._changed();
    }

    /** Something to say that isn't a job: no spinner or tick, just ×. */
    info(text) {
        this.result(text, true, null);
        this._mark.visible = false;
        this._changed();
    }

    /** The top line: where it's happening and its state word. Null hides it. */
    heading(text) {
        // Stays in the row even when empty, so the buttons keep to the right.
        this._heading.text = text ?? '';
        this._changed();
    }

    hide() {
        this._showReply(false);
        this._working = false;
        this._stopAction = null;
        this._spinner.stop();
        this._setExpanded(false);
        this.bar(null);
        this.offer(null, null);
        this.actor.hide();
    }

    _show(text, spinning) {
        if (!spinning)
            this.bar(null);
        this.offer(null, null);
        this._full = text;
        this._expanded = false;
        this._setText();
        if (spinning)
            this._spinner.play();
        else
            this._spinner.stop();
        this._mark.visible = false;
        this._setExpanded(false);
        this.actor.show();
    }

    /** Hands the keyboard back without sending, keeping what you typed. */
    stopTyping() {
        this._setTyping(false);
    }

    _showReply(on) {
        if (!on)
            this._setTyping(false);
        this._reply.text = '';
        this._reply.visible = on;
    }

    _setTyping(on) {
        if (this._typing === on)
            return;
        this._typing = on;
        this.onTyping?.(on);
    }

    /** The text was clicked (or `more`: Show more / Show less was). */
    _tapped(more = false) {
        if (!more && this.onTap?.())
            return;
        this._setExpanded(!this._expanded && this._cut);
        this._changed();
    }

    /**
     * Shows the text, closed or open. Its size is worked out at the width it's shown at: the
     * bubble would otherwise ask at its own width and cut the last lines off. Open and taller
     * than about half the screen, it scrolls.
     */
    _setText() {
        const shown = preview(this._full);
        this._cut = shown.cut;
        this._line.text = this._expanded ? whole(this._full) : shown.text;
        this._line.width = -1;
        this._line.height = -1;
        const [, natural] = this._line.get_preferred_width(-1);
        const width = Math.min(natural, TEXT_W);
        const [, height] = this._line.get_preferred_height(width);
        this._line.set_size(width, height);
        const cap = Math.min(440, Math.round((global.stage?.height || 900) * 0.45));
        this._scroll.set_size(width + 6, Math.min(height, cap));
        this._scroll.vadjustment?.set_value(0);
        this._more.label = this._expanded ? 'Show less' : 'Show more';
        this._more.visible = this._cut;
    }

    _setExpanded(on) {
        this._expanded = on;
        this._setText();
    }

    _changed() {
        this.onResize?.();
    }
}
