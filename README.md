# wporg-scrap

Scrape a WordPress.org plugin support forum into structured data. Programmatic-first; the CLI is a thin wrapper.

## Configuration

The scraper's `User-Agent` includes a contact email so wp.org admins can reach you if something misbehaves. Consumers pass it as `email` to `crawl()`; the CLI reads it from the `WPORG_SCRAP_EMAIL` environment variable.

Copy the template and fill it in (CLI use only):

```bash
cp .env.example .env
# edit .env and set WPORG_SCRAP_EMAIL=you@example.com
```

`.env` is gitignored. The CLI does **not** auto-load it — source it yourself before running, or export the variable inline:

```bash
# inline
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce

# source for the current shell
set -a; source .env; set +a
pnpm scrape woocommerce
```

## Library API

```ts
import { crawl, type Topic, type CrawlResult } from 'wporg-scrap';

const result = await crawl({
  slug: 'woocommerce',
  email: process.env.WPORG_SCRAP_EMAIL!,

  // Incremental mode (optional — omit for a full crawl)
  since: {
    activityAt: lastRunAt,                                  // Date — stop paginating when page-min ≤ this
    topics: new Map([['some-topic-slug', 3], /* ... */]),   // slug → reply_count cache; match = skip
  },

  maxPages: 50,                                             // optional dev cap
  skipStickies: true,                                        // default true; set false to keep pinned topics
  onPage: ({ num, topicsScanned }) => console.log(num, topicsScanned),
});

// result: {
//   slug, startedAt, finishedAt, scannedPages,
//   topics,                       // full hydrated Topic[] for added + updated
//   added, updated, seenUnchanged, // string[] classification overlay
//   stopReason,                   // 'complete' | 'cutoff' | 'end-of-archive' | 'max-pages'
//   partialFailures,              // per-topic hydration failures
// }
```

See `schema/crawl-result.schema.json` for the serialized shape.

## CLI

```bash
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce                      # full crawl → data/woocommerce.json
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce --pages 3            # smoke test → data/woocommerce.partial.json
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce \
  --since-file state.json --out data/woocommerce-delta.json                    # incremental
```

State file shape (CLI only):

```json
{
  "activityAt": "2026-04-20T12:00:00Z",
  "topics": {
    "some-topic-slug": 3,
    "another-topic-slug": 7
  }
}
```

## Install in another project

From GitHub:

```bash
pnpm add github:kmanijak/wporg-scrap
# or SSH:
pnpm add git+ssh://git@github.com:kmanijak/wporg-scrap.git
```

From a local checkout:

```bash
pnpm add file:../wporg-scrap        # copy
pnpm add link:../wporg-scrap        # symlink (picks up edits)
```

Programmatic use (recommended):

```ts
import { crawl } from 'wporg-scrap';
```

CLI use via `bin`:

```bash
WPORG_SCRAP_EMAIL=you@example.com pnpm exec wporg-scrape woocommerce --pages 3
```

## Design notes

- Two-phase serial crawl: HTML listing pagination for discovery, per-thread RSS (`/topic/{slug}/feed/`) for body hydration.
- 500ms rate limit, 15s timeout, 429 Retry-After honored, 5xx/network retried up to 2x.
- Discovery halts on fatal errors. A 404 on page > 1 is treated as end-of-archive (stopReason=`end-of-archive`).
- Hydration failures per topic are captured in `partialFailures`; the crawl continues.
- Stickies are dropped at parse time by default; opt in with `skipStickies: false`.
- The cutoff rule always uses non-sticky rows for the page-min computation, independent of `skipStickies`.
- Skip-vs-hydrate cache uses `reply_count` only — silent edits of existing posts are not detected. By design.
- Atomic write (`.tmp` → rename) in the CLI.
