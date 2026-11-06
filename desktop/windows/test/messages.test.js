import assert from 'node:assert/strict';
import {test} from 'node:test';

import {describe, inOrder, safeLink} from '../src/messages.js';

test('reminders, clips and links are shown like on the GNOME pet', () => {
    assert.deepEqual(describe({kind: 'reminder', body: 'call Mum', from_device: 'phone'}, 'laptop'), {title: 'Reminder', text: 'call Mum', tap: null});
    const clip = describe({kind: 'clip', body: 'hello', from_device: 'phone'}, 'laptop');
    assert.equal(clip.title, 'On your clipboard from phone');
    assert.equal(clip.clip, 'hello');
    assert.deepEqual(describe({kind: 'link', url: 'https://x.example', from_device: 'phone'}, 'laptop').tap, {open: 'https://x.example'});
});

test('a link that is not a web link is never opened', () => {
    assert.equal(describe({kind: 'link', url: 'file:///C:/Windows', from_device: 'phone'}, 'laptop').tap, null);
    assert.equal(safeLink('javascript:alert(1)'), false);
});

test('a heads-up with a code copies the code when tapped', () => {
    const shown = describe({kind: 'note', body: 'Your code', card: {copy: '123456'}, from_device: 'Butler'}, 'laptop');
    assert.deepEqual(shown.tap, {copy: '123456'});
});

test('sync, rings, stops, phone tasks and transfers are handled without a note', () => {
    for (const kind of ['sync', 'ring', 'stop', 'task', 'transfer', 'file'])
        assert.ok(describe({kind, body: '{}'}, 'laptop').silent);
});

test('stop and phone tasks come first', () => {
    assert.deepEqual(inOrder([{kind: 'note'}, {kind: 'stop'}, {kind: 'reminder'}, {kind: 'task'}]).map(m => m.kind),
        ['stop', 'task', 'note', 'reminder']);
});
