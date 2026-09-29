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
    private processing = false; // true while a batch is being submitted

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
            // Skip if the previous batch is still running (e.g. handleOps submission
            // or receipt wait takes longer than one interval). Without this lock the
            // same unmarked ops could be picked & submitted twice to the chain.
            if (!this.running || this.processing) return;
            this.processing = true;
            try {
                this.mempool.evictExpired();
                const batch = this.mempool.getNextBatch(this.config.batchSize);
                if (batch.length > 0) {
                    logger.info(`Scheduler: dispatching batch of ${batch.length} ops`);
                    await this.onBatch(batch);
                }
            } catch (err: unknown) {
                logger.error(`Scheduler: batch error: ${(err as Error).message ?? "unknown"}`);
            } finally {
                this.processing = false;
            }
        }, this.config.intervalMs);
        logger.info(`Scheduler: started (interval=${this.config.intervalMs}ms, batchSize=${this.config.batchSize})`);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.running = false;
            this.processing = false;
            logger.info("Scheduler: stopped");
        }
    }
}
