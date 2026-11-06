// Pressing keys in the app you're in (Ctrl+C to copy what you selected, Ctrl+V to paste a
// draft). The pet's window never takes the focus, so the keys go to your app, not the pet.
// Windows' own SendKeys does it, through PowerShell, which every Windows 10 and 11 has.
import {execFile} from 'node:child_process';

/** SendKeys spelling: ^ is Ctrl, + is Shift, % is Alt. */
export const COPY = '^c';
export const PASTE = '^v';

/** The PowerShell line that presses `keys`. Only the fixed shortcuts above are ever passed. */
export function sendKeysScript(keys) {
    if (!/^[\^+%]*[a-z]$/.test(keys))
        throw new Error(`not a shortcut: ${keys}`);
    return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
}

/** Presses `keys` (like COPY) in the focused app. */
export function press(keys) {
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', sendKeysScript(keys)],
            {windowsHide: true, timeout: 10_000}, error => (error ? reject(new Error(`couldn't press ${keys}: ${error.message}`)) : resolve()));
    });
}
