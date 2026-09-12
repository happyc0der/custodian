/**
 * Per-tool latency bookkeeping. Alexa+ budgets <500 ms round-trip per tool
 * call, so every handler is timed and the rolling p50/p95 are exposed at
 * `/metrics.json` for the smoke test and the README.
 */
interface Series {
  samples: number[];
  errors: number;
}

const series = new Map<string, Series>();
const MAX_SAMPLES = 500;

export function recordLatency(tool: string, ms: number, isError: boolean): void {
  let s = series.get(tool);
  if (!s) {
    s = { samples: [], errors: 0 };
    series.set(tool, s);
  }
  s.samples.push(ms);
  if (s.samples.length > MAX_SAMPLES) s.samples.shift();
  if (isError) s.errors += 1;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export function latencySnapshot(): Record<string, { count: number; p50: number; p95: number; max: number; errors: number }> {
  const out: Record<string, { count: number; p50: number; p95: number; max: number; errors: number }> = {};
  for (const [tool, s] of series) {
    const sorted = [...s.samples].sort((a, b) => a - b);
    out[tool] = {
      count: s.samples.length,
      p50: +percentile(sorted, 50).toFixed(2),
      p95: +percentile(sorted, 95).toFixed(2),
      max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
      errors: s.errors,
    };
  }
  return out;
}

export async function timed<T>(tool: string, fn: () => Promise<T>, isError: (r: T) => boolean): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordLatency(tool, performance.now() - start, isError(result));
    return result;
  } catch (err) {
    recordLatency(tool, performance.now() - start, true);
    throw err;
  }
}
