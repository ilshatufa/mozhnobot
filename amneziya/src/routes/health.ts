import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { awgService } from "../services/awg.service.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const awg = await awgService.health();

    return {
      ok: true,
      service: "amneziya-agent",
      interface: config.amnezia.interfaceName,
      awgActive: awg.awgActive,
      awgAvailable: awg.awgAvailable,
      ...(awg.error ? { awgError: awg.error } : {})
    };
  });
}
