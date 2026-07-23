import express from "express";

import { config, mempoolConfig, rateLimitConfig } from "./config.js";
import { rpcHandler } from "./rpc.js";
import { Bundler } from "./bundler.js";
import { renderMetrics } from "./metrics/index.js";
import { logger } from "./logging/index.js";
import { closeDb } from "./storage/index.js";
import { cleanupRateBuckets } from "./security/index.js";

const app = express();

app.use(express.json({ limit: "256kb" }));

const bundler = new Bundler();

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        entryPoint: config.entryPoint,
        chain: config.chain.name,
        chainId: config.chain.id,
    });
});

app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(renderMetrics());
});

app.post("/", rpcHandler);

const server = app.listen(config.port, () => {
    logger.info(`Mini Bundler listening on ${config.port}`);
    logger.info(`EntryPoint: ${config.entryPoint}`);
    logger.info(`Chain: ${config.chain.name} (${config.chain.id})`);

    bundler.startScheduler();
});

// Cleanup rate limit buckets periodically
const cleanupInterval = setInterval(cleanupRateBuckets, 120_000);

function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down...`);
    bundler.stopScheduler();
    clearInterval(cleanupInterval);
    server.close(() => {
        closeDb();
        logger.info("Server closed.");
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
