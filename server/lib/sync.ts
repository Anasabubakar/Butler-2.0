// The phone's offline copy of the library catches up by asking what changed after a cursor:
// "<microseconds since 1970>:<item id>" of the last change it has. Microseconds, not a date,
// because Postgres keeps microseconds and a JavaScript date would round them off.

export interface Cursor {
  micros: bigint;
  id: string;
}

export const START: Cursor = { micros: 0n, id: "00000000-0000-0000-0000-000000000000" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a cursor; anything missing or broken starts from the beginning. */
export function parseCursor(raw: string | null | undefined): Cursor {
  const m = raw?.trim().match(/^(\d{1,20}):(.+)$/);
  if (!m || !UUID.test(m[2])) return START;
  return { micros: BigInt(m[1]), id: m[2].toLowerCase() };
}

export const formatCursor = (c: Cursor) => `${c.micros}:${c.id}`;

/**
 * Where to look from on the first page of a catch-up: a few seconds before the cursor,
 * so a change saved by a slow transaction (stamped earlier, committed later) isn't missed.
 * The phone keeps items by id, so seeing one twice does no harm.
 */
export function withOverlap(c: Cursor, seconds = 10): Cursor {
  if (c.micros === 0n) return c;
  const back = c.micros - BigInt(seconds) * 1_000_000n;
  return { micros: back > 0n ? back : 0n, id: START.id };
}

/** A device's own id for an offline save: short, plain text, or nothing. */
export function cleanClientId(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v && /^[\w.:-]{1,100}$/.test(v) ? v : null;
}
