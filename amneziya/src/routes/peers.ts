import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendApiError } from "../lib/errors.js";
import { peerService } from "../services/peer.service.js";

const clientSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.@:-]+$/);

const createPeerSchema = z.object({
  client: clientSchema,
  expiresAt: z.string().datetime().nullable().optional(),
  trafficLimitBytes: z.number().int().positive().nullable().optional()
});

const updateLimitsSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  trafficLimitBytes: z.number().int().positive().nullable().optional()
});

const disablePeerSchema = z.object({
  reason: z.string().min(1).max(80).optional().default("manual")
});

export async function peerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/peers", async (request, reply) => {
    try {
      const query = request.query as { includeDeleted?: string };
      return await peerService.list(query.includeDeleted === "true");
    } catch (error) {
      return sendApiError(
        reply,
        500,
        "list_peers_failed",
        "Failed to list peers",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.post("/peers", async (request, reply) => {
    const parsed = createPeerSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid create peer payload", parsed.error.flatten());
    }

    try {
      return await peerService.create(parsed.data);
    } catch (error) {
      return sendApiError(
        reply,
        500,
        "create_peer_failed",
        "Failed to create peer",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.get("/peers/by-client/:client", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");

    const peer = await peerService.getByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return peer;
  });

  app.get("/peers/by-client/:client/config", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");

    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    const configText = peerService.getConfig(peer);
    if (!configText) return sendApiError(reply, 404, "config_not_found", "Peer config is not stored");
    return { peerId: peer.publicKey, client: peer.client, config: configText };
  });

  app.get("/peers/by-client/:client/qr", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");

    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    const qrPngBase64 = await peerService.getQr(peer);
    if (!qrPngBase64) return sendApiError(reply, 404, "config_not_found", "Peer config is not stored");
    return { peerId: peer.publicKey, client: peer.client, qrPngBase64 };
  });

  app.post("/peers/by-client/:client/disable", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");
    const parsed = disablePeerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid disable peer payload", parsed.error.flatten());
    }

    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.disable(peer, parsed.data.reason);
  });

  app.post("/peers/by-client/:client/enable", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");
    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    try {
      return await peerService.enable(peer);
    } catch (error) {
      return sendApiError(
        reply,
        409,
        "enable_peer_failed",
        "Failed to enable peer",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.patch("/peers/by-client/:client/limits", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");
    const parsed = updateLimitsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid limits payload", parsed.error.flatten());
    }

    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.updateLimits(peer, parsed.data);
  });

  app.delete("/peers/by-client/:client", async (request, reply) => {
    const { client } = request.params as { client: string };
    const parsedClient = clientSchema.safeParse(client);
    if (!parsedClient.success) return sendApiError(reply, 400, "validation_failed", "Invalid client");
    const peer = await peerService.getRecordByClient(parsedClient.data);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.delete(peer);
  });

  app.get("/peers/:peerId", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return peer;
  });

  app.get("/peers/:peerId/config", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    const configText = peerService.getConfig(peer);
    if (!configText) return sendApiError(reply, 404, "config_not_found", "Peer config is not stored");
    return { peerId: peer.publicKey, client: peer.client, config: configText };
  });

  app.get("/peers/:peerId/qr", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    const qrPngBase64 = await peerService.getQr(peer);
    if (!qrPngBase64) return sendApiError(reply, 404, "config_not_found", "Peer config is not stored");
    return { peerId: peer.publicKey, client: peer.client, qrPngBase64 };
  });

  app.post("/peers/:peerId/disable", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const parsed = disablePeerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid disable peer payload", parsed.error.flatten());
    }

    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.disable(peer, parsed.data.reason);
  });

  app.post("/peers/:peerId/enable", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    try {
      return await peerService.enable(peer);
    } catch (error) {
      return sendApiError(
        reply,
        409,
        "enable_peer_failed",
        "Failed to enable peer",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.patch("/peers/:peerId/limits", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const parsed = updateLimitsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "validation_failed", "Invalid limits payload", parsed.error.flatten());
    }

    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.updateLimits(peer, parsed.data);
  });

  app.delete("/peers/:peerId", async (request, reply) => {
    const { peerId } = request.params as { peerId: string };
    const peer = await peerService.getRecordByPublicKey(peerId);
    if (!peer) return sendApiError(reply, 404, "peer_not_found", "Peer not found");
    return await peerService.delete(peer);
  });
}
