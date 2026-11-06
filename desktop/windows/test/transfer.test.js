import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import {Butler, freePath, safeName} from '../src/api.js';
import {receiveFiles, sendFiles} from '../src/transfer.js';

/** A tiny stand-in for the Butler server's transfer API, holding files in memory. */
function fakeServer() {
    const stored = new Map();
    const seen = [];
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req)
            chunks.push(c);
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, 'http://x');
        seen.push(`${req.method} ${url.pathname}${url.search} ${req.headers['x-butler-token']}`);
        const json = (code, data) => {
            res.writeHead(code, {'content-type': 'application/json'});
            res.end(JSON.stringify(data));
        };
        if (req.method === 'POST' && url.pathname === '/api/transfer') {
            const files = JSON.parse(body.toString().match(/name="files"\r\n\r\n([^\r]*)\r\n/)[1]);
            const out = files.map((f, i) => ({...f, id: `f${i}`}));
            out.forEach(f => stored.set(f.id, Buffer.alloc(0)));
            return json(200, {id: 't1', files: out, sent_to: ['phone'], piece: 4});
        }
        const put = url.pathname.match(/^\/api\/transfer\/t1\/(f\d)$/);
        if (req.method === 'PUT' && put) {
            const have = stored.get(put[1]);
            if (Number(url.searchParams.get('offset')) !== have.length)
                return json(409, {error: 'wrong offset', received: have.length});
            stored.set(put[1], Buffer.concat([have, body]));
            return json(200, {received: stored.get(put[1]).length});
        }
        if (req.method === 'GET' && put) {
            const from = Number(url.searchParams.get('from'));
            res.writeHead(200);
            return res.end(stored.get(put[1]).subarray(from));
        }
        if (url.pathname === '/api/transfer/t1/done' || req.method === 'DELETE')
            return json(200, {ok: true});
        json(404, {error: 'no'});
    });
    return new Promise(resolve => server.listen(0, () => resolve({server, stored, seen, url: `http://localhost:${server.address().port}`})));
}

test('files go up in pieces and come back down whole, with the token on every call', async () => {
    const {server, stored, seen, url} = await fakeServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-send-'));
    const file = path.join(dir, 'notes.txt');
    fs.writeFileSync(file, 'hello there, phone');
    const butler = new Butler({url: `${url}/api/save`, token: 'tok', device: 'windows'});
    try {
        const progress = [];
        const to = await sendFiles(butler, [file], 'phone', sent => progress.push(sent));
        assert.deepEqual(to, ['phone']);
        assert.equal(stored.get('f0').toString(), 'hello there, phone');
        assert.equal(progress.at(-1), 18);
        assert.ok(seen.every(line => line.endsWith(' tok')));

        const into = path.join(dir, 'in');
        const saved = await receiveFiles(butler, {id: 't1', files: [{id: 'f0', name: 'notes.txt', size: 18}]}, into);
        assert.equal(fs.readFileSync(saved[0], 'utf8'), 'hello there, phone');
        assert.ok(seen.some(line => line.startsWith('POST /api/transfer/t1/done')));
    } finally {
        server.close();
    }
});

test('the server refusing the token says so plainly', async () => {
    const server = http.createServer((_req, res) => {
        res.writeHead(401, {'content-type': 'application/json'});
        res.end('{"error":"bad token"}');
    });
    await new Promise(r => server.listen(0, r));
    try {
        const butler = new Butler({url: `http://localhost:${server.address().port}`, token: 'x', device: 'laptop'});
        await assert.rejects(butler.send('/api/inbox', {device: 'laptop'}), /refused the token/);
    } finally {
        server.close();
    }
});

test('file names are safe on Windows and never overwrite one already there', () => {
    assert.equal(safeName('a/b\\c:d*?.txt'), 'a_b_c_d__.txt');
    assert.equal(safeName('CON.txt'), '_CON.txt');
    assert.equal(safeName('report. '), 'report');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-free-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), '');
    assert.equal(path.basename(freePath(dir, 'a.txt')), 'a (2).txt');
});
