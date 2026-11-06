// The settings window: the server address, token and this computer's name, saved to pet.json.
'use strict';

const form = document.getElementById('form');
const field = id => document.getElementById(id);

window.butler.loadSettings().then(config => {
    field('url').value = config.url?.replace(/\/api\/save\/?$/, '') ?? '';
    field('token').value = config.token ?? '';
    field('device').value = config.device ?? 'laptop';
});

form.addEventListener('submit', async e => {
    e.preventDefault();
    field('error').textContent = '';
    try {
        await window.butler.saveSettings({url: field('url').value, token: field('token').value, device: field('device').value});
    } catch (err) {
        field('error').textContent = String(err.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
});
