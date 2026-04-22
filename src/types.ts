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

export type ScrapeResult = {
  slug: string;
  scraped_at: string;
  topics: Topic[];
};
