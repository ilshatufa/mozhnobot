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
