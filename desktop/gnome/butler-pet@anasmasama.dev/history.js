// Clipboard history: every Ctrl+C on this laptop, kept here (never on the server)
// in ~/.local/share/butler/clipboard, so you can find and paste it again later.
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {addClip, prune, TEXT_MAX} from './cliplist.js';

const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'butler', 'clipboard']);
const LIST_FILE = GLib.build_filenamev([DIR, 'history.json']);
const IMAGES = GLib.build_filenamev([DIR, 'images']);
// History is paused while this file exists; the panel's Pause button makes and removes it.
const PAUSE_FLAG = GLib.build_filenamev([GLib.get_user_config_dir(), 'butler', 'clipboard-history-paused']);
const THUMB_W = 240;
const THUMB_H = 160;

const TEXT_TYPES = ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING', 'STRING', 'TEXT'];

/** Password managers mark their copies; those are never kept. */
export const isSecret = types => types.includes('x-kde-passwordManagerHint');

function readText() {
    return new Promise(resolve => St.Clipboard.get_default()
        .get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text ?? '')));
}

function readContent(mime) {
    return new Promise(resolve => St.Clipboard.get_default()
        .get_content(St.ClipboardType.CLIPBOARD, mime, (_clipboard, bytes) => resolve(bytes ?? null)));
}

export class ClipboardHistory {
    constructor() {
        this.list = this._load();
        this.paused = GLib.file_test(PAUSE_FLAG, GLib.FileTest.EXISTS);
        this._changed = new Set();
    }

    /** Calls `callback` whenever the list changes. Returns a function that stops it. */
    watch(callback) {
        this._changed.add(callback);
        return () => this._changed.delete(callback);
    }

    _load() {
        try {
            const [, bytes] = GLib.file_get_contents(LIST_FILE);
            const list = JSON.parse(new TextDecoder().decode(bytes));
            if (Array.isArray(list)) {
                const {list: kept, removed} = prune(list);
                this._deleteFiles(removed);
                return kept;
            }
        } catch (e) {
            // nothing copied yet
        }
        return [];
    }

    _save() {
        try {
            GLib.mkdir_with_parents(DIR, 0o700);
            GLib.file_set_contents(LIST_FILE, JSON.stringify(this.list));
        } catch (e) {
            console.error('butler-pet: could not save the clipboard history', e);
        }
        for (const callback of this._changed)
            callback();
    }

    setPaused(on) {
        this.paused = on;
        try {
            if (on) {
                GLib.mkdir_with_parents(GLib.path_get_dirname(PAUSE_FLAG), 0o700);
                GLib.file_set_contents(PAUSE_FLAG, '');
            } else {
                GLib.unlink(PAUSE_FLAG);
            }
        } catch (e) {
            console.error('butler-pet: clipboard history pause setting', e);
        }
        this._save();
    }

    /**
     * Keeps what's on the clipboard now: its text, or else its picture. `types` are the
     * clipboard's formats. Returns the kept copy, or null if there was nothing to keep.
     */
    async capture(types, from) {
        if (this.paused || isSecret(types))
            return null;
        if (TEXT_TYPES.some(type => types.includes(type))) {
            const text = await readText();
            return text.trim() ? this.addText(text, from) : null;
        }
        const mime = types.find(type => type === 'image/png') ?? types.find(type => type.startsWith('image/'));
        if (!mime)
            return null;
        const bytes = await readContent(mime);
        return bytes?.get_size() ? this.addImage(bytes, mime, from) : null;
    }

    addText(text, from) {
        if (this.paused || !text.trim())
            return null;
        return this._add({id: GLib.uuid_string_random(), kind: 'text', text: text.slice(0, TEXT_MAX), from});
    }

    /** Keeps a picture as a PNG plus a small thumbnail for the list. */
    addImage(bytes, mime, from) {
        if (this.paused)
            return null;
        const id = GLib.uuid_string_random();
        const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
        const existing = this.list.find(clip => clip.kind === 'image' && clip.hash === hash);
        if (existing)
            return this._add({...existing, from: from ?? existing.from});
        try {
            GLib.mkdir_with_parents(IMAGES, 0o700);
            const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(Gio.MemoryInputStream.new_from_bytes(bytes), null);
            const file = `${id}.png`;
            if (mime === 'image/png') {
                GLib.file_set_contents(GLib.build_filenamev([IMAGES, file]), bytes.get_data());
            } else {
                const [, png] = pixbuf.save_to_bufferv('png', [], []);
                GLib.file_set_contents(GLib.build_filenamev([IMAGES, file]), png);
            }
            const scale = Math.min(1, THUMB_W / pixbuf.get_width(), THUMB_H / pixbuf.get_height());
            const thumb = pixbuf.scale_simple(Math.max(1, Math.round(pixbuf.get_width() * scale)),
                Math.max(1, Math.round(pixbuf.get_height() * scale)), GdkPixbuf.InterpType.BILINEAR);
            const [, jpeg] = thumb.save_to_bufferv('jpeg', ['quality'], ['80']);
            GLib.file_set_contents(GLib.build_filenamev([IMAGES, `${id}-thumb.jpg`]), jpeg);
            return this._add({id, kind: 'image', file, thumb: `${id}-thumb.jpg`, hash,
                width: pixbuf.get_width(), height: pixbuf.get_height(), from});
        } catch (e) {
            console.error('butler-pet: could not keep a copied picture', e);
            return null;
        }
    }

    _add(clip) {
        const {list, removed} = addClip(this.list, clip);
        this._deleteFiles(removed.filter(gone => !list.some(kept => kept.file && kept.file === gone.file)));
        this.list = list;
        this._save();
        return list[0];
    }

    imagePath(clip) {
        return GLib.build_filenamev([IMAGES, clip.file]);
    }

    thumbPath(clip) {
        return GLib.build_filenamev([IMAGES, clip.thumb ?? clip.file]);
    }

    /** The picture's bytes, or null if its file is gone. */
    imageBytes(clip) {
        try {
            const [, bytes] = GLib.file_get_contents(this.imagePath(clip));
            return new GLib.Bytes(bytes);
        } catch (e) {
            return null;
        }
    }

    pin(ids, on) {
        this.list = this.list.map(clip => ids.includes(clip.id) ? {...clip, pinned: on} : clip);
        this._save();
    }

    remove(ids) {
        this._deleteFiles(this.list.filter(clip => ids.includes(clip.id)));
        this.list = this.list.filter(clip => !ids.includes(clip.id));
        this._save();
    }

    /** Forgets everything except pinned copies. */
    clearUnpinned() {
        this.remove(this.list.filter(clip => !clip.pinned).map(clip => clip.id));
    }

    /** Puts a copy from the list back on the clipboard. False if its picture is gone. */
    copyBack(clip) {
        const clipboard = St.Clipboard.get_default();
        if (clip.kind === 'text') {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, clip.text);
            return true;
        }
        const bytes = this.imageBytes(clip);
        if (!bytes)
            return false;
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
        return true;
    }

    _deleteFiles(clips) {
        for (const clip of clips) {
            for (const name of [clip.file, clip.thumb]) {
                if (name)
                    GLib.unlink(GLib.build_filenamev([IMAGES, name]));
            }
        }
    }
}

/** The clipboard's formats right now. */
export function clipboardTypes() {
    return global.display.get_selection().get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
}
