// The weekly recap: what you saved in the last 7 days, grouped, with a few worth
// another look. Written without AI, like the morning brief.
import { sql } from "./db.ts";

export interface Highlight {
  title: string;
  link: string | null;
}

export interface Week {
  total: number;
  categories: { name: string; n: number }[];
  platforms: { name: string; n: number }[];
  tags: string[];
  highlights: Highlight[];
}

const counted = (list: { name: string; n: number }[]) => list.map((c) => `${c.name} ${c.n}`).join(", ");

/** The recap as a short plain note. */
export function compose(w: Week): string {
  if (!w.total) return "your week in Butler: nothing saved this week 🥀 share something to Butler and it shows up here.";
  const lines = [`your week in Butler: you saved ${w.total} thing${w.total === 1 ? "" : "s"}.`];
  if (w.categories.length) lines.push("", `By topic: ${counted(w.categories)}.`);
  if (w.platforms.length) lines.push(`From: ${counted(w.platforms)}.`);
  if (w.tags.length) lines.push(`Top tags: ${w.tags.join(", ")}.`);
  if (w.highlights.length) {
    lines.push("", "worth another look:");
    for (const h of w.highlights) lines.push(`• ${h.title}`, ...(h.link ? [`  ${h.link}`] : []));
  }
  return lines.join("\n");
}

/** Collects the last 7 days of saves. */
export async function gather(now: Date, publicUrl?: string): Promise<Week> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::int as total from items where created_at >= ${since} and created_at < ${now}`;
  const categories = await sql<{ name: string; n: number }[]>`
    select category as name, count(*)::int as n from items
    where created_at >= ${since} and created_at < ${now} and category is not null
    group by 1 order by 2 desc, 1 limit 5`;
  const platforms = await sql<{ name: string; n: number }[]>`
    select platform as name, count(*)::int as n from items
    where created_at >= ${since} and created_at < ${now} and platform is not null
    group by 1 order by 2 desc, 1 limit 4`;
  const tags = await sql<{ tag: string }[]>`
    select t as tag from items, unnest(tags) as t
    where created_at >= ${since} and created_at < ${now}
    group by 1 order by count(*) desc, 1 limit 5`;
  // Ones with your own note first: you cared enough to write something.
  const picks = await sql<{ id: string; title: string; url: string | null; file_path: string | null }[]>`
    select id, title, url, file_path from items
    where created_at >= ${since} and created_at < ${now} and status = 'organized' and title is not null
    order by (note is not null) desc, random() limit 3`;
  const base = publicUrl?.replace(/\/$/, "");
  const highlights = picks.map((p) => ({
    title: p.title,
    link: p.url?.startsWith("https://") ? p.url : p.file_path && base?.startsWith("https://") ? `${base}/files/${p.id}` : null,
  }));
  return { total, categories, platforms, tags: tags.map((t) => t.tag), highlights };
}
