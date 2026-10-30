// Sending real files, the parts that don't need GNOME: which files you picked (from what the
// file manager copied, or the file open in the window you're looking at), and what the pet
// says while they travel. The tests run these on their own.

/**
 * File paths from what a file manager puts on the clipboard: a text/uri-list, or GNOME's
 * x-special/gnome-copied-files ("copy" or "cut", then one file:// link a line). Links that
 * aren't files on this laptop are left out.
 */
export function pathsFromUris(text) {
    const paths = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith('file://'))
            continue;
        try {
            const url = new URL(line);
            if (url.host && url.host !== 'localhost')
                continue;
            paths.push(decodeURIComponent(url.pathname));
        } catch (e) {
            // not a link after all
        }
    }
    return [...new Set(paths)];
}

/**
 * File paths from copied plain text, for file managers that only offer text: every line has
 * to be a full path or a file:// link, so ordinary copied text never counts as files.
 */
export function pathsFromText(text) {
    const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length || !lines.every(l => l.startsWith('/') || l.startsWith('file://')))
        return [];
    const paths = lines.flatMap(l => (l.startsWith('/') ? [l] : pathsFromUris(l)));
    return paths.length === lines.length ? [...new Set(paths)] : [];
}

const ATTR = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '';
const unescape = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The file shown in a window, going by its title: viewers and editors (Image Viewer, Papers,
 * Videos, Text Editor, LibreOffice…) put the file's name there, and GNOME notes every file they
 * open in recently-used.xbel. Returns the most recently used file whose name the title starts
 * with, or null. `xbel` is that file's text.
 */
export function fileForTitle(xbel, title) {
    const shown = String(title ?? '').trim().toLowerCase();
    if (!shown)
        return null;
    let best = null;
    for (const [tag] of String(xbel ?? '').matchAll(/<bookmark\s[^>]*>/g)) {
        const href = unescape(ATTR(tag, 'href'));
        const [path] = pathsFromUris(href);
        if (!path)
            continue;
        const name = path.split('/').pop().toLowerCase();
        // "photo.jpg — Image Viewer", "• report.odt - LibreOffice Writer", "notes.txt (~/Documents) - Text Editor"
        const bare = shown.replace(/^[•*\s]+/, '');
        if (!name || !(bare === name || bare.startsWith(`${name} `) || bare.startsWith(`${name} `)))
            continue;
        const when = Math.max(...['modified', 'visited', 'added'].map(a => Date.parse(ATTR(tag, a)) || 0));
        if (!best || when > best.when)
            best = {path, when};
    }
    return best?.path ?? null;
}

/** 1536 → "1.5 KB", for the bubble. */
export function sizeText(bytes) {
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let n = Math.max(0, Number(bytes) || 0), i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return i === 0 ? `${n} ${n === 1 ? 'byte' : 'bytes'}` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "a.jpg", "a.jpg and b.pdf", "a.jpg, b.pdf and 3 more". */
export function namesText(names, count = names.length) {
    const shown = names.slice(0, count > 3 ? 2 : 3);
    const rest = count - shown.length;
    if (rest > 0)
        return `${shown.join(', ')} and ${rest} more`;
    if (shown.length <= 1)
        return shown[0] ?? 'a file';
    return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const filesWord = n => `${n} ${n === 1 ? 'file' : 'files'}`;
const viaText = via => (via === 'wifi' ? 'over Wi-Fi' : via === 'server' ? 'through Butler' : '');

/** 0 to 1, for the bar. An empty file counts as arrived. */
export function fraction({done, size}) {
    return size > 0 ? Math.min(1, Math.max(0, done / size)) : 1;
}

/**
 * What the bubble says while files travel: "Receiving 3 files: a.jpg, b.pdf and 1 more" on top
 * and "45% · 12 MB of 27 MB · over Wi-Fi" under it.
 */
export function progressText(p) {
    const verb = p.direction === 'in' ? 'Receiving' : 'Sending';
    const line = `${verb} ${filesWord(p.count)}: ${namesText(p.names ?? [], p.count)}`;
    const detail = [`${Math.floor(fraction(p) * 100)}%`, `${sizeText(p.done)} of ${sizeText(p.size)}`, viaText(p.via)]
        .filter(Boolean).join(' · ');
    return {line, detail};
}

/** "~/Downloads/Butler" from "/home/anas/Downloads/Butler". */
export function tidyPath(path, home) {
    return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** What the pet says when it's done: where the files went, or that they reached the phone. */
export function doneText(d, home) {
    const n = d.paths?.length ?? 0;
    if (d.direction === 'in')
        return `Got ${filesWord(n)}${d.peer ? ` from ${d.peer}` : ''}. Saved in ${tidyPath(d.folder ?? '', home)}`;
    return `Sent ${filesWord(n)} to ${d.peer || 'your phone'} ${viaText(d.via)}`.trim();
}
