# wporg-scrap

Scrape a WordPress.org plugin support forum into a local JSON file.

## Configuration

The scraper sends every request with a `User-Agent` that includes a contact
email, so wp.org admins can reach you if something misbehaves. Set it via
the `WPORG_SCRAP_EMAIL` environment variable — the CLI throws a clear error
before making any network request if it's unset.

Copy the template and fill it in:

```bash
cp .env.example .env
# edit .env and set WPORG_SCRAP_EMAIL=you@example.com
```

`.env` is gitignored. The scraper does **not** auto-load it — source it
yourself before running, or export the variable inline:

```bash
# one-shot inline
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce

# source .env for the current shell
set -a; source .env; set +a
pnpm scrape woocommerce
```

## Use it in this repo

```bash
pnpm install
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce              # full crawl → data/woocommerce.json
WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce --pages 3    # smoke test → data/woocommerce.partial.json
```

Output shape is documented in a JSON Schema at [`schema/scrape-result.schema.json`](./schema/scrape-result.schema.json). Summary: `{ slug, scraped_at, topics: [{ url, topic_slug, title, author, pub_date, last_activity_at, last_activity_author, reply_count, voice_count, is_resolved, opener: { author, pub_date, body_md }, replies: [...] }] }`.

Full runs take ~13 min (wp.org caps pagination around 49–50 pages × 30 topics).

## Install in another project

From GitHub:

```bash
pnpm add github:<owner>/wporg-scrap
# or, for SSH:
pnpm add git+ssh://git@github.com:<owner>/wporg-scrap.git
```

From a local checkout:

```bash
pnpm add file:../wporg-scrap        # copy
pnpm add link:../wporg-scrap        # symlink (picks up edits)
```

Then run the CLI via the `bin` (don't forget the env var):

```bash
WPORG_SCRAP_EMAIL=you@example.com pnpm exec wporg-scrape woocommerce --pages 3
```

The script executes its TypeScript source via `tsx` (no build step). Output lands in `./data/{slug}.json` (or `.partial.json` if `--pages < 50`) in the **consuming project's** working directory.

## Design notes

- Two-phase serial crawl: HTML listing pagination for discovery, per-thread RSS (`/topic/{slug}/feed/`) for body hydration.
- 500ms rate limit, 15s timeout, 429 Retry-After honored, 5xx/network retried up to 2x.
- Discovery halts on fatal errors (except `HTTP 404` on `page/N` after valid pages — that's end-of-archive).
- Hydration skips individual topic failures and exits non-zero if any were skipped.
- Atomic write (`.tmp` → rename).

