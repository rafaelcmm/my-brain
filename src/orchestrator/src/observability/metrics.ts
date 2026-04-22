const metricsCounters = new Map<string, number>();
const metricsHistograms = new Map<
  string,
  { buckets: number[]; counts: number[]; sum: number; total: number }
>();

/**
 * Increments an in-memory counter metric keyed by its name plus sorted labels.
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
  const labelEntries = Object.entries(labels).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const suffix = labelEntries
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const key = suffix ? `${name}|${suffix}` : name;
  const current = metricsCounters.get(key) ?? 0;
  metricsCounters.set(key, current + delta);
}

/**
 * Records duration observations into fixed buckets suitable for Prometheus exposition.
 *
 * @param name - Histogram name.
 * @param valueMs - Observed latency in milliseconds.
 */
export function observeDurationMs(name: string, valueMs: number): void {
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const existing = metricsHistograms.get(name) ?? {
    buckets,
    counts: new Array(buckets.length).fill(0),
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
  metricsHistograms.set(name, existing);
}

/**
 * Renders in-memory metrics using Prometheus text exposition format.
 *
 * @returns Text payload consumable by Prometheus scrapers.
 */
export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [key, value] of metricsCounters.entries()) {
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

  for (const [name, histogram] of metricsHistograms.entries()) {
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
