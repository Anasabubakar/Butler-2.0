// Talking to the Butler server, the same way the GNOME and phone pets do: multipart forms with
// the device token in x-butler-token, JSON back.
import fs from 'node:fs';
import path from 'node:path';

import {baseUrl} from './config.js';

/** Calls that wait on the AI get longer to answer. */
const SLOW_PATHS = ['/api/screen/look', '/api/screen/act', '/api/screen/draft', '/api/command', '/api/command/confirm', '/api/save'];
const QUICK_MS = 60_000;
const SLOW_MS = 180_000;

export class Butler {
    /** `config` is from loadConfig; `fetchImpl` is for tests. */
    constructor(config, fetchImpl = globalThis.fetch) {
        this.config = config;
        this._fetch = fetchImpl;
    }

    get device() {
        return this.config.device;
    }

    /**
     * Posts `fields` (strings) and `files` ([{field, name, type, data}]) to `apiPath` and returns
     * its JSON answer. Errors say what went wrong in plain words.
     */
    async send(apiPath, fields = {}, files = [], {timeoutMs} = {}) {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null)
                form.append(name, String(value));
        }
        for (const file of files)
            form.append(file.field ?? 'file', new Blob([file.data], {type: file.type}), file.name);
        const res = await this._call('POST', apiPath, form, timeoutMs ?? (SLOW_PATHS.includes(apiPath) ? SLOW_MS : QUICK_MS));
        return this._json(res);
    }

    /** The JSON at `apiPath`, by GET. */
    async get(apiPath) {
        return this._json(await this._call('GET', apiPath, undefined, QUICK_MS));
    }

    /** Raw bytes to `apiPath` (one piece of a file), by PUT. */
    async put(apiPath, bytes) {
        return this._json(await this._call('PUT', apiPath, bytes, SLOW_MS), [409]);
    }

    async remove(apiPath) {
        return this._json(await this._call('DELETE', apiPath, undefined, QUICK_MS));
    }

    /** A raw response, for downloads. Throws unless it's 2xx. */
    async fetchRaw(apiPath, timeoutMs = SLOW_MS) {
        const res = await this._call('GET', apiPath, undefined, timeoutMs);
        if (!res.ok)
            throw httpError(res.status, await res.json().catch(() => ({})));
        return res;
    }

    /** Saves a file the phone sent (inbox kind "file") into `dir`, and returns its path. */
    async download(itemId, dir) {
        const res = await this.fetchRaw(`/api/inbox/file/${encodeURIComponent(itemId)}`);
        const name = (res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'file');
        fs.mkdirSync(dir, {recursive: true});
        const file = freePath(dir, safeName(name));
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        return file;
    }

    async _call(method, apiPath, body, timeoutMs) {
        try {
            return await this._fetch(`${baseUrl(this.config)}${apiPath}`, {
                method,
                body,
                headers: {'x-butler-token': this.config.token},
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (e) {
            if (e?.name === 'TimeoutError')
                throw new Error('Butler took too long to answer');
            throw new Error("couldn't reach Butler (is this computer online?)");
        }
    }

    async _json(res, alsoOk = []) {
        const body = await res.json().catch(() => ({}));
        if (res.ok || alsoOk.includes(res.status))
            return body;
        throw httpError(res.status, body);
    }
}

function httpError(status, body) {
    if (status === 401)
        return new Error('Butler refused the token');
    const e = new Error(body?.error ?? `Butler answered ${status}`);
    e.status = status;
    return e;
}

/** A file name that's safe on Windows: no folders, reserved characters or trailing dots. */
export function safeName(name) {
    const clean = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
    const base = clean || 'file';
    return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base) ? `_${base}` : base.slice(0, 180);
}

/** `name` in `dir`, or "name (2).ext" and so on if it's taken. */
export function freePath(dir, name) {
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let candidate = path.join(dir, name);
    for (let n = 2; fs.existsSync(candidate); n++)
        candidate = path.join(dir, `${stem} (${n})${ext}`);
    return candidate;
}
