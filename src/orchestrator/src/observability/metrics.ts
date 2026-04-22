/**
 * Injectable metrics registry for in-process counter and histogram tracking.
 *
 * Each `MetricsRegistry` instance owns its own isolated maps, enabling test
 * isolation via `reset()` and dependency injection in future refactors.
 * The module also re-exports free functions that delegate to a shared
 * `defaultRegistry`, preserving the existing call-site API.
 */

const DEFAULT_HISTOGRAM_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
];

/**
 * Maximum distinct label-set entries tracked per counter.
 *
 * Prevents unbounded cardinality growth when label values are user-controlled.
 * Entries beyond this cap are silently dropped; a counter named
 * `<name>_cardinality_dropped` records the overflow count.
 */
const MAX_COUNTER_CARDINALITY = 1000;

interface HistogramData {
  buckets: number[];
  counts: number[];
  sum: number;
  total: number;
}

/**
 * Self-contained metrics store with counters, histograms, and a reset hook.
 *
 * Instantiate one per logical boundary (e.g. one per test suite) to avoid
 * cross-contamination between test cases.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramData>();

  /**
   * Increments an in-memory counter metric keyed by its name plus sorted labels.
   *
   * Enforces `MAX_COUNTER_CARDINALITY` to prevent label-cardinality explosion
   * when label values derive from user input or request parameters.
   *
   * @param name - Metric name.
   * @param labels - Optional static label map.
   * @param delta - Increment amount applied to the counter.
   */
  incrementMetric(
    name: string,
    labels: Record<string, string> = {},
    delta = 1,
  ): void {
    const labelEntries = Object.entries(labels).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const suffix = labelEntries
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    const key = suffix ? `${name}|${suffix}` : name;

    if (!this.counters.has(key)) {
      // Count only distinct label-set entries (not the overflow sentinel itself).
      const distinctForName = [...this.counters.keys()].filter(
        (k) => k === name || k.startsWith(`${name}|`),
      ).length;
      if (distinctForName >= MAX_COUNTER_CARDINALITY) {
        // Record that we dropped an observation rather than silently losing it.
        const overflowKey = `${name}_cardinality_dropped`;
        this.counters.set(
          overflowKey,
          (this.counters.get(overflowKey) ?? 0) + delta,
        );
        return;
      }
    }

    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
  }

  /**
   * Records duration observations into fixed buckets suitable for Prometheus exposition.
   *
   * @param name - Histogram name.
   * @param valueMs - Observed latency in milliseconds.
   */
  observeDurationMs(name: string, valueMs: number): void {
    const existing = this.histograms.get(name) ?? {
      buckets: DEFAULT_HISTOGRAM_BUCKETS,
      counts: new Array<number>(DEFAULT_HISTOGRAM_BUCKETS.length).fill(0),
      sum: 0,
      total: 0,
    };

    for (let index = 0; index < existing.buckets.length; index += 1) {
      if (valueMs <= existing.buckets[index]!) {
        existing.counts[index]! += 1;
      }
    }
    existing.sum += valueMs;
    existing.total += 1;
    this.histograms.set(name, existing);
  }

  /**
   * Renders in-memory metrics using Prometheus text exposition format.
   *
   * @returns Text payload consumable by Prometheus scrapers.
   */
  renderMetrics(): string {
    const lines: string[] = [];

    for (const [key, value] of this.counters.entries()) {
      const [name, rawLabels] = key.split("|");
      if (rawLabels) {
        const labels = rawLabels
          .split(",")
          .map((entry) => entry.split("="))
          .map(([labelKey, labelValue]) => `${labelKey}="${labelValue}"`)
          .join(",");
        lines.push(`${name}{${labels}} ${value}`);
      } else {
        lines.push(`${name} ${value}`);
      }
    }

    for (const [name, histogram] of this.histograms.entries()) {
      for (let index = 0; index < histogram.buckets.length; index += 1) {
        lines.push(
          `${name}_bucket{le="${histogram.buckets[index]}"} ${histogram.counts[index]}`,
        );
      }
      lines.push(`${name}_bucket{le="+Inf"} ${histogram.total}`);
      lines.push(`${name}_sum ${histogram.sum}`);
      lines.push(`${name}_count ${histogram.total}`);
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * Clears all counters and histograms in this registry.
   *
   * Intended for test isolation — call in `beforeEach` / `afterEach` hooks to
   * prevent metric state from leaking between test cases.
   * Do not call in production code paths.
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

/**
 * Shared process-wide metrics registry used by all production code paths.
 *
 * Test code should create a fresh `MetricsRegistry` instance rather than
 * relying on this singleton, to avoid cross-test contamination.
 */
export const defaultRegistry = new MetricsRegistry();

/**
 * Increments a counter in the default process-wide registry.
 *
 * Delegates to `defaultRegistry.incrementMetric`. Provided for backward
 * compatibility with existing call sites that import free functions.
 *
 * @param name - Metric name.
 * @param labels - Optional static label map.
 * @param delta - Increment amount applied to the counter.
 */
export function incrementMetric(
  name: string,
  labels: Record<string, string> = {},
  delta = 1,
): void {
  defaultRegistry.incrementMetric(name, labels, delta);
}

/**
 * Records a duration observation in the default process-wide registry.
 *
 * Delegates to `defaultRegistry.observeDurationMs`. Provided for backward
 * compatibility with existing call sites that import free functions.
 *
 * @param name - Histogram name.
 * @param valueMs - Observed latency in milliseconds.
 */
export function observeDurationMs(name: string, valueMs: number): void {
  defaultRegistry.observeDurationMs(name, valueMs);
}

/**
 * Renders metrics from the default process-wide registry in Prometheus format.
 *
 * Delegates to `defaultRegistry.renderMetrics`. Provided for backward
 * compatibility with existing call sites that import free functions.
 *
 * @returns Text payload consumable by Prometheus scrapers.
 */
export function renderMetrics(): string {
  return defaultRegistry.renderMetrics();
}
