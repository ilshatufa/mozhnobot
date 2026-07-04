import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { bearerAuth } from "./lib/auth.js";
import { migrateDatabase } from "./db/database.js";
import { actionRoutes } from "./routes/actions.js";
import { downloadRoutes } from "./routes/downloads.js";
import { healthRoutes } from "./routes/health.js";
import { peerRoutes } from "./routes/peers.js";
import { schedulerService } from "./services/scheduler.service.js";

export async function buildApp() {
  migrateDatabase();

  const app = Fastify({
    logger: true
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute"
  });

  app.addHook("preHandler", bearerAuth);

  await app.register(healthRoutes);
  await app.register(peerRoutes);
  await app.register(actionRoutes);
  await app.register(downloadRoutes);

  schedulerService.start(app.log);
  app.addHook("onClose", async () => {
    schedulerService.stop();
  });

  return app;
}
