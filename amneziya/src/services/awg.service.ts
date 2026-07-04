import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export interface AwgHealth {
  awgAvailable: boolean;
  awgActive: boolean;
  error?: string;
}

export interface AwgRuntimePeer {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string;
  latestHandshakeAt: string | null;
  rxBytes: number;
  txBytes: number;
  persistentKeepalive: string;
}

function handshakeEpochToIso(value: string): string | null {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return new Date(epoch * 1000).toISOString();
}

export class AwgService {
  async health(): Promise<AwgHealth> {
    try {
      await execFileAsync("awg", ["show", config.amnezia.interfaceName], { timeout: 5000 });
      return { awgAvailable: true, awgActive: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown awg error";
      return {
        awgAvailable: !message.includes("ENOENT"),
        awgActive: false,
        error: message
      };
    }
  }

  async dumpPeers(): Promise<AwgRuntimePeer[]> {
    const { stdout } = await execFileAsync("awg", ["show", config.amnezia.interfaceName, "dump"], {
      timeout: 5000
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.slice(1).map((line) => {
      const fields = line.split("\t");
      const [publicKey, , endpoint, allowedIps, latestHandshake, rxBytes, txBytes, persistentKeepalive] = fields;

      return {
        publicKey,
        endpoint: endpoint === "(none)" ? null : endpoint,
        allowedIps,
        latestHandshakeAt: handshakeEpochToIso(latestHandshake),
        rxBytes: Number(rxBytes),
        txBytes: Number(txBytes),
        persistentKeepalive
      };
    });
  }

  async getServerPublicKey(): Promise<string> {
    const { stdout } = await execFileAsync("awg", ["show", config.amnezia.interfaceName, "public-key"], {
      timeout: 5000
    });
    return stdout.trim();
  }

  async generatePrivateKey(): Promise<string> {
    const { stdout } = await execFileAsync("awg", ["genkey"], { timeout: 5000 });
    return stdout.trim();
  }

  async generatePresharedKey(): Promise<string> {
    const { stdout } = await execFileAsync("awg", ["genpsk"], { timeout: 5000 });
    return stdout.trim();
  }

  async publicKeyFromPrivate(privateKey: string): Promise<string> {
    return runWithInput("awg", ["pubkey"], privateKey);
  }

  async applyConfig(): Promise<void> {
    await execFileAsync(
      "bash",
      [
        "-lc",
        `awg syncconf ${shellQuote(config.amnezia.interfaceName)} <(awg-quick strip ${shellQuote(config.amnezia.configPath)})`
      ],
      { timeout: 10000 }
    );
  }
}

export const awgService = new AwgService();

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runWithInput(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr}`));
    });

    child.stdin.end(`${input.trim()}\n`);
  });
}
