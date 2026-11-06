// Where the Windows pet keeps its settings: %APPDATA%\Butler\pet.json, with the same fields as
// the GNOME pet's ~/.config/butler/pet.json (url, token), plus the device name.
import fs from 'node:fs';
import path from 'node:path';

/** The device name the phone sends to. Use "windows" if you also run the GNOME pet. */
export const DEFAULT_DEVICE = 'laptop';

/** The settings in `dir`, or null if there are none yet or they're missing the URL or token. */
export function loadConfig(dir) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
        if (typeof config.url !== 'string' || typeof config.token !== 'string' || !config.url || !config.token)
            return null;
        return {...config, url: config.url.trim(), token: config.token.trim(), device: cleanDevice(config.device)};
    } catch {
        return null;
    }
}

/** Saves the settings, readable by this Windows user only (the folder is in their profile). */
export function saveConfig(dir, config) {
    const url = String(config.url ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(url))
        throw new Error('the address should start with https://');
    const token = String(config.token ?? '').trim();
    if (!token)
        throw new Error('paste your Butler token');
    fs.mkdirSync(dir, {recursive: true});
    const old = loadConfig(dir) ?? {};
    const next = {...old, url, token, device: cleanDevice(config.device)};
    fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(next, null, 2), {mode: 0o600});
    return next;
}

/** The server's base address, from either "https://host" or the save URL "https://host/api/save". */
export function baseUrl(config) {
    return config.url.replace(/\/+$/, '').replace(/\/api\/save$/, '');
}

function cleanDevice(name) {
    const device = String(name ?? '').trim().slice(0, 60);
    return device || DEFAULT_DEVICE;
}
