import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crawl } from './crawl.ts';
import { HttpBailError } from './http.ts';
import type { HttpClient } from './http.ts';

const LISTING_URL = 'https://wordpress.org/support/plugin/woocommerce/';
const LISTING_URL_PAGE = (n: number) =>
  n === 1 ? LISTING_URL : `https://wordpress.org/support/plugin/woocommerce/page/${n}/`;

// Fixture loading — once, shared across tests.
const listingHtml = await readFile('test/fixtures/woocommerce-page-1.html', 'utf8');
const threadXml = await readFile('test/fixtures/sample-thread.xml', 'utf8');

// Stub client: each test hands in a `fetcher` that maps url → response or throws.
type StubFetcher = (url: string) => string | Promise<string>;
function makeStubClient(fetcher: StubFetcher): HttpClient {
  return {
    async fetchText(url) {
      return await fetcher(url);
    },
  };
}

// Helper: a fetcher that returns the listing HTML for page 1 and the thread XML
// for any topic-feed URL. Page >= 2 throws a 404 HttpBailError (end-of-archive).
function listingPlusThread(): StubFetcher {
  return (url) => {
    if (url === LISTING_URL_PAGE(1)) return listingHtml;
    if (url.startsWith('https://wordpress.org/support/plugin/woocommerce/page/')) {
      throw new HttpBailError(`HTTP 404 Not Found at ${url}`, 404);
    }
    if (url.startsWith('https://wordpress.org/support/topic/') && url.endsWith('/feed/')) {
      return threadXml;
    }
    throw new Error(`stub: no response for ${url}`);
  };
}

describe('crawl()', () => {
  test('full crawl with no since: all slugs classified as added, topics populated', async () => {
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 1,
    });

    assert.equal(result.slug, 'woocommerce');
    assert.equal(result.stopReason, 'max-pages');
    assert.equal(result.scannedPages, 1);
    // Page 1 has 30 non-sticky + 3 sticky; with default skipStickies:true, 30 remain.
    assert.equal(result.added.length, 30);
    assert.equal(result.updated.length, 0);
    assert.equal(result.seenUnchanged.length, 0);
    assert.equal(result.topics.length, 30);
    assert.equal(result.partialFailures.length, 0);
    // Every hydrated topic should have a non-empty opener body.
    for (const t of result.topics) {
      assert.equal(typeof t.opener.body_md, 'string');
      assert.ok(t.opener.body_md.length > 0, `empty opener body for ${t.topic_slug}`);
    }
  });

  test('since.topics matching reply_count: seenUnchanged populated, no hydration', async () => {
    // First, discover the real listing to snapshot reply_counts.
    const probe = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 1,
    });

    // Build a cache that matches every slug at its current reply_count.
    const cache = new Map<string, number>(
      probe.added.map((slug, i) => {
        const row = probe.topics[i]!;
        return [slug, row.reply_count];
      }),
    );

    // Now run again with that cache. Expect everything seenUnchanged, no hydration.
    let hydrationCalls = 0;
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient((url) => {
        if (url.includes('/topic/') && url.endsWith('/feed/')) hydrationCalls++;
        return listingPlusThread()(url);
      }),
      maxPages: 1,
      since: { topics: cache },
    });

    assert.equal(result.added.length, 0);
    assert.equal(result.updated.length, 0);
    assert.equal(result.seenUnchanged.length, 30);
    assert.equal(result.topics.length, 0);
    assert.equal(hydrationCalls, 0, 'hydration should not have fetched any topic feeds');
  });

  test('since.topics with mismatched reply_count: marks as updated and hydrates', async () => {
    const probe = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 1,
    });

    // Deliberately wrong reply_count for the first slug; correct for the rest.
    const firstSlug = probe.added[0]!;
    const cache = new Map<string, number>(
      probe.added.map((slug, i) => {
        const row = probe.topics[i]!;
        return [slug, slug === firstSlug ? row.reply_count + 99 : row.reply_count];
      }),
    );

    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 1,
      since: { topics: cache },
    });

    assert.equal(result.updated.length, 1);
    assert.equal(result.updated[0], firstSlug);
    assert.equal(result.added.length, 0);
    assert.equal(result.seenUnchanged.length, 29);
    assert.equal(result.topics.length, 1);
    assert.equal(result.topics[0]!.topic_slug, firstSlug);
  });

  test('activityCutoff in the future stops after page 1 with stopReason: cutoff', async () => {
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 5,
      since: { activityAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, // tomorrow
    });

    // Every row on page 1 has last_activity_at older than "tomorrow", so the min activity
    // of non-sticky rows is <= cutoff → stop after page 1.
    assert.equal(result.stopReason, 'cutoff');
    assert.equal(result.scannedPages, 1);
    // Page 1's rows are included (cutoff rule: current page included before break).
    assert.equal(result.added.length, 30);
  });

  test('404 on page 2 terminates with stopReason: end-of-archive', async () => {
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 5,
    });

    assert.equal(result.stopReason, 'end-of-archive');
    assert.equal(result.scannedPages, 1);
    assert.equal(result.added.length, 30);
  });

  test('hydration throws: topic recorded in partialFailures, slug still in added', async () => {
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient((url) => {
        if (url === LISTING_URL_PAGE(1)) return listingHtml;
        if (url.startsWith('https://wordpress.org/support/plugin/woocommerce/page/')) {
          throw new HttpBailError(`HTTP 404 Not Found at ${url}`, 404);
        }
        if (url.startsWith('https://wordpress.org/support/topic/') && url.endsWith('/feed/')) {
          throw new Error('synthetic hydration failure for test');
        }
        throw new Error(`stub: no response for ${url}`);
      }),
      maxPages: 1,
    });

    assert.equal(result.added.length, 30);
    assert.equal(result.topics.length, 0, 'no topics should be hydrated');
    assert.equal(result.partialFailures.length, 30, 'every hydration should have failed');
    for (const f of result.partialFailures) {
      assert.ok(f.url.startsWith('https://wordpress.org/support/topic/'));
      assert.ok(f.topic_slug.length > 0);
      assert.ok(f.error.includes('synthetic hydration failure'));
    }
  });

  test('skipStickies: false includes stickies', async () => {
    const result = await crawl({
      slug: 'woocommerce',
      http: makeStubClient(listingPlusThread()),
      maxPages: 1,
      skipStickies: false,
    });

    // Page 1 has 3 stickies + 30 non-sticky; with skipStickies:false we should see all 33.
    assert.equal(result.added.length, 33);
    const stickyTopics = result.topics.filter((t) => t.is_sticky);
    assert.equal(stickyTopics.length, 3, 'three stickies should have been hydrated');
  });

  test('missing slug throws with a friendly message', async () => {
    await assert.rejects(
      () =>
        crawl({
          slug: '',
          http: makeStubClient(listingPlusThread()),
        }),
      /options\.slug is required/,
    );
  });

  test('missing email and no http throws with a friendly message', async () => {
    await assert.rejects(
      () =>
        crawl({
          slug: 'woocommerce',
          // No email, no http.
        } as never),
      /options\.email is required/,
    );
  });
});
