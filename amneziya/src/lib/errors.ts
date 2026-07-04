import type { FastifyReply } from "fastify";

export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): FastifyReply {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  });
}

export function notImplemented(reply: FastifyReply, operation: string): FastifyReply {
  return sendApiError(reply, 501, "not_implemented", `${operation} is not implemented yet`);
}
