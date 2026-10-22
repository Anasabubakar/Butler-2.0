// Remote control's secret word, the parts that don't need GNOME: finding the word
// anywhere in a command from your phone, taking it out, and counting tries without it.

export const WORD_MIN = 4;
export const STRIKES = 3;                     // commands without the word before remote control locks
export const STRIKE_WINDOW = 15 * 60 * 1000; // within this long

/** A word as you'd type it, minus capitals and the punctuation around it ("Mango," is "mango"). */
export function normalize(word) {
    return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Why `word` can't be the secret word, or null if it's fine. */
export function badWord(word) {
    const w = normalize(word ?? '');
    if (/\s/.test((word ?? '').trim()))
        return 'Use one word, without spaces.';
    if (w.length < WORD_MIN)
        return `Use at least ${WORD_MIN} letters or numbers.`;
    return null;
}

/**
 * Looks for the secret word anywhere in `command`. `isSecret(word)` says whether a
 * normalized word is it. Returns {ok, rest}: rest is the command with the word taken out,
 * so it never reaches the AI or the activity log.
 */
export function takeSecret(command, isSecret) {
    let ok = false;
    const kept = [];
    for (const word of command.split(/\s+/).filter(Boolean)) {
        const w = normalize(word);
        if (w.length >= WORD_MIN && isSecret(w))
            ok = true;
        else
            kept.push(word);
    }
    return {ok, rest: ok ? kept.join(' ') : command.trim()};
}

/** The tries without the word that still count, after one more at `now`. */
export function addStrike(strikes, now = Date.now()) {
    return [...strikes.filter(at => now - at < STRIKE_WINDOW), now];
}

export const locked = strikes => strikes.length >= STRIKES;
