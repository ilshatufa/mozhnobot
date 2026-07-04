import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { actionLogRepository } from "../repositories/action-log.repository.js";
import { downloadTokenRepository } from "../repositories/download-token.repository.js";
import { peerRepository } from "../repositories/peer.repository.js";

export interface DownloadLinkResult {
  url: string;
  expiresAt: string;
}

export interface DownloadFileResult {
  filename: string;
  configText: string;
}

export class DownloadService {
  createLink(client: string): DownloadLinkResult | null {
    downloadTokenRepository.deleteExpired();

    const peer = peerRepository.findByClient(client);
    if (!peer || !peer.configText) return null;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + config.amnezia.downloadTtlSeconds * 1000).toISOString();
    downloadTokenRepository.create({ token, peerId: peer.id, client: peer.client, expiresAt });
    actionLogRepository.create({
      action: "download_link_created",
      client: peer.client,
      peerId: peer.id,
      payload: { expiresAt }
    });

    return {
      url: `${config.amnezia.publicBaseUrl.replace(/\/+$/, "")}/downloads/${token}`,
      expiresAt
    };
  }

  consumeToken(token: string): DownloadFileResult | null {
    const result = this.findValidDownload(token);
    if (!result) return null;

    downloadTokenRepository.markUsed(token);
    actionLogRepository.create({
      action: "config_downloaded",
      client: result.client,
      peerId: result.peerId
    });

    return {
      filename: result.filename,
      configText: result.configText
    };
  }

  peekToken(token: string): DownloadFileResult | null {
    const result = this.findValidDownload(token);
    if (!result) return null;
    return {
      filename: result.filename,
      configText: result.configText
    };
  }

  private findValidDownload(token: string): (DownloadFileResult & { peerId: number; client: string | null }) | null {
    const record = downloadTokenRepository.findByToken(token);
    if (!record || record.usedAt !== null || record.expiresAt <= new Date().toISOString()) return null;

    const peer = peerRepository.findById(record.peerId);
    if (!peer || !peer.configText || peer.deletedAt !== null) return null;

    return {
      peerId: peer.id,
      client: peer.client,
      filename: config.amnezia.downloadFilename,
      configText: peer.configText
    };
  }
}

export const downloadService = new DownloadService();
