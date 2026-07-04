import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendApiError } from "../lib/errors.js";
import { downloadService } from "../services/download.service.js";

const createDownloadSchema = z.object({
  client: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.@:-]+$/)
});

const tokenSchema = z.string().min(20).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/downloads", async (request, reply) => {
    const parsed = createDownloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid download link payload", parsed.error.flatten());
    }

    const result = downloadService.createLink(parsed.data.client);
    if (!result) return sendApiError(reply, 404, "config_not_found", "Peer config is not available");

    return result;
  });

  app.get("/downloads/:token", { exposeHeadRoute: false }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) return sendApiError(reply, 404, "download_not_found", "Download link is not available");

    const result = downloadService.consumeToken(parsed.data);
    if (!result) return sendApiError(reply, 404, "download_not_found", "Download link expired or already used");

    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.configText);
  });

  app.head("/downloads/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) return sendApiError(reply, 404, "download_not_found", "Download link is not available");

    const result = downloadService.peekToken(parsed.data);
    if (!result) return sendApiError(reply, 404, "download_not_found", "Download link expired or already used");

    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .header("Content-Length", Buffer.byteLength(result.configText, "utf8"))
      .send();
  });
}
