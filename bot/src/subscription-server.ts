import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { prisma } from "./database.js";
import { logger } from "./logger.js";
import { registerProcessErrorHandlers } from "./error-handling.js";
import { xraySubscriptionService } from "./services/xray-subscription.service.js";

const SUB_PATH_RE = /^\/sub\/([A-Za-z0-9._~-]+)$/;
const SUB_ASSET_PATH_RE = /^\/sub\/assets\/([A-Za-z0-9._~-]+)$/;

function sendText(res: http.ServerResponse, status: number, text: string): void {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function clientAddress(req: http.IncomingMessage): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "";
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendText(res, 405, "method not allowed\n");
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    sendText(res, 200, "ok\n");
    return;
  }
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    res.end();
    return;
  }

  const assetMatch = url.pathname.match(SUB_ASSET_PATH_RE);
  if (assetMatch) {
    const renderedAsset = await xraySubscriptionService.renderAsset(assetMatch[1]);
    res.writeHead(200, {
      ...renderedAsset.headers,
      "Content-Length": String(renderedAsset.body.length),
    });
    res.end(renderedAsset.body);
    return;
  }

  const match = url.pathname.match(SUB_PATH_RE);
  if (!match) {
    sendText(res, 404, "not found\n");
    return;
  }

  const subId = match[1];
  const userAgent = req.headers["user-agent"] ?? "";
  const acceptHeader = req.headers.accept ?? "";
  const rendered = await xraySubscriptionService.render(
    subId,
    Array.isArray(userAgent) ? userAgent.join(" ") : userAgent,
    clientAddress(req),
    Array.isArray(acceptHeader) ? acceptHeader.join(",") : acceptHeader
  );

  if (!rendered) {
    sendText(res, 404, "subscription not found\n");
    return;
  }

  res.writeHead(200, {
    ...rendered.headers,
    "Content-Length": String(rendered.body.length),
  });
  res.end(rendered.body);
}

async function main(): Promise<void> {
  await prisma.$connect();
  let shuttingDown = false;
  let trafficSyncTimer: NodeJS.Timeout | null = null;

  const scheduleTrafficSync = (delayMs: number) => {
    trafficSyncTimer = setTimeout(async () => {
      try {
        await xraySubscriptionService.syncAllTraffic();
      } catch (err) {
        logger.error("Periodic Xray traffic synchronization failed", err);
      } finally {
        if (!shuttingDown) {
          scheduleTrafficSync(config.xraySubscription.trafficSyncIntervalMs);
        }
      }
    }, delayMs);
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error("Xray subscription request failed", err);
      if (!res.headersSent) {
        sendText(res, 500, "internal error\n");
      } else {
        res.end();
      }
    });
  });

  const shutdown = async (signal: string) => {
    shuttingDown = true;
    if (trafficSyncTimer) clearTimeout(trafficSyncTimer);
    logger.info(`${signal} received, shutting down xray subscription server...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.xraySubscription.port, config.xraySubscription.host, () => {
    logger.info("Xray subscription server started", {
      host: config.xraySubscription.host,
      port: config.xraySubscription.port,
      title: config.xraySubscription.title,
      publicBaseUrl: config.vpnServers.xui.multiSubBaseUrl || null,
    });
    scheduleTrafficSync(1000);
  });
}

registerProcessErrorHandlers();

main().catch((err) => {
  logger.fatal("Failed to start xray subscription server:", err);
  process.exit(1);
});
