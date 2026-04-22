const CONTACT_EMAIL = process.env.WPORG_SCRAP_EMAIL;
if (!CONTACT_EMAIL) {
  throw new Error(
    'Set WPORG_SCRAP_EMAIL to a contact email — wp.org asks scrapers to be identifiable. ' +
      'Example: WPORG_SCRAP_EMAIL=you@example.com pnpm scrape woocommerce',
  );
}
const USER_AGENT = `wporg-scrap/0.1 (+${CONTACT_EMAIL})`;
const TIMEOUT_MS = 15_000;
const DELAY_MS = 500;
const MAX_429_RETRIES = 3;
const MAX_5XX_RETRIES = 2;

let lastRequestAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < DELAY_MS) await sleep(DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}

export class HttpBailError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'HttpBailError';
    this.status = status;
  }
}

export async function fetchText(url: string): Promise<string> {
  let rateLimitRetries = 0;
  let serverErrorRetries = 0;

  while (true) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        if (rateLimitRetries >= MAX_429_RETRIES) {
          throw new HttpBailError(`429 exceeded retries at ${url}`, 429);
        }
        rateLimitRetries += 1;
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 30;
        const waitMs = (Number.isFinite(retryAfterSec) ? retryAfterSec : 30) * 1000;
        console.error(
          `[http] 429 at ${url}, sleeping ${waitMs}ms (retry ${rateLimitRetries}/${MAX_429_RETRIES})`,
        );
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        if (serverErrorRetries >= MAX_5XX_RETRIES) {
          throw new HttpBailError(`${res.status} exceeded retries at ${url}`, res.status);
        }
        serverErrorRetries += 1;
        console.error(
          `[http] ${res.status} at ${url}, retrying in 1s (retry ${serverErrorRetries}/${MAX_5XX_RETRIES})`,
        );
        await sleep(1000);
        continue;
      }

      if (!res.ok) {
        throw new HttpBailError(`HTTP ${res.status} ${res.statusText} at ${url}`, res.status);
      }

      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpBailError) throw err;
      if (serverErrorRetries >= MAX_5XX_RETRIES) throw err;
      serverErrorRetries += 1;
      console.error(
        `[http] network error at ${url}: ${err}; retrying in 1s (retry ${serverErrorRetries}/${MAX_5XX_RETRIES})`,
      );
      await sleep(1000);
    }
  }
}
