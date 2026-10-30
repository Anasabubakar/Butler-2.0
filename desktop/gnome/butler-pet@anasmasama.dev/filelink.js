// The pet's side of sending real files: runs link.py (which does the sending and receiving,
// outside GNOME Shell so big files never slow the screen) and reads files off the clipboard.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {fileForTitle, pathsFromText, pathsFromUris} from './filepick.js';

const RECENT = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
// What file managers put on the clipboard when you copy files, best first.
const FILE_TYPES = ['x-special/gnome-copied-files', 'text/uri-list'];
const TEXT_TYPES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain'];

function contentOf(clipboard, type) {
    return new Promise(resolve => clipboard.get_content(St.ClipboardType.CLIPBOARD, type, (_clipboard, bytes) => {
        const data = bytes?.get_data?.() ?? bytes;
        resolve(data ? new TextDecoder().decode(data) : '');
    }));
}

/**
 * The paths of files on the clipboard (copied in Files, Nemo, Dolphin…), and the types the
 * clipboard offered (for the log, when no files are found). Plain text counts only when every
 * line is a file that's really there.
 */
export async function filesOnClipboard() {
    const clipboard = St.Clipboard.get_default();
    const types = clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
    for (const type of FILE_TYPES.filter(t => types.includes(t))) {
        const paths = pathsFromUris(await contentOf(clipboard, type));
        if (paths.length)
            return {paths, types};
    }
    const text = TEXT_TYPES.find(t => types.includes(t));
    if (text) {
        const paths = pathsFromText(await contentOf(clipboard, text));
        if (paths.length && paths.every(p => GLib.file_test(p, GLib.FileTest.EXISTS)))
            return {paths, types};
    }
    return {paths: [], types};
}

/** The file shown in a viewer or editor window, from its title and the recent files list, or null. */
export function fileInWindow(window) {
    const title = window?.get_title?.();
    if (!title)
        return null;
    try {
        const [, bytes] = GLib.file_get_contents(RECENT);
        const path = fileForTitle(new TextDecoder().decode(bytes), title);
        return path && GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? path : null;
    } catch (e) {
        return null; // no recent files yet
    }
}

/** Opens Files at `paths` with them selected; just the folder if Files can't. */
export function showInFolder(paths, folder) {
    const uris = paths.map(p => GLib.filename_to_uri(p, null));
    Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', 'ShowItems', new GLib.Variant('(ass)', [uris, '']),
        null, Gio.DBusCallFlags.NONE, 3000, null, (bus, result) => {
            try {
                bus.call_finish(result);
            } catch (e) {
                Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(folder, null), null);
            }
        });
}

/**
 * link.py, kept running: commands go in a line of JSON at a time, news comes back the same
 * way. If it stops, it's started again (waiting longer each time). `onEvent` gets every piece
 * of news: ready, addresses, progress, done and failed.
 */
export class FileLink {
    constructor(script, onEvent) {
        this._script = script;
        this._onEvent = onEvent;
        this._waiting = new Map(); // job -> resolve, for send()
        this._retry = 2;
        this._timer = 0;
        this.local = null; // how the phone reaches this laptop directly, once it's ready
        this._start();
    }

    _start() {
        this._timer = 0;
        try {
            this._proc = Gio.Subprocess.new(['python3', this._script],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            console.warn(`Butler: can't start the file link: ${e.message}`);
            this._again();
            return;
        }
        this._in = this._proc.get_stdin_pipe();
        this._out = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe()});
        this._cancel = new Gio.Cancellable();
        this._read();
    }

    _read() {
        this._out.read_line_async(GLib.PRIORITY_DEFAULT, this._cancel, (stream, result) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch (e) {
                line = null;
            }
            if (line === null) {
                this._ended();
                return;
            }
            try {
                this._event(JSON.parse(line));
            } catch (e) {
                console.warn(`Butler: file link said something odd: ${e.message}`);
            }
            this._read();
        });
    }

    _event(e) {
        if (e.event === 'ready') {
            this.local = e.local ?? null;
            this._retry = 2;
            if (e.error)
                console.warn(`Butler: no direct Wi-Fi link (${e.error}); files go through Butler`);
        } else if (e.event === 'addresses' && this.local) {
            this.local = {...this.local, addresses: e.addresses};
        } else if ((e.event === 'done' || e.event === 'failed') && this._waiting.has(e.job)) {
            this._waiting.get(e.job)(e);
            this._waiting.delete(e.job);
        }
        this._onEvent?.(e);
    }

    _ended() {
        if (!this._proc)
            return; // destroyed
        for (const [job, resolve] of this._waiting)
            resolve({event: 'failed', job, error: 'the file link stopped'});
        this._waiting.clear();
        this.local = null;
        this._proc = null;
        this._again();
    }

    _again() {
        if (this._destroyed)
            return;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._retry, () => {
            this._start();
            return GLib.SOURCE_REMOVE;
        });
        this._retry = Math.min(this._retry * 2, 300);
    }

    _write(command) {
        if (!this._in)
            throw new Error("the file link isn't running (is python3 installed?)");
        this._in.write_all(new TextEncoder().encode(`${JSON.stringify(command)}\n`), null);
    }

    /** Sends files. Returns the job's id and a promise of how it ended ({event: 'done'|'failed', …}). */
    send(paths, target) {
        const job = `out-${GLib.uuid_string_random()}`;
        const done = new Promise(resolve => this._waiting.set(job, resolve));
        try {
            this._write({cmd: 'send', job, target, paths});
        } catch (e) {
            this._waiting.delete(job);
            return {job, done: Promise.resolve({event: 'failed', job, error: e.message})};
        }
        return {job, done};
    }

    /** Downloads files another device is sending through Butler. */
    fetch(transfer, from) {
        this._write({cmd: 'fetch', job: `in-${transfer.id}`, from, transfer});
    }

    cancel(job) {
        try {
            this._write({cmd: 'cancel', job});
        } catch (e) {
            // not running: nothing to stop
        }
    }

    /** Asks for this laptop's addresses again (they change with the network). */
    refreshAddresses() {
        try {
            this._write({cmd: 'addresses'});
        } catch (e) {
            // not running
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        const proc = this._proc;
        this._proc = null;
        this._cancel?.cancel();
        try {
            this._in?.close(null); // link.py leaves when its input closes
        } catch (e) {
            // already closed
        }
        proc?.force_exit();
        this._in = this._out = null;
    }
}
