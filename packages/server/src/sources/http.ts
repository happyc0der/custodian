export type FetchLike = typeof fetch;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

/** GET JSON with a hard timeout. Recall APIs are public but occasionally slow; never let them stall a sweep. */
export async function fetchJson<T>(
  url: string,
  opts: { fetch?: FetchLike; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const f = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await f(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'custodian-recall-watch/0.1 (+https://github.com/happyc0der/custodian)',
        ...opts.headers,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}
