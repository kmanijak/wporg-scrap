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

// Legacy v1 shape. Retained through the refactor; removed in Task 8.
export type ScrapeResult = {
  slug: string;
  scraped_at: string;
  topics: Topic[];
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
