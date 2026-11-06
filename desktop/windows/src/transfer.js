// Real files between this computer and your phone, through the Butler server (the phone and
// GNOME pets can also go direct over Wi-Fi; this one always uses the server). Files go up in
// pieces and the other side downloads each one while it's still arriving.
import fs from 'node:fs';
import path from 'node:path';

import {freePath, safeName} from './api.js';

const GUESS = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
    '.txt': 'text/plain', '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** A file's type from its name, as the server wants it. */
export function mimeOf(name) {
    return GUESS[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Sends `paths` to `target` ("phone"). `progress(sent, total)` is called as pieces go up;
 * `stopped()` returning true stops it. Returns who it went to.
 */
export async function sendFiles(butler, paths, target, progress = () => {}, stopped = () => false) {
    const files = paths.map(p => ({name: path.basename(p), size: fs.statSync(p).size, mime: mimeOf(p)}));
    const started = await butler.send('/api/transfer', {device: butler.device, target, files: JSON.stringify(files)});
    const piece = started.piece ?? 8 * 1024 * 1024;
    const total = files.reduce((n, f) => n + f.size, 0);
    let sent = 0;
    try {
        for (const [i, file] of started.files.entries()) {
            const handle = fs.openSync(paths[i], 'r');
            try {
                let at = 0;
                while (at < file.size) {
                    if (stopped())
                        throw new Error('stopped');
                    const buffer = Buffer.alloc(Math.min(piece, file.size - at));
                    fs.readSync(handle, buffer, 0, buffer.length, at);
                    const answer = await butler.put(`/api/transfer/${started.id}/${file.id}?offset=${at}`, buffer);
                    const next = Number(answer.received ?? at + buffer.length); // a 409 says where to carry on
                    sent += next - at;
                    at = next;
                    progress(sent, total);
                }
            } finally {
                fs.closeSync(handle);
            }
        }
    } catch (e) {
        await butler.remove(`/api/transfer/${started.id}`).catch(() => {});
        throw e;
    }
    return started.sent_to ?? [target];
}

/**
 * Downloads every file of a transfer (the inbox message's body) into `dir` while it's still
 * arriving, then tells the server. Returns the saved paths.
 */
export async function receiveFiles(butler, transfer, dir, progress = () => {}, wait = ms => new Promise(r => setTimeout(r, ms))) {
    fs.mkdirSync(dir, {recursive: true});
    const total = transfer.files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    const saved = [];
    for (const file of transfer.files) {
        const final = freePath(dir, safeName(file.name));
        const part = `${final}.part`;
        fs.writeFileSync(part, '');
        let quietSince = Date.now();
        try {
            while (fs.statSync(part).size < file.size) {
                const have = fs.statSync(part).size;
                let res;
                try {
                    res = await butler.fetchRaw(`/api/transfer/${transfer.id}/${file.id}?from=${have}`);
                } catch (e) {
                    if (e.status === 404)
                        throw new Error('the other device stopped sending');
                    throw e;
                }
                const bytes = Buffer.from(await res.arrayBuffer());
                if (bytes.length) {
                    fs.appendFileSync(part, bytes);
                    done += bytes.length;
                    progress(done, total);
                    quietSince = Date.now();
                } else if (Date.now() - quietSince > 10 * 60_000) {
                    throw new Error('nothing new arrived for 10 minutes');
                } else {
                    await wait(1000); // the sender hasn't got further yet
                }
            }
            fs.renameSync(part, final);
            saved.push(final);
        } catch (e) {
            fs.rmSync(part, {force: true});
            throw e;
        }
    }
    await butler.send(`/api/transfer/${transfer.id}/done`, {device: butler.device}).catch(() => {});
    return saved;
}
