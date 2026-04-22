import { parse, type HTMLElement } from 'node-html-parser';
import type { ListingRow } from './types.ts';

export function buildListingUrl(slug: string, page: number): string {
  return page === 1
    ? `https://wordpress.org/support/plugin/${slug}/`
    : `https://wordpress.org/support/plugin/${slug}/page/${page}/`;
}

export function parseListingPage(html: string): ListingRow[] {
  const root = parse(html);
  const rows: ListingRow[] = [];
  const seen = new Set<string>();

  // Row-scoping selector: ul[id^="bbp-topic-"] matches all topic rows.
  // Sticky topics carry the class "sticky" on the ul; we include them as they are
  // legitimate forum threads (the de-dup on topic_slug handles any repeats safely).
  const topicEls = root.querySelectorAll('ul[id^="bbp-topic-"]');

  for (const el of topicEls) {
    const titleLink = el.querySelector('li.bbp-topic-title a.bbp-topic-permalink');
    if (!titleLink) continue;

    const url = titleLink.getAttribute('href') ?? '';
    const topic_slug = url.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!topic_slug || seen.has(topic_slug)) continue;
    seen.add(topic_slug);

    const title = titleLink.text.trim();

    // Opener author: span.bbp-author-name inside .bbp-topic-started-by in
    // the title li. The <a> carries class bbp-author-link (not bbp-author-name).
    const authorEl = el.querySelector(
      'li.bbp-topic-title .bbp-topic-started-by span.bbp-author-name',
    );
    const author = authorEl?.text.trim() ?? '';

    const parseCount = (text: string | undefined): number => {
      const n = Number(text?.trim() ?? '');
      return Number.isFinite(n) ? n : 0;
    };

    const voiceEl = el.querySelector('li.bbp-topic-voice-count');
    const voice_count = parseCount(voiceEl?.text);

    const replyEl = el.querySelector('li.bbp-topic-reply-count');
    const reply_count = parseCount(replyEl?.text);

    const freshnessEl = el.querySelector('li.bbp-topic-freshness');
    const last_activity_at = parseFreshnessDate(freshnessEl);

    // Freshness author: span.bbp-author-name inside .bbp-topic-freshness-author.
    const freshAuthorEl = freshnessEl?.querySelector(
      '.bbp-topic-freshness-author span.bbp-author-name',
    );
    const last_activity_author = freshAuthorEl?.text.trim() ?? '';

    // Resolved marker: span.resolved is inside the title permalink <a>.
    const is_resolved = !!el.querySelector('span.resolved');

    rows.push({
      url,
      topic_slug,
      title,
      author,
      last_activity_at,
      last_activity_author,
      reply_count,
      voice_count,
      is_resolved,
      is_sticky: false,
    });
  }

  return rows;
}

function parseFreshnessDate(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  // wp.org listing freshness dates are exposed as <a title="Month DD, YYYY at H:MM am"> only.
  // The title is in UTC; append " UTC" before parsing so the runner's local TZ doesn't shift the ISO output.
  const linkWithTitle = el.querySelector('a[title]');
  if (linkWithTitle) {
    const title = (linkWithTitle.getAttribute('title') ?? '').replace(' at ', ' ') + ' UTC';
    const d = new Date(title);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}
