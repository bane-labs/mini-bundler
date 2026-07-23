/**
 * Monitoring — Prometheus-format metrics.
 *
 * Tracks pending UserOps, simulation latency, validation failures,
 * execution failures, gas usage, bundle size, confirmation time.
 */

import { logger } from "../logging/index.js";

interface MetricCounter {
    value: number;
    labels?: Record<string, string>;
}

interface MetricHistogram {
    values: number[];
    sum: number;
    count: number;
}

const counters = new Map<string, MetricCounter>();
const histograms = new Map<string, MetricHistogram>();
const gauges = new Map<string, number>();

function incCounter(name: string, value = 1, labels?: Record<string, string>) {
    const key = labels ? `${name}:${JSON.stringify(labels)}` : name;
    const existing = counters.get(key);
    if (existing) {
        existing.value += value;
    } else {
        counters.set(key, { value, labels });
    }
}

function setGauge(name: string, value: number) {
    gauges.set(name, value);
}

function observeHistogram(name: string, value: number) {
    let h = histograms.get(name);
    if (!h) {
        h = { values: [], sum: 0, count: 0 };
        histograms.set(name, h);
    }
    h.values.push(value);
    h.sum += value;
    h.count++;
}

export const metrics = {
    incPendingOps: () => incCounter("bundler_pending_userops_total"),
    decPendingOps: () => incCounter("bundler_pending_userops_total", -1),
    setPendingCount: (n: number) => setGauge("bundler_pending_userops", n),

    recordSimulationLatency: (ms: number) => observeHistogram("bundler_simulation_latency_ms", ms),
    incValidationFailures: () => incCounter("bundler_validation_failures_total"),
    incExecutionFailures: () => incCounter("bundler_execution_failures_total"),

    recordGasUsed: (gas: number) => incCounter("bundler_gas_used_total", gas),
    recordBundleSize: (size: number) => observeHistogram("bundler_bundle_size", size),
    recordConfirmationTime: (ms: number) => observeHistogram("bundler_confirmation_time_ms", ms),

    incBundlesSubmitted: () => incCounter("bundler_bundles_submitted_total"),
    incOpsSubmitted: (count: number) => incCounter("bundler_ops_submitted_total", count),

    setBaseFee: (fee: number) => setGauge("bundler_base_fee_wei", fee),
};

/**
 * Render all metrics in Prometheus text exposition format.
 */
export function renderMetrics(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, counter] of counters) {
        const name = key.split(":")[0];
        const labels = counter.labels
            ? `{${Object.entries(counter.labels)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join(",")}}`
            : "";
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name}${labels} ${counter.value}`);
    }

    // Gauges
    for (const [name, value] of gauges) {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${value}`);
    }

    // Histograms
    for (const [name, h] of histograms) {
        lines.push(`# TYPE ${name} histogram`);
        const sorted = [...h.values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
        lines.push(`${name}_sum ${h.sum}`);
        lines.push(`${name}_count ${h.count}`);
        lines.push(`${name}_p50 ${p50}`);
        lines.push(`${name}_p95 ${p95}`);
        lines.push(`${name}_p99 ${p99}`);
    }

    lines.push("");
    return lines.join("\n");
}
