// How much of what Butler says fits in the closed bubble, and when it needs "Show more".
// Plain JavaScript with no GNOME imports, so tests can run it.

/** Lines a closed bubble shows before "Show more", as on the phone pet. */
export const CLOSED_LINES = 6;
/** About how many characters fit on one line at the bubble's width. */
export const PER_LINE = 44;
/** The most an open bubble holds; Copy still gets all of it. */
export const LONGEST = 20000;

/** How many wrapped lines `text` takes at `perLine` characters a line. */
export function lineCount(text, perLine = PER_LINE) {
    return String(text ?? '').trim().split('\n')
        .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/**
 * The start of `text` that fits in `lines` wrapped lines, ending in "…" on a word break if
 * anything was left out. `cut` says whether it was, so the bubble knows to offer "Show more".
 */
export function preview(text, lines = CLOSED_LINES, perLine = PER_LINE) {
    const whole = String(text ?? '').trim();
    if (lineCount(whole, perLine) <= lines)
        return {text: whole, cut: false};
    const kept = [];
    let left = lines;
    for (const line of whole.split('\n')) {
        const rows = Math.max(1, Math.ceil(line.length / perLine));
        if (rows <= left) {
            kept.push(line);
            left -= rows;
            continue;
        }
        if (left > 0)
            kept.push(cutAtWord(line, left * perLine - 1));
        break;
    }
    // Keep "…" right after the last word kept, not on a blank line of its own.
    while (kept.length > 1 && !kept[kept.length - 1].trim())
        kept.pop();
    return {text: `${kept.join('\n').trimEnd()}…`, cut: true};
}

/** All of it, up to LONGEST characters. */
export function whole(text) {
    const all = String(text ?? '').trim();
    return all.length > LONGEST ? `${cutAtWord(all, LONGEST)}…` : all;
}

/** The first `max` characters, shortened to the last space if that keeps most of them. */
function cutAtWord(text, max) {
    if (text.length <= max)
        return text;
    const part = text.slice(0, max);
    const space = part.lastIndexOf(' ');
    return (space > max * 0.6 ? part.slice(0, space) : part).trimEnd();
}
