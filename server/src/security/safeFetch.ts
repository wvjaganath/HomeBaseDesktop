import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface SafeFetchOptions {
  /** Exact hostnames that may be contacted. Required. */
  allowHosts: readonly string[];
  /** Allow plain http (LAN services such as the plane tracker). Default false. */
  allowHttp?: boolean;
  /** Allow private / loopback addresses (LAN services only). Default false. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Default GET. POST bodies are JSON only, and POSTs never follow redirects. */
  method?: 'GET' | 'POST';
  json?: unknown;
  /** Return 4xx/5xx responses (with their body) instead of throwing. */
  allowErrorStatus?: boolean;
}

const PRIVATE_V4: Array<[number, number]> = [
  [0x0a000000, 8], // 10/8
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0x64400000, 10], // 100.64/10 (CGNAT)
  [0x00000000, 8], // 0/8
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
    return PRIVATE_V4.some(([base, bits]) => (n & (~0 << (32 - bits))) >>> 0 === base >>> 0);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped?.[1] !== undefined ? isPrivateAddress(mapped[1]) : false;
}

/**
 * fetch() with SSRF guards: host allow-list, scheme check, no redirects to
 * other hosts, private-address rejection for internet services, a timeout and
 * a response-size cap. The URL must never come from a client request.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<Response & { bodyText: string; bodyBuffer: Buffer }> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    throw new FetchError(`scheme not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) throw new FetchError('credentials in URL not allowed');
  if (!opts.allowHosts.includes(url.hostname)) throw new FetchError(`host not allowed: ${url.hostname}`);

  if (!opts.allowPrivate) {
    const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      throw new FetchError(`host resolves to a private address: ${url.hostname}`);
    }
  }

  const method = opts.method ?? 'GET';
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    headers: {
      accept: 'application/json, text/calendar;q=0.9, */*;q=0.1',
      ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
  });

  if (res.status >= 300 && res.status < 400) {
    if (method !== 'GET') throw new FetchError('unexpected redirect', res.status);
    const location = res.headers.get('location');
    if (!location) throw new FetchError('redirect without location', res.status);
    const next = new URL(location, url);
    // Follow at most one hop, and only to an allow-listed host.
    if (!opts.allowHosts.includes(next.hostname)) throw new FetchError('redirect to disallowed host', res.status);
    return safeFetch(next.toString(), { ...opts, allowHosts: [next.hostname] });
  }
  if (!res.ok && !opts.allowErrorStatus) throw new FetchError(`upstream status ${res.status}`, res.status);

  const max = opts.maxBytes ?? 2 * 1024 * 1024;
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) throw new FetchError('response too large');

  const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new FetchError('response too large');
      }
      chunks.push(value);
    }
  }
  const bodyBuffer = Buffer.concat(chunks);
  return Object.assign(res, { bodyBuffer, bodyText: bodyBuffer.toString('utf8') });
}

export async function safeFetchJson(rawUrl: string, opts: SafeFetchOptions): Promise<unknown> {
  const res = await safeFetch(rawUrl, opts);
  try {
    return JSON.parse(res.bodyText) as unknown;
  } catch {
    throw new FetchError('invalid JSON from upstream');
  }
}
