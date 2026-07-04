import { formatBytesDecimal } from "../lib/format-bytes.js";
import type { AwgRuntimePeer } from "./awg.service.js";
import type { PeerRecord, PeerTrafficRecord } from "../repositories/peer.repository.js";

export function buildPeerResponse(peer: PeerRecord, runtime: AwgRuntimePeer | null, traffic: PeerTrafficRecord | null) {
  const rxBytes = runtime?.rxBytes ?? traffic?.lastRxBytes ?? 0;
  const txBytes = runtime?.txBytes ?? traffic?.lastTxBytes ?? 0;
  const totalRxBytes = traffic?.totalRxBytes ?? rxBytes;
  const totalTxBytes = traffic?.totalTxBytes ?? txBytes;
  const trafficUsedBytes = totalRxBytes + totalTxBytes;

  return {
    peerId: peer.publicKey,
    client: peer.client,
    assignedIp: peer.assignedIp,
    enabled: peer.enabled,
    deleted: peer.deletedAt !== null,
    latestHandshakeAt: runtime?.latestHandshakeAt ?? null,
    endpoint: runtime?.endpoint ?? null,
    rxBytes,
    txBytes,
    totalRxBytes,
    totalTxBytes,
    trafficLimitBytes: peer.trafficLimitBytes,
    trafficUsedBytes,
    display: {
      rx: formatBytesDecimal(rxBytes),
      tx: formatBytesDecimal(txBytes),
      trafficUsed: formatBytesDecimal(trafficUsedBytes),
      trafficLimit: formatBytesDecimal(peer.trafficLimitBytes)
    },
    expiresAt: peer.expiresAt,
    disabledReason: peer.disabledReason,
    createdAt: peer.createdAt,
    updatedAt: peer.updatedAt
  };
}

