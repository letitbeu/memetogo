"use client";

import { useEffect } from "react";

const DETAIL_DELAY_MS = 180;
const DETAIL_CACHE_MS = 60_000;
const MAX_CACHE = 48;

type CachedResponse = {
  at: number;
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
};

function abortError() {
  return new DOMException("Detail request superseded", "AbortError");
}

function responseFrom(row: CachedResponse) {
  return new Response(row.body, {
    status: row.status,
    statusText: row.statusText,
    headers: row.headers,
  });
}

export default function DetailRequestStabilizer() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cache = new Map<string, CachedResponse>();
    const inflight = new Map<string, Promise<CachedResponse>>();
    let generation = 0;

    function isTokenDetail(input: RequestInfo | URL) {
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(raw, window.location.origin);
        return url.origin === window.location.origin && url.pathname === "/api/token";
      } catch {
        return false;
      }
    }

    function keyOf(input: RequestInfo | URL) {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new URL(raw, window.location.origin).toString();
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!isTokenDetail(input)) return originalFetch(input, init);

      const key = keyOf(input);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < DETAIL_CACHE_MS) return responseFrom(cached);

      const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) throw abortError();

      const mine = ++generation;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, DETAIL_DELAY_MS);
        const onAbort = () => {
          window.clearTimeout(timer);
          reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        window.setTimeout(() => signal?.removeEventListener("abort", onAbort), DETAIL_DELAY_MS + 20);
      });

      // A newer project was selected during the debounce window.
      if (mine !== generation || signal?.aborted) throw abortError();

      let pending = inflight.get(key);
      if (!pending) {
        pending = originalFetch(input, { ...init, cache: "default" })
          .then(async response => ({
            at: Date.now(),
            body: await response.text(),
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
          }))
          .then(row => {
            cache.delete(key);
            cache.set(key, row);
            while (cache.size > MAX_CACHE) {
              const oldest = cache.keys().next().value as string | undefined;
              if (!oldest) break;
              cache.delete(oldest);
            }
            return row;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }

      return responseFrom(await pending);
    };

    return () => {
      window.fetch = originalFetch;
      generation += 1;
      cache.clear();
      inflight.clear();
    };
  }, []);

  return null;
}
