import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { sendApiError } from "./errors.js";

export async function bearerAuth(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const authorization = request.headers.authorization;
  const expected = `Bearer ${config.token}`;

  if (authorization !== expected) {
    return sendApiError(reply, 401, "unauthorized", "Invalid or missing bearer token");
  }
}
