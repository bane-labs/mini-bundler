/**
 * Structured logger with level-based filtering.
 *
 * Supports DEBUG, INFO, WARN, ERROR levels.
 * Each log entry includes timestamp, level, message, and optional context.
 * Use childLogger() to attach fixed context fields to all logs in a flow.
 *
 * Logs are written BOTH to the console (stdout/stderr) and to a log file
 * (default: logs/bundler.log, configurable via LOG_FILE). The logs/ directory
 * is created automatically on startup, so a deployment always has a place
 * to find logs without any manual setup.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LogLevel, LogContext } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Log file path. Defaults to <project-root>/logs/bundler.log.
 * Can be overridden via LOG_FILE (e.g. "/var/log/mini-bundler.log").
 * Set LOG_FILE to "console" to disable file output entirely.
 */
function resolveLogFile(): string | null {
    const env = process.env.LOG_FILE;
    if (env == null) return path.resolve(__dirname, "../../logs/bundler.log");
    if (env.toLowerCase() === "console") return null; // disable file output
    return env;
}

const LOG_FILE = resolveLogFile();

let logStream: fs.WriteStream | null = null;
let fileWarned = false;

function ensureLogStream(): fs.WriteStream | null {
    if (logStream) return logStream;
    if (LOG_FILE == null) return null; // explicitly disabled
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
        // Failures on the file stream must never crash the bundler.
        logStream.on("error", () => {
            logStream = null;
        });
    } catch (err: any) {
        if (!fileWarned) {
            fileWarned = true;
            console.error(`[logging] failed to init log file ${LOG_FILE}: ${err.message} — console only`);
        }
        return null;
    }
    return logStream;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "INFO";

function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatTimestamp(): string {
    return new Date().toISOString();
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const base = `[${formatTimestamp()}] [${level}] ${message}`;
    if (context && Object.keys(context).length > 0) {
        // Extract known fields first, then rest
        const { userOpHash, sender, nonce, method, ...rest } = context;
        const parts: string[] = [];
        if (userOpHash) parts.push(`userOpHash=${userOpHash}`);
        if (sender) parts.push(`sender=${sender}`);
        if (nonce !== undefined) parts.push(`nonce=${nonce}`);
        if (method) parts.push(`method=${method}`);
        for (const [k, v] of Object.entries(rest)) {
            parts.push(`${k}=${v}`);
        }
        return `${base} | ${parts.join(" ")}`;
    }
    return base;
}

function write(level: LogLevel, message: string, context?: LogContext): void {
    if (!shouldLog(level)) return;
    const line = formatLog(level, message, context);
    if (level === "ERROR") {
        console.error(line);
    } else {
        console.log(line);
    }
    const stream = ensureLogStream();
    if (stream) {
        stream.write(line + "\n");
    }
}

export const logger = {
    debug(message: string, context?: LogContext) {
        write("DEBUG", message, context);
    },
    info(message: string, context?: LogContext) {
        write("INFO", message, context);
    },
    warn(message: string, context?: LogContext) {
        write("WARN", message, context);
    },
    error(message: string, context?: LogContext) {
        write("ERROR", message, context);
    },
};

/**
 * Create a child logger with fixed context fields.
 * Useful for attaching userOpHash / sender context to all logs within a flow.
 */
export function childLogger(fixedContext: LogContext) {
    return {
        debug(message: string, extra?: LogContext) {
            logger.debug(message, { ...fixedContext, ...extra });
        },
        info(message: string, extra?: LogContext) {
            logger.info(message, { ...fixedContext, ...extra });
        },
        warn(message: string, extra?: LogContext) {
            logger.warn(message, { ...fixedContext, ...extra });
        },
        error(message: string, extra?: LogContext) {
            logger.error(message, { ...fixedContext, ...extra });
        },
    };
}