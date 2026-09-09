import assert from "node:assert/strict";
import test from "node:test";
import type { XuiServerConfig } from "../config.js";
import { xuiInboundIdsForNewClient } from "./xui-client.js";

function server(additionalInboundIds: number[]): XuiServerConfig {
  return {
    code: "nl",
    name: "Netherlands",
    apiBaseUrl: "https://panel.example.test",
    subBaseUrl: "https://sub.example.test",
    inboundId: 1,
    additionalInboundIds,
    username: "test",
    password: "test",
    clientFlow: "",
    clientApiMode: "clients",
  };
}

test("adds a new client to the primary and CDN inbounds", () => {
  assert.deepEqual(xuiInboundIdsForNewClient(server([5])), [1, 5]);
});

test("deduplicates configured inbound IDs", () => {
  assert.deepEqual(xuiInboundIdsForNewClient(server([1, 5, 5])), [1, 5]);
});

test("reads, attaches and detaches explicit client inbounds through the clients API", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const responses = [
    { success: true, obj: { inboundIds: [1, 5, 5, 0, "bad"] } },
    { success: true },
    { success: true },
  ];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { XuiClient } = await import("./xui-client.js");
    const client = new XuiClient();
    const apiServer = { ...server([]), apiToken: "test-token" };

    assert.deepEqual(await client.getClientInboundIds(apiServer, "user+vpn@example.test"), [1, 5]);
    await client.attachClientToInbounds(apiServer, "user+vpn@example.test", [7, 7, -1]);
    await client.detachClientFromInbounds(apiServer, "user+vpn@example.test", [5]);

    assert.deepEqual(requests, [
      {
        url: "https://panel.example.test/panel/api/clients/get/user%2Bvpn%40example.test",
        method: "GET",
        body: null,
      },
      {
        url: "https://panel.example.test/panel/api/clients/user%2Bvpn%40example.test/attach",
        method: "POST",
        body: { inboundIds: [7] },
      },
      {
        url: "https://panel.example.test/panel/api/clients/user%2Bvpn%40example.test/detach",
        method: "POST",
        body: { inboundIds: [5] },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses bulk enable and treats a skipped client as an error", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      success: true,
      obj: { changed: 0, skipped: [{ email: "missing", reason: "client not found" }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { XuiClient } = await import("./xui-client.js");
    const client = new XuiClient();
    const apiServer = { ...server([]), apiToken: "test-token" };

    await assert.rejects(
      client.setClientEnabled(apiServer, "missing", true),
      /bulkEnable skipped missing: client not found/,
    );
    assert.deepEqual(requests, ["https://panel.example.test/panel/api/clients/bulkEnable"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads generated links for one client without using a shared subscription", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      success: true,
      obj: ["vless://id@example.test:443?type=xhttp#one", "https://ignored.example.test"],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { XuiClient } = await import("./xui-client.js");
    const client = new XuiClient();
    const apiServer = { ...server([]), apiToken: "test-token" };

    assert.deepEqual(await client.getClientLinks(apiServer, "user+vpn@example.test"), [
      "vless://id@example.test:443?type=xhttp#one",
    ]);
    assert.deepEqual(requests, [
      "https://panel.example.test/panel/api/clients/links/user%2Bvpn%40example.test",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
