#!/usr/bin/env tsx
import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { crawl } from './crawl.ts';
import type { CrawlOptions, CrawlResult } from './types.ts';

type Args = {
  slug: string;
  maxPages: number;
  sinceFile: string | null;
  outPath: string | null;
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let slug: string | null = null;
  let maxPages = 50;
  let sinceFile: string | null = null;
  let outPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--pages') {
      const next = args[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        throw new Error(`--pages must be an integer 1..50, got: ${next}`);
      }
      maxPages = n;
    } else if (a === '--since-file') {
      const next = args[++i];
      if (!next) throw new Error('--since-file requires a path');
      sinceFile = next;
    } else if (a === '--out') {
      const next = args[++i];
      if (!next) throw new Error('--out requires a path');
      outPath = next;
    } else if (!a.startsWith('--') && slug === null) {
      slug = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!slug) {
    throw new Error(
      'Missing <slug>. Usage: tsx src/scrape.ts <slug> [--since-file <path>] [--out <path>] [--pages N]',
    );
  }
  return { slug, maxPages, sinceFile, outPath };
}

async function loadSinceFile(path: string): Promise<CrawlOptions['since']> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as {
    activityAt?: string;
    topics?: Record<string, number>;
  };
  const since: NonNullable<CrawlOptions['since']> = {};
  if (parsed.activityAt) since.activityAt = new Date(parsed.activityAt);
  if (parsed.topics) since.topics = new Map(Object.entries(parsed.topics));
  return since;
}

async function writeOutput(path: string, result: CrawlResult): Promise<void> {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  if (dir !== '.') await mkdir(dir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(result, null, 2), 'utf8');
  await rename(tmpPath, path);
}

function defaultOutPath(slug: string, maxPages: number): string {
  const name = maxPages >= 50 ? `${slug}.json` : `${slug}.partial.json`;
  return join('data', name);
}

async function main(): Promise<void> {
  const { slug, maxPages, sinceFile, outPath } = parseArgs(process.argv);

  const email = process.env.WPORG_SCRAP_EMAIL;
  if (!email) {
    throw new Error(
      'Set WPORG_SCRAP_EMAIL to a contact email — wp.org asks scrapers to be identifiable. ' +
        'Example: WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce',
    );
  }

  const since = sinceFile ? await loadSinceFile(sinceFile) : undefined;
  const finalOut = outPath ?? defaultOutPath(slug, maxPages);

  console.error(
    `[scrape] slug=${slug} maxPages=${maxPages} sinceFile=${sinceFile ?? 'none'} out=${finalOut}`,
  );

  const result = await crawl({
    slug,
    email,
    maxPages,
    since,
    onPage: ({ num, topicsScanned }) => {
      console.error(`[discover ${num}/${maxPages}] ${topicsScanned} rows`);
    },
  });

  await writeOutput(finalOut, result);

  console.error(
    `[scrape] done: stopReason=${result.stopReason} scanned=${result.scannedPages} ` +
      `added=${result.added.length} updated=${result.updated.length} ` +
      `seenUnchanged=${result.seenUnchanged.length} topics=${result.topics.length} ` +
      `partialFailures=${result.partialFailures.length} wrote=${finalOut}`,
  );
  process.exit(result.partialFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(
    `[scrape] fatal: ${err instanceof Error ? err.stack ?? err.message : err}`,
  );
  process.exit(2);
});
