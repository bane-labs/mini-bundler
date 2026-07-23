/**
 * Structured logger with level-based filtering.
 *
 * Supports DEBUG, INFO, WARN, ERROR levels.
 * Each log entry includes timestamp, level, message, and optional context.
 * Use childLogger() to attach fixed context fields to all logs in a flow.
 */

import type { LogLevel, LogContext } from "../types.js";

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

export const logger = {
    debug(message: string, context?: LogContext) {
        if (shouldLog("DEBUG")) console.debug(formatLog("DEBUG", message, context));
    },
    info(message: string, context?: LogContext) {
        if (shouldLog("INFO")) console.log(formatLog("INFO", message, context));
    },
    warn(message: string, context?: LogContext) {
        if (shouldLog("WARN")) console.warn(formatLog("WARN", message, context));
    },
    error(message: string, context?: LogContext) {
        if (shouldLog("ERROR")) console.error(formatLog("ERROR", message, context));
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
