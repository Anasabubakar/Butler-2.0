// How much of a long answer the bubble shows before "Show more". No GNOME imports, so the
// tests can run it.

/** How much of a long answer shows before "Show more". */
export const PREVIEW = 320;

/** The start of a long answer, cut at a word, with "…"; a short one as it is. */
export function preview(text, most = PREVIEW) {
    const whole = String(text ?? '').trim();
    if (whole.length <= most)
        return whole;
    const cut = whole.slice(0, most);
    const space = cut.search(/\s\S*$/);
    return `${(space > most * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
