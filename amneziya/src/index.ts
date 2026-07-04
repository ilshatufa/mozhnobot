import { config } from "./config.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Stopping amneziya-agent");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, "Failed to start amneziya-agent");
  process.exit(1);
}
