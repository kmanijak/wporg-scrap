import type { HttpClient } from './http.ts';
import { HttpBailError } from './http.ts';
import { parseListingPage, buildListingUrl } from './listings.ts';
import type { ListingRow, StopReason } from './types.ts';

export type DiscoverOptions = {
  slug: string;
  http: HttpClient;
  maxPages: number;
  skipStickies: boolean;
  activityCutoff: Date | undefined;
  onPage?: (event: { num: number; topicsScanned: number }) => void;
};

export type DiscoverResult = {
  rows: ListingRow[];
  scannedPages: number;
  stopReason: StopReason;
};

export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const { slug, http, maxPages, skipStickies, activityCutoff, onPage } = options;
  const byTopicSlug = new Map<string, ListingRow>();
  const cutoffIso = activityCutoff ? activityCutoff.toISOString() : undefined;
  let scannedPages = 0;
  let stopReason: StopReason = 'max-pages';

  for (let p = 1; p <= maxPages; p++) {
    const url = buildListingUrl(slug, p);
    let html: string;
    try {
      html = await http.fetchText(url);
    } catch (err) {
      if (err instanceof HttpBailError && err.status === 404 && p > 1) {
        stopReason = 'end-of-archive';
        break;
      }
      throw err;
    }
    scannedPages = p;
    const pageRows = parseListingPage(html);

    if (onPage) onPage({ num: p, topicsScanned: pageRows.length });

    if (pageRows.length === 0) {
      stopReason = 'complete';
      break;
    }

    // Cutoff always uses non-sticky rows regardless of skipStickies, so pinned
    // ancient announcements cannot falsely trigger early stop on page 1.
    const nonSticky = pageRows.filter((r) => !r.is_sticky);
    if (cutoffIso !== undefined && nonSticky.length > 0) {
      const activityDates = nonSticky
        .map((r) => r.last_activity_at)
        .filter((d) => d.length > 0);
      if (activityDates.length > 0) {
        const minActivity = activityDates.reduce((m, d) => (d < m ? d : m));
        if (minActivity <= cutoffIso) {
          // Include this page's rows (filtered per skipStickies) then stop.
          for (const row of skipStickies ? nonSticky : pageRows) {
            if (!byTopicSlug.has(row.topic_slug)) byTopicSlug.set(row.topic_slug, row);
          }
          stopReason = 'cutoff';
          break;
        }
      }
    }

    const rowsToInclude = skipStickies ? nonSticky : pageRows;
    for (const row of rowsToInclude) {
      if (!byTopicSlug.has(row.topic_slug)) byTopicSlug.set(row.topic_slug, row);
    }
  }

  return {
    rows: [...byTopicSlug.values()],
    scannedPages,
    stopReason,
  };
}
