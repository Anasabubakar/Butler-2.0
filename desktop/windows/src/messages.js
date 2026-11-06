// What the Windows pet does with each thing that arrives from Butler, as plain data, so the
// rules are the same as the GNOME pet's (extension.js _deliver) and can be tested.

/**
 * How to show one inbox message: `{title, text, tap}` where tap is null, {open: url},
 * {copy: text} or {openFile: true}; or `{silent}` for things handled without a word
 * (clipboard sync, ring, stop, a phone task, a file transfer).
 */
export function describe(message, here) {
    const from = !message.from_device || message.from_device === here ? '' : ` from ${message.from_device}`;
    const body = message.body ?? '';
    switch (message.kind) {
    case 'reminder':
        return {title: 'Reminder', text: body, tap: null};
    case 'sync':
        return {silent: 'clipboard', clip: body};
    case 'clip':
        return {title: `On your clipboard${from}`, text: `${body.slice(0, 200)}\n\n(Ready to paste.)`, tap: null, clip: body};
    case 'link':
        return {title: `A link${from}`, text: `${message.url ?? ''}\n\n(Tap to open it.)`, tap: safeLink(message.url) ? {open: message.url} : null};
    case 'file':
        return {silent: 'file'};
    case 'transfer':
    case 'ring':
    case 'stop':
    case 'task':
    case 'status':
        return {silent: message.kind};
    default: {
        // A heads-up can carry a login code (tap copies it) or a link (tap opens it).
        const code = message.card?.copy;
        if (code)
            return {title: `A note${from}`, text: `${body}\n\n(Tap to copy the code.)`, tap: {copy: code}};
        const site = message.card?.title ? `\n\n${message.card.title}${message.card.site ? ` · ${message.card.site}` : ''}` : '';
        if (safeLink(message.url))
            return {title: `A note${from}`, text: `${body}${site}\n\n(Tap to open it.)`, tap: {open: message.url}};
        return {title: `A note${from}`, text: body || message.url || '', tap: null};
    }
    }
}

/** Only web links are opened from a message: never file:, javascript: or app links. */
export function safeLink(url) {
    return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url);
}

/** Phone tasks and Stop first, so a note's bubble never holds them up. */
export function inOrder(messages) {
    const first = m => (m.kind === 'stop' || m.kind === 'task' ? 0 : 1);
    return [...messages].sort((a, b) => first(a) - first(b));
}
