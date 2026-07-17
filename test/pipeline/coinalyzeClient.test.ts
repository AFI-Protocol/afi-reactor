/**
 * Coinalyze client hardening (W3 spec section 5): request timeout signal,
 * 60s TTL cache, in-flight de-duplication, and error paths never cached.
 * Behavior-preserving: injected fetch implementations only.
 */
import {
  __resetCoinalyzeClientStateForTests,
  fetchCoinalyzePerpMetrics,
} from "../../src/adapters/coinalyze/coinalyzeClient.js";

type FetchArgs = { url: string; init: RequestInit };

function fakeFetch(
  handler: (url: string) => unknown,
  calls: FetchArgs[]
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = handler(String(url));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const fundingBody = [{ symbol: "BTCUSDT_PERP.A", value: 0.0001, update: 1 }];
const oiBody = [
  { symbol: "BTCUSDT_PERP.A", value: 1_000_000, update: 1 },
  { symbol: "BTCUSDT_PERP.A", value: 1_100_000, update: 2 },
];
const routed = (url: string) => (url.includes("funding-rate") ? fundingBody : oiBody);

describe("coinalyze client hardening", () => {
  const previousKey = process.env.COINALYZE_API_KEY;

  beforeEach(() => {
    process.env.COINALYZE_API_KEY = "test-key";
    __resetCoinalyzeClientStateForTests();
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.COINALYZE_API_KEY;
    else process.env.COINALYZE_API_KEY = previousKey;
    __resetCoinalyzeClientStateForTests();
  });

  it("parses metrics and attaches an abort timeout signal to every request", async () => {
    const calls: FetchArgs[] = [];
    const metrics = await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", {
      fetchImpl: fakeFetch(routed, calls),
      timeoutMs: 1234,
    });

    expect(metrics.fundingRate).toBe(0.0001);
    expect(metrics.oiUsd).toBe(1_100_000);
    expect(metrics.oiHistoryUsd).toEqual([1_000_000, 1_100_000]);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("TTL cache: a second call within the TTL never hits upstream", async () => {
    const calls: FetchArgs[] = [];
    const options = { fetchImpl: fakeFetch(routed, calls), ttlMs: 60_000 };
    await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    const cached = await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    expect(cached.oiUsd).toBe(1_100_000);
    expect(calls).toHaveLength(2); // funding + oi, exactly once

    // Distinct key (timeframe) is NOT served from the cache.
    await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1d", options);
    expect(calls).toHaveLength(4);
  });

  it("TTL cache expires by the injected clock", async () => {
    const calls: FetchArgs[] = [];
    let clock = 1_000_000;
    const options = {
      fetchImpl: fakeFetch(routed, calls),
      ttlMs: 60_000,
      now: () => clock,
    };
    await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    clock += 59_999;
    await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    expect(calls).toHaveLength(2); // still cached
    clock += 2;
    await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    expect(calls).toHaveLength(4); // expired → refetched
  });

  it("in-flight de-dup: concurrent calls for one key share a single upstream request", async () => {
    const calls: FetchArgs[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gatedFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      await gate;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => routed(String(url)),
      } as Response;
    }) as typeof fetch;

    const options = { fetchImpl: gatedFetch };
    const [a, b, c] = [
      fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options),
      fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options),
      fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options),
    ];
    release();
    const results = await Promise.all([a, b, c]);
    expect(calls).toHaveLength(2); // one funding + one oi for all three callers
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("errors are never cached: the next call retries upstream", async () => {
    const calls: FetchArgs[] = [];
    let failFirst = true;
    const flakyFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (failFirst) {
        failFirst = false;
        return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => routed(String(url)),
      } as Response;
    }) as typeof fetch;

    const options = { fetchImpl: flakyFetch };
    await expect(fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options)).rejects.toThrow(
      /funding rate API error: 503/
    );
    const metrics = await fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", options);
    expect(metrics.fundingRate).toBe(0.0001);
    expect(calls.length).toBe(3); // 1 failed + 2 successful
  });

  it("missing COINALYZE_API_KEY still fails honestly (fail-soft handled upstream)", async () => {
    delete process.env.COINALYZE_API_KEY;
    await expect(fetchCoinalyzePerpMetrics("BTCUSDT_PERP.A", "1h", {})).rejects.toThrow(
      /COINALYZE_API_KEY/
    );
  });
});
