// Clipboard history, the parts that don't need GNOME: adding a copy, forgetting
// old ones, searching and showing when. The tests run these on their own.

export const KEEP_DAYS = 30;  // unpinned copies older than this are forgotten
export const KEEP_MAX = 500;  // and only this many unpinned ones are kept
export const TEXT_MAX = 100000; // characters kept of one copy

const DAY = 24 * 60 * 60 * 1000;

/** What makes two copies the same: the text itself, or the picture's checksum. */
const sameAs = clip => other => other.kind === clip.kind &&
    (clip.kind === 'image' ? other.hash === clip.hash : other.text === clip.text);

/**
 * Puts a new copy at the top. Copying something that's already there moves it up
 * (keeping its pin) instead of listing it twice. Returns {list, removed}: removed are
 * the copies that were dropped, so their pictures can be deleted too.
 */
export function addClip(list, clip, now = Date.now()) {
    const old = list.find(sameAs(clip));
    const added = old
        ? {...old, at: now, from: clip.from ?? old.from}
        : {...clip, at: now, pinned: false};
    // A repeated picture keeps its first file; the new file isn't needed.
    const extra = old && clip.kind === 'image' && clip.file !== old.file ? [clip] : [];
    const result = prune([added, ...list.filter(c => c !== old)], now);
    return {list: result.list, removed: [...extra, ...result.removed]};
}

/** Forgets unpinned copies older than KEEP_DAYS, and the oldest beyond KEEP_MAX. Pins stay. */
export function prune(list, now = Date.now()) {
    const keep = [];
    const removed = [];
    let unpinned = 0;
    for (const clip of [...list].sort((a, b) => b.at - a.at)) {
        if (clip.pinned || (now - clip.at < KEEP_DAYS * DAY && unpinned++ < KEEP_MAX))
            keep.push(clip);
        else
            removed.push(clip);
    }
    return {list: keep, removed};
}

/** Pinned first, then newest first. */
export function ordered(list) {
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
}

/** Copies whose text has every word of `query`; "image", "picture" or "screenshot" finds pictures. */
export function search(list, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length)
        return list;
    return list.filter(clip => {
        const text = clip.kind === 'image'
            ? `image picture screenshot photo ${clip.from ?? ''}`
            : `${clip.text} ${clip.from === 'phone' ? 'phone' : ''}`.toLowerCase();
        return words.every(word => text.includes(word));
    });
}

/** The first few lines of a text copy, for its row in the list. */
export function preview(text, lines = 3, chars = 300) {
    const shown = text.replace(/\t/g, '    ').split('\n').filter(line => line.trim()).slice(0, lines).join('\n');
    const short = shown.length > chars ? `${shown.slice(0, chars)}…` : shown;
    return short || '(spaces only)';
}

const two = n => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When it was copied, in your local time: "just now", "5 min ago", "14:05", "Yesterday 09:30", "Mon 3 Oct". */
export function when(at, now = Date.now()) {
    const ago = now - at;
    if (ago < 60 * 1000)
        return 'just now';
    if (ago < 60 * 60 * 1000)
        return `${Math.floor(ago / 60000)} min ago`;
    const then = new Date(at);
    const time = `${two(then.getHours())}:${two(then.getMinutes())}`;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    if (at >= midnight.getTime())
        return time;
    if (at >= midnight.getTime() - DAY)
        return `Yesterday ${time}`;
    const date = `${DAYS[then.getDay()]} ${then.getDate()} ${MONTHS[then.getMonth()]}`;
    return then.getFullYear() === new Date(now).getFullYear() ? date : `${date} ${then.getFullYear()}`;
}
