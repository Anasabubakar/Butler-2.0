import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import {baseUrl, loadConfig, saveConfig} from '../src/config.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'butler-config-'));

test('no settings yet means null, and half-filled settings too', () => {
    const d = dir();
    assert.equal(loadConfig(d), null);
    fs.writeFileSync(path.join(d, 'pet.json'), JSON.stringify({url: 'https://b.example'}));
    assert.equal(loadConfig(d), null);
});

test('settings are saved and read back, with "laptop" as the default name', () => {
    const d = dir();
    saveConfig(d, {url: ' https://b.example/api/save ', token: ' abc ', device: ''});
    assert.deepEqual(loadConfig(d), {url: 'https://b.example/api/save', token: 'abc', device: 'laptop'});
    saveConfig(d, {url: 'https://b.example', token: 'abc', device: 'windows'});
    assert.equal(loadConfig(d).device, 'windows');
});

test('a bad address or an empty token is refused', () => {
    assert.throws(() => saveConfig(dir(), {url: 'butler.example', token: 'x'}), /https:/);
    assert.throws(() => saveConfig(dir(), {url: 'https://b.example', token: ' '}), /token/);
});

test('the base address comes from either form of the URL', () => {
    assert.equal(baseUrl({url: 'https://b.example/api/save'}), 'https://b.example');
    assert.equal(baseUrl({url: 'https://b.example/'}), 'https://b.example');
});
