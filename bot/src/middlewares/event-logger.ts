import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import { eventLoggerService } from "../services/event-logger.service.js";

export function eventLoggerMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    try {
      await eventLoggerService.logContext(ctx);
    } catch (error) {
      logger.error("Failed to log Telegram event", error);
    }

    return next();
  };
}
