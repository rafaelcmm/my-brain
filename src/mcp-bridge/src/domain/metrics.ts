import type { HistogramState } from "./types.js";

/**
 * In-memory metric store rendered in Prometheus text format.
 */
export class BridgeMetrics {
  private readonly counters = new Map<string, number>();

  private readonly histograms = new Map<string, HistogramState>();

  /**
   * Increments counter metric with stable sorted labels.
   *
   * @param name Metric name.
   * @param labels Label map used for dimensional counters.
   * @param delta Increment amount.
   */
  increment(name: string, labels: Record<string, string> = {}, delta = 1): void {
    const labelEntries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    const suffix = labelEntries.map(([key, value]) => `${key}=${value}`).join(",");
    const metricKey = suffix ? `${name}|${suffix}` : name;
    this.counters.set(metricKey, (this.counters.get(metricKey) ?? 0) + delta);
  }

  /**
   * Observes latency samples in fixed buckets expressed in milliseconds.
   *
   * @param name Histogram metric base name.
   * @param valueMs Observed duration value.
   */
  observeDurationMs(name: string, valueMs: number): void {
    const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    const existing =
      this.histograms.get(name) ?? {
        buckets,
        counts: new Array(buckets.length).fill(0),
        sum: 0,
        total: 0,
      };

    for (let index = 0; index < existing.buckets.length; index += 1) {
      const bucket = existing.buckets[index];
      if (bucket !== undefined && valueMs <= bucket) {
        existing.counts[index] += 1;
      }
    }

    existing.sum += valueMs;
    existing.total += 1;
    this.histograms.set(name, existing);
  }

  /**
   * Renders all counters and histograms in Prometheus exposition format.
   *
   * @returns Text payload consumed by Prometheus scrapers.
   */
  render(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters.entries()) {
      const [name, labels] = key.split("|");
      if (!labels) {
        lines.push(`${name} ${value}`);
        continue;
      }

      const labelText = labels
        .split(",")
        .map((entry) => entry.split("="))
        .map(([labelKey, labelValue]) => `${labelKey}="${labelValue}"`)
        .join(",");
      lines.push(`${name}{${labelText}} ${value}`);
    }

    for (const [name, histogram] of this.histograms.entries()) {
      for (let index = 0; index < histogram.buckets.length; index += 1) {
        lines.push(`${name}_bucket{le="${histogram.buckets[index]}"} ${histogram.counts[index]}`);
      }
      lines.push(`${name}_bucket{le="+Inf"} ${histogram.total}`);
      lines.push(`${name}_sum ${histogram.sum}`);
      lines.push(`${name}_count ${histogram.total}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

/**
 * Seeds zero-valued counters so dashboards can discover metric names before traffic.
 *
 * @param metrics Metrics store to seed.
 */
export function seedMetrics(metrics: BridgeMetrics): void {
  metrics.increment("mb_bridge_tool_calls_total", { tool: "none", status: "init" }, 0);
  metrics.increment("mb_bridge_tools_list_total", {}, 0);
  metrics.increment("mb_remember_total", {}, 0);
  metrics.increment("mb_recall_total", { result: "miss" }, 0);
  metrics.increment("mb_dedup_hits_total", {}, 0);
  metrics.increment("mb_forget_total", { mode: "soft" }, 0);
}
