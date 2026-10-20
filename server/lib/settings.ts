// Small things Butler remembers between restarts, one text value per key.
import { sql } from "./db.ts";

export async function get(key: string): Promise<string | null> {
  const [row] = await sql<{ value: string }[]>`select value from settings where key = ${key}`;
  return row?.value ?? null;
}

export async function set(key: string, value: string) {
  await sql`insert into settings (key, value) values (${key}, ${value})
    on conflict (key) do update set value = excluded.value`;
}
