import { createHttpClient } from './http.ts';
import { discover } from './discover.ts';
import { hydrateTopic } from './hydrate.ts';
import type {
  CrawlOptions,
  CrawlResult,
  ListingRow,
  PartialFailure,
  Topic,
} from './types.ts';

const DEFAULT_MAX_PAGES = 50;

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  if (!options.slug) throw new Error('crawl: options.slug is required');
  if (!options.http && !options.email) {
    throw new Error(
      'crawl: options.email is required (unless you pass options.http for testing/advanced use)',
    );
  }

  const startedAt = new Date();
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const skipStickies = options.skipStickies ?? true;
  const http =
    options.http ??
    createHttpClient({
      userAgent: `wporg-scrap/0.2 (+${options.email})`,
    });

  const { rows, scannedPages, stopReason } = await discover({
    slug: options.slug,
    http,
    maxPages,
    skipStickies,
    activityCutoff: options.since?.activityAt,
    onPage: options.onPage,
  });

  const cache = options.since?.topics;
  const added: string[] = [];
  const updated: string[] = [];
  const seenUnchanged: string[] = [];
  const toHydrate: ListingRow[] = [];

  for (const row of rows) {
    if (!cache || !cache.has(row.topic_slug)) {
      added.push(row.topic_slug);
      toHydrate.push(row);
    } else if (cache.get(row.topic_slug) !== row.reply_count) {
      updated.push(row.topic_slug);
      toHydrate.push(row);
    } else {
      seenUnchanged.push(row.topic_slug);
    }
  }

  const topics: Topic[] = [];
  const partialFailures: PartialFailure[] = [];

  for (const row of toHydrate) {
    try {
      topics.push(await hydrateTopic(row, http));
    } catch (err) {
      partialFailures.push({
        topic_slug: row.topic_slug,
        url: row.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    slug: options.slug,
    startedAt,
    finishedAt: new Date(),
    scannedPages,
    topics,
    added,
    updated,
    seenUnchanged,
    stopReason,
    partialFailures,
  };
}
