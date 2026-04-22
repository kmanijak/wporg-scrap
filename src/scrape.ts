#!/usr/bin/env tsx
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseListingPage, buildListingUrl } from './listings.ts';
import { createHttpClient, HttpBailError, type HttpClient } from './http.ts';
import { hydrateTopic } from './threads.ts';
import type { ListingRow, Topic, ScrapeResult } from './types.ts';

type Args = {
  slug: string;
  maxPages: number;
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let slug: string | null = null;
  let maxPages = 50;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--pages') {
      const next = args[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        throw new Error(`--pages must be an integer 1..50, got: ${next}`);
      }
      maxPages = n;
    } else if (!a.startsWith('--') && slug === null) {
      slug = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!slug) {
    throw new Error(
      'Missing <slug>. Usage: tsx src/scrape.ts <slug> [--pages N]',
    );
  }
  return { slug, maxPages };
}

async function discover(slug: string, maxPages: number, http: HttpClient): Promise<ListingRow[]> {
  const byTopicSlug = new Map<string, ListingRow>();
  for (let p = 1; p <= maxPages; p++) {
    const url = buildListingUrl(slug, p);
    let html: string;
    try {
      html = await http.fetchText(url);
    } catch (err) {
      // 404 after a run of successful pages = end of archive, not a failure.
      if (err instanceof HttpBailError && err.status === 404 && p > 1) {
        console.error(`[discover ${p}/${maxPages}] 404 — end of archive`);
        break;
      }
      throw err;
    }
    const rows = parseListingPage(html);
    console.error(
      `[discover ${p}/${maxPages}] ${rows.length} rows (${
        byTopicSlug.size + rows.length
      } cumulative before dedup)`,
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!byTopicSlug.has(row.topic_slug)) byTopicSlug.set(row.topic_slug, row);
    }
  }
  return [...byTopicSlug.values()];
}

async function hydrate(
  rows: ListingRow[],
  http: HttpClient,
): Promise<{ topics: Topic[]; skipped: number }> {
  const topics: Topic[] = [];
  let skipped = 0;
  const total = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const topic = await hydrateTopic(row, http);
      topics.push(topic);
      if ((i + 1) % 50 === 0 || i === 0) {
        console.error(`[hydrate ${i + 1}/${total}] ${row.topic_slug} ok`);
      }
    } catch (err) {
      skipped += 1;
      console.error(`[hydrate ${i + 1}/${total}] ${row.topic_slug} FAILED: ${err}`);
    }
  }
  return { topics, skipped };
}

async function writeOutput(
  slug: string,
  full: boolean,
  result: ScrapeResult,
): Promise<string> {
  const fileName = full ? `${slug}.json` : `${slug}.partial.json`;
  const dir = 'data';
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, fileName);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(result, null, 2), 'utf8');
  await rename(tmpPath, finalPath);
  return finalPath;
}

async function main(): Promise<void> {
  const { slug, maxPages } = parseArgs(process.argv);
  const email = process.env.WPORG_SCRAP_EMAIL;
  if (!email) {
    throw new Error(
      'Set WPORG_SCRAP_EMAIL to a contact email — wp.org asks scrapers to be identifiable. ' +
        'Example: WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce',
    );
  }
  const http = createHttpClient({ userAgent: `wporg-scrap/0.2 (+${email})` });
  const scraped_at = new Date().toISOString();
  console.error(
    `[scrape] slug=${slug} maxPages=${maxPages} scraped_at=${scraped_at}`,
  );

  const rows = await discover(slug, maxPages, http);
  console.error(`[scrape] discovery done: ${rows.length} unique topics`);

  const { topics, skipped } = await hydrate(rows, http);

  const result: ScrapeResult = { slug, scraped_at, topics };
  const path = await writeOutput(slug, maxPages >= 50, result);

  console.error(
    `[scrape] wrote ${topics.length}/${rows.length} topics to ${path} (${skipped} skipped)`,
  );
  process.exit(skipped > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(
    `[scrape] fatal: ${err instanceof Error ? err.stack ?? err.message : err}`,
  );
  process.exit(2);
});
