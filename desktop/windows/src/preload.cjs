// The only things the pet's page and the settings page may ask of the app. No Node, no files.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('butler', {
    pets: () => ipcRenderer.invoke('pets'),
    onUi: callback => ipcRenderer.on('ui', (_e, message) => callback(message)),
    mouse: over => ipcRenderer.send('mouse', Boolean(over)),
    typing: on => ipcRenderer.send('typing', Boolean(on)),
    drag: (dx, dy) => ipcRenderer.send('drag', {dx, dy}),
    dropped: () => ipcRenderer.send('dropped'),
    action: name => ipcRenderer.send('action', String(name)),
    ask: (text, replyTo = null) => ipcRenderer.send('ask', {text, replyTo}),
    voice: (data, type) => ipcRenderer.send('voice', {data, type}),
    answer: yes => ipcRenderer.send('answer', Boolean(yes)),
    stop: () => ipcRenderer.send('stop'),
    tappedNote: () => ipcRenderer.send('tapped-note'),
    copy: text => ipcRenderer.send('copy', String(text)),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: values => ipcRenderer.invoke('settings:save', values),
});
