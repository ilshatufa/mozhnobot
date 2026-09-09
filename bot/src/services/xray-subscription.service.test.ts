import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhitelistCdnLink,
  outboundFromUri,
  rewriteNativeHtml,
  subscriptionLinksForServer,
} from "./xray-subscription.service.js";

const SOURCE_LINK = [
  "vless://11111111-2222-3333-4444-555555555555@xraynl.vpn.mozhno.org:443",
  "?type=xhttp&security=tls&path=%2Fapi%2Fupload",
  "&host=xraynl.vpn.mozhno.org&sni=xraynl.vpn.mozhno.org",
  "&alpn=h2&mode=packet-up&flow=xtls-rprx-vision&fp=chrome",
  "#old-name",
].join("");

test("adds the Russia-labelled whitelist CDN profiles after the Netherlands profile", () => {
  const links = subscriptionLinksForServer(SOURCE_LINK, {
    code: "nl",
    name: "🇳🇱 МОЖНО • Нидерланды",
  });

  assert.equal(links.length, 3);
  assert.equal(
    decodeURIComponent(new URL(links[0]).hash.slice(1)),
    "🇳🇱 МОЖНО • Нидерланды",
  );

  const cdn = new URL(links[1]);
  assert.equal(cdn.username, "11111111-2222-3333-4444-555555555555");
  assert.equal(cdn.hostname, "yc.cdn.mozhno.org");
  assert.equal(cdn.port, "443");
  assert.equal(cdn.searchParams.get("type"), "xhttp");
  assert.equal(cdn.searchParams.get("security"), "tls");
  assert.equal(cdn.searchParams.get("sni"), "yc.cdn.mozhno.org");
  assert.equal(cdn.searchParams.get("host"), "yc.cdn.mozhno.org");
  assert.equal(cdn.searchParams.get("path"), "/api/upload");
  assert.equal(cdn.searchParams.get("mode"), "packet-up");
  assert.equal(cdn.searchParams.get("alpn"), "h2");
  assert.equal(cdn.searchParams.get("fp"), "chrome");
  assert.equal(cdn.searchParams.has("flow"), false);
  assert.equal(decodeURIComponent(cdn.hash.slice(1)), "🇷🇺 МОЖНО • Белые списки — Нидерланды");

  const extra = JSON.parse(cdn.searchParams.get("extra") ?? "null") as Record<string, unknown>;
  assert.equal(extra.uplinkDataPlacement, "header");
  assert.equal(extra.uplinkDataKey, "X-Playback-Token");
  assert.equal(extra.uplinkHTTPMethod, "GET");
  assert.equal(extra.serverMaxHeaderBytes, 32768);

  const vkCdn = new URL(links[2]);
  assert.equal(vkCdn.username, "11111111-2222-3333-4444-555555555555");
  assert.equal(vkCdn.hostname, "vk.cdn.mozhno.org");
  assert.equal(vkCdn.port, "443");
  assert.equal(vkCdn.searchParams.get("type"), "xhttp");
  assert.equal(vkCdn.searchParams.get("security"), "tls");
  assert.equal(vkCdn.searchParams.get("sni"), "vk.cdn.mozhno.org");
  assert.equal(vkCdn.searchParams.get("host"), "vk.cdn.mozhno.org");
  assert.equal(vkCdn.searchParams.get("path"), "/api/upload");
  assert.equal(vkCdn.searchParams.get("mode"), "packet-up");
  assert.equal(vkCdn.searchParams.get("alpn"), "h2");
  assert.equal(vkCdn.searchParams.get("fp"), "chrome");
  assert.equal(vkCdn.searchParams.has("flow"), false);
  assert.equal(
    decodeURIComponent(vkCdn.hash.slice(1)),
    "🇷🇺 МОЖНО • Белые списки — VK Cloud",
  );

  const vkExtra = JSON.parse(vkCdn.searchParams.get("extra") ?? "null") as Record<
    string,
    unknown
  >;
  assert.deepEqual(vkExtra, extra);
});

test("does not add the CDN profile to another server or a non-XHTTP link", () => {
  assert.equal(
    subscriptionLinksForServer(SOURCE_LINK, { code: "de", name: "МОЖНО • Германия" }).length,
    1,
  );
  assert.equal(buildWhitelistCdnLink(SOURCE_LINK.replace("type=xhttp", "type=tcp")), null);
});

test("keeps the XHTTP extra object in JSON subscriptions", () => {
  const cdnLink = buildWhitelistCdnLink(SOURCE_LINK);
  assert.ok(cdnLink);

  const outbound = outboundFromUri(cdnLink);
  assert.ok(outbound);
  const streamSettings = outbound.streamSettings as Record<string, unknown>;
  const xhttpSettings = streamSettings.xhttpSettings as Record<string, unknown>;
  const extra = xhttpSettings.extra as Record<string, unknown>;

  assert.equal(streamSettings.network, "xhttp");
  assert.equal(xhttpSettings.path, "/api/upload");
  assert.equal(xhttpSettings.mode, "packet-up");
  assert.equal(extra.xPaddingObfsMode, true);
  assert.equal(extra.scMaxBufferedPosts, 2048);
});

test("adds the CDN profile to the native HTML subscription data", () => {
  const marker = "window.__SUB_PAGE_DATA__=";
  const html = `<html><head></head><body><script>${marker}${JSON.stringify({
    links: [SOURCE_LINK],
    subUrl: "https://old.example/sub/test",
  })};</script></body></html>`;

  const rewritten = rewriteNativeHtml(Buffer.from(html, "utf8"), "test-sub-id").toString("utf8");
  const start = rewritten.indexOf(marker) + marker.length;
  const end = rewritten.indexOf(";</script>", start);
  const pageData = JSON.parse(rewritten.slice(start, end)) as { links: string[] };

  assert.equal(pageData.links.length, 3);
  assert.equal(new URL(pageData.links[1]).hostname, "yc.cdn.mozhno.org");
  assert.equal(new URL(pageData.links[2]).hostname, "vk.cdn.mozhno.org");
});
