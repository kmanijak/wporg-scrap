export type ListingRow = {
  url: string;
  topic_slug: string;
  title: string;
  author: string;
  last_activity_at: string;
  last_activity_author: string;
  reply_count: number;
  voice_count: number;
  is_resolved: boolean;
  is_sticky: boolean;
};

export type Post = {
  author: string;
  pub_date: string;
  body_md: string;
};

export type Topic = ListingRow & {
  pub_date: string;
  opener: Post;
  replies: Post[];
};

export type StopReason = 'complete' | 'cutoff' | 'end-of-archive' | 'max-pages';

export type PartialFailure = {
  topic_slug: string;
  url: string;
  error: string;
};

export type CrawlOptions = {
  slug: string;
  email: string;
  since?: {
    activityAt?: Date;
    topics?: Map<string, number>;
  };
  maxPages?: number;
  skipStickies?: boolean;
  onPage?: (event: { num: number; topicsScanned: number }) => void;
};

/**
 * In-library, `startedAt` and `finishedAt` are `Date` objects. Note that when
 * a `CrawlResult` is serialized via `JSON.stringify` (as the CLI does), these
 * become ISO-8601 strings on disk — see `schema/crawl-result.schema.json`.
 * Consumers re-reading the CLI's JSON output should parse them with `new Date(...)`.
 */
export type CrawlResult = {
  slug: string;
  startedAt: Date;
  finishedAt: Date;
  scannedPages: number;
  topics: Topic[];
  added: string[];
  updated: string[];
  seenUnchanged: string[];
  stopReason: StopReason;
  partialFailures: PartialFailure[];
};
