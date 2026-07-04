import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config.js";

export interface InterfaceSettings {
  privateKey: string;
  address: string | null;
  listenPort: string | null;
  extras: Record<string, string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ConfigFileService {
  read(): string {
    return readFileSync(config.amnezia.configPath, "utf8");
  }

  write(contents: string): void {
    this.backup();
    writeFileSync(config.amnezia.configPath, contents, { mode: 0o600 });
  }

  backup(): string {
    mkdirSync(config.amnezia.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(config.amnezia.backupDir, `${basename(config.amnezia.configPath)}.${stamp}.bak`);
    copyFileSync(config.amnezia.configPath, target);
    return target;
  }

  parseInterfaceSettings(contents = this.read()): InterfaceSettings {
    const extras: Record<string, string> = {};
    let privateKey = "";
    let address: string | null = null;
    let listenPort: string | null = null;
    let inInterface = false;

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "[Interface]") {
        inInterface = true;
        continue;
      }
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        if (inInterface) break;
        continue;
      }
      if (!inInterface) continue;

      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim();
      const normalized = key.toLowerCase();

      if (normalized === "privatekey") privateKey = value;
      else if (normalized === "address") address = value;
      else if (normalized === "listenport") listenPort = value;
      else extras[key] = value;
    }

    if (!inInterface || !privateKey) throw new Error("Interface section not found in AmneziaWG config");

    return { privateKey, address, listenPort, extras };
  }

  appendPeerBlock(contents: string, block: string): string {
    const trimmed = contents.trimEnd();
    return `${trimmed}\n\n${block.trim()}\n`;
  }

  removePeerBlock(contents: string, publicKey: string): string {
    const lines = contents.split("\n");
    const peerStarts = lines
      .map((line, index) => (line.trim() === "[Peer]" ? index : -1))
      .filter((index) => index >= 0);

    for (const peerStart of peerStarts) {
      const nextPeerStart = peerStarts.find((index) => index > peerStart) ?? lines.length;
      const blockLines = lines.slice(peerStart, nextPeerStart);
      const publicKeyPattern = new RegExp(`^\\s*PublicKey\\s*=\\s*${escapeRegExp(publicKey)}\\s*$`);
      if (!blockLines.some((line) => publicKeyPattern.test(line))) continue;

      let removeStart = peerStart;
      while (removeStart > 0 && lines[removeStart - 1].startsWith("# amneziya-agent ")) {
        removeStart -= 1;
      }

      const next = [...lines.slice(0, removeStart), ...lines.slice(nextPeerStart)];
      return `${next.join("\n").trimEnd()}\n`;
    }

    return contents;
  }
}

export const configFileService = new ConfigFileService();
