import assert from 'node:assert/strict';
import {test} from 'node:test';

import {COPY, PASTE, sendKeysScript} from '../src/keys.js';

test('only plain shortcuts can be pressed, so nothing else can reach PowerShell', () => {
    assert.match(sendKeysScript(COPY), /SendWait\('\^c'\)/);
    assert.match(sendKeysScript(PASTE), /SendWait\('\^v'\)/);
    assert.throws(() => sendKeysScript("^v'); Remove-Item C:\\ #"));
    assert.throws(() => sendKeysScript('hello'));
});
