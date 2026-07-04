import type { FastifyInstance } from "fastify";
import { actionLogRepository } from "../repositories/action-log.repository.js";
import { peerService } from "../services/peer.service.js";
import { sendApiError } from "../lib/errors.js";

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/actions", async (request) => {
    const query = request.query as { client?: string; peerId?: string; action?: string; limit?: string };
    return actionLogRepository.list({
      client: query.client,
      peerId: query.peerId ? Number(query.peerId) : undefined,
      action: query.action,
      limit: query.limit ? Number(query.limit) : undefined
    });
  });

  app.get("/peers/by-client/:client/actions", async (request, reply) => {
    const { client } = request.params as { client: string };
    const peer = await peerService.getRecordByClient(client);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return actionLogRepository.list({ peerId: peer.id });
  });

  app.get("/peers/:peerId/actions", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return actionLogRepository.list({ peerId: peer.id });
  });
}
