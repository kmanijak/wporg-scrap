import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http.ts';
import { htmlToMarkdown } from './convert.ts';
import type { ListingRow, Post, Topic } from './types.ts';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  cdataPropName: '__cdata',
});

type RssItem = {
  pubDate?: unknown;
  'dc:creator'?: unknown;
  creator?: unknown;
  'content:encoded'?: unknown;
  description?: unknown;
};

export async function hydrateTopic(row: ListingRow): Promise<Topic> {
  const feedUrl = `https://wordpress.org/support/topic/${row.topic_slug}/feed/`;
  const xml = await fetchText(feedUrl);
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel) throw new Error(`Missing RSS channel at ${feedUrl}`);

  const channelPubDate = normalizePubDate(channel.pubDate);
  const itemsRaw = channel.item;
  const items: RssItem[] = Array.isArray(itemsRaw)
    ? itemsRaw
    : itemsRaw
    ? [itemsRaw]
    : [];
  if (items.length === 0) throw new Error(`No items in RSS at ${feedUrl}`);

  const posts: Post[] = items.map((it) => {
    const creator = it['dc:creator'] ?? it.creator ?? '';
    const pub = normalizePubDate(it.pubDate);
    const rawHtml = extractContent(it);
    return {
      author: String(creator).trim(),
      pub_date: pub,
      body_md: htmlToMarkdown(rawHtml),
    };
  });

  // Primary: match channel pubDate to an item (per spec).
  // Fallback: use the earliest-dated item as the opener (handles feeds where
  // the channel omits <pubDate>, which occurs on real wp.org thread feeds).
  let openerIdx = channelPubDate
    ? posts.findIndex((p) => p.pub_date === channelPubDate)
    : -1;

  if (openerIdx < 0) {
    // Fall back to the item with the earliest pub_date.
    openerIdx = posts.reduce(
      (minIdx, p, i) =>
        p.pub_date && (!posts[minIdx]!.pub_date || p.pub_date < posts[minIdx]!.pub_date)
          ? i
          : minIdx,
      0,
    );
  }

  const opener = posts[openerIdx]!;
  const replies = posts.filter((_, i) => i !== openerIdx);

  return {
    ...row,
    pub_date: opener.pub_date,
    opener,
    replies,
  };
}

function extractContent(item: RssItem): string {
  const encoded = item['content:encoded'];
  if (typeof encoded === 'string') return encoded;
  if (encoded && typeof encoded === 'object' && '__cdata' in encoded) {
    return String((encoded as { __cdata: unknown }).__cdata);
  }
  const desc = item.description;
  if (typeof desc === 'string') return desc;
  if (desc && typeof desc === 'object' && '__cdata' in desc) {
    return String((desc as { __cdata: unknown }).__cdata);
  }
  return '';
}

function normalizePubDate(rfc822: unknown): string {
  if (!rfc822) return '';
  const d = new Date(String(rfc822));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}
