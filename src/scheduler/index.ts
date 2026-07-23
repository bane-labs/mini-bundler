/**
 * Scheduler — periodic batch dispatcher.
 *
 * Picks ops from the mempool at configurable intervals
 * and triggers bundle submission.
 */

import { Mempool } from "../mempool/index.js";
import { logger } from "../logging/index.js";

export interface SchedulerConfig {
    intervalMs: number;
    batchSize: number;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    intervalMs: 3_000, // every 3 seconds
    batchSize: 10,
};

export class Scheduler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private config: SchedulerConfig;
    private running = false;

    constructor(
        private mempool: Mempool,
        private onBatch: (ops: ReturnType<Mempool["getNextBatch"]>) => Promise<void>,
        config?: Partial<SchedulerConfig>,
    ) {
        this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    }

    start() {
        if (this.timer) return;
        this.running = true;
        this.timer = setInterval(async () => {
            if (!this.running) return;
            try {
                this.mempool.evictExpired();
                const batch = this.mempool.getNextBatch(this.config.batchSize);
                if (batch.length > 0) {
                    logger.info(`Scheduler: dispatching batch of ${batch.length} ops`);
                    await this.onBatch(batch);
                }
            } catch (err: unknown) {
                logger.error(`Scheduler: batch error: ${(err as Error).message ?? "unknown"}`);
            }
        }, this.config.intervalMs);
        logger.info(`Scheduler: started (interval=${this.config.intervalMs}ms, batchSize=${this.config.batchSize})`);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.running = false;
            logger.info("Scheduler: stopped");
        }
    }
}
