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
  // Sticky topics carry the class "sticky" on the ul; we skip them so only
  // the 30 paginated topics are returned (stickies repeat on every page).
  const topicEls = root.querySelectorAll('ul[id^="bbp-topic-"]');

  for (const el of topicEls) {
    // Skip sticky topics — they appear on every page and are not part of the
    // paginated listing.
    if (el.classList.contains('sticky')) continue;

    const titleLink = el.querySelector('li.bbp-topic-title a.bbp-topic-permalink');
    if (!titleLink) continue;

    const url = titleLink.getAttribute('href') ?? '';
    const topic_slug = url.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!topic_slug || seen.has(topic_slug)) continue;
    seen.add(topic_slug);

    // Title text: strip the resolved span's aria-label if present, then trim.
    const title = titleLink.text.trim();

    // Opener author: span.bbp-author-name inside .bbp-topic-started-by in
    // the title li. The <a> carries class bbp-author-link (not bbp-author-name).
    const authorEl = el.querySelector(
      'li.bbp-topic-title .bbp-topic-started-by span.bbp-author-name',
    );
    const author = authorEl?.text.trim() ?? '';

    const voiceEl = el.querySelector('li.bbp-topic-voice-count');
    const voice_count = voiceEl ? Number(voiceEl.text.trim()) : 0;

    const replyEl = el.querySelector('li.bbp-topic-reply-count');
    const reply_count = replyEl ? Number(replyEl.text.trim()) : 0;

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
    });
  }

  return rows;
}

function parseFreshnessDate(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  // Branch B only: <a title="April 20, 2026 at 8:11 am"> — absolute date in a
  // title attribute. The "at" keyword is not understood by Date.parse(), so we
  // replace it with a space before parsing.
  // No <time datetime=...> elements are present on wp.org support listings.
  const linkWithTitle = el.querySelector('a[title]');
  if (linkWithTitle) {
    const title = (linkWithTitle.getAttribute('title') ?? '').replace(' at ', ' ');
    const d = new Date(title);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}
