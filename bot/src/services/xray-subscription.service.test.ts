import assert from "node:assert/strict";
import test from "node:test";
import { VpnSubscriptionInboundStatus } from "@prisma/client";
import {
  hasCompleteRequiredInbounds,
  mapProviderLinksByInbound,
  outboundFromUri,
  rewriteNativeHtml,
} from "./xray-subscription.service.js";
import {
  PAID_YANDEX_CDN_PUBLIC_PROFILE,
  renderVpnInboundProfile,
  YANDEX_CDN_PUBLIC_PROFILE,
} from "./vpn-public-profile.js";

const SOURCE_LINK = [
  "vless://11111111-2222-3333-4444-555555555555@xraynl.vpn.mozhno.org:443",
  "?type=xhttp&security=tls&path=%2Fapi%2Fupload",
  "&host=xraynl.vpn.mozhno.org&sni=xraynl.vpn.mozhno.org",
  "&alpn=h2&mode=packet-up&flow=xtls-rprx-vision&fp=chrome",
  "#old-name",
].join("");

const ROUTER_SOURCE_LINK = SOURCE_LINK.replace(":443", ":10443");

test("requires every active required inbound before rendering a subscription", () => {
  const product = {
    inbounds: [
      { inboundId: 1, isRequired: true, inbound: { isActive: true } },
      { inboundId: 2, isRequired: true, inbound: { isActive: true } },
    ],
  };

  assert.equal(hasCompleteRequiredInbounds({
    product,
    inboundStates: [
      { inboundId: 1, status: VpnSubscriptionInboundStatus.ACTIVE },
      { inboundId: 2, status: VpnSubscriptionInboundStatus.ACTIVE },
    ],
  }), true);
  assert.equal(hasCompleteRequiredInbounds({
    product,
    inboundStates: [
      { inboundId: 1, status: VpnSubscriptionInboundStatus.ACTIVE },
      { inboundId: 2, status: VpnSubscriptionInboundStatus.ERROR },
    ],
  }), false);
});

test("uses a separate Yandex CDN domain for the paid whitelist", () => {
  const paid = new URL(renderVpnInboundProfile(
    SOURCE_LINK.replace(":443", ":12443"),
    "🇷🇺 МОЖНО • Белые списки — Нидерланды",
    PAID_YANDEX_CDN_PUBLIC_PROFILE,
  ));

  assert.equal(paid.hostname, "paid.yc.cdn.mozhno.org");
  assert.equal(paid.port, "443");
  assert.equal(paid.searchParams.get("sni"), "paid.yc.cdn.mozhno.org");
  assert.equal(paid.searchParams.get("host"), "paid.yc.cdn.mozhno.org");
});

test("renders direct and CDN profiles from explicit inbound metadata", () => {
  const links = [
    renderVpnInboundProfile(SOURCE_LINK, "🇳🇱 МОЖНО • Нидерланды", null),
    renderVpnInboundProfile(
      SOURCE_LINK,
      "🇷🇺 МОЖНО • Белые списки — Нидерланды",
      YANDEX_CDN_PUBLIC_PROFILE,
    ),
  ];

  assert.equal(
    decodeURIComponent(new URL(links[0]).hash.slice(1)),
    "🇳🇱 МОЖНО • Нидерланды",
  );

  const cdn = new URL(links[1]);
  assert.equal(cdn.username, "11111111-2222-3333-4444-555555555555");
  assert.equal(cdn.hostname, "mozhnoclub.yc.cdn.mozhno.org");
  assert.equal(cdn.port, "443");
  assert.equal(cdn.searchParams.get("type"), "xhttp");
  assert.equal(cdn.searchParams.get("security"), "tls");
  assert.equal(cdn.searchParams.get("sni"), "mozhnoclub.yc.cdn.mozhno.org");
  assert.equal(cdn.searchParams.get("host"), "mozhnoclub.yc.cdn.mozhno.org");
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

  assert.deepEqual(extra.xmux, {
    cMaxReuseTimes: "36-96",
    maxConnections: "32-64",
    hKeepAlivePeriod: 0,
    hMaxRequestTimes: "320-640",
    hMaxReusableSecs: "720-1800",
  });
});

test("maps provider links to inbounds by port rather than response order", () => {
  const direct = SOURCE_LINK.replace(":443", ":11443");
  const whitelist = SOURCE_LINK.replace(":443", ":12443");
  const mapped = mapProviderLinksByInbound(
    [whitelist, direct],
    [
      { inboundId: 6, code: "paid-nl-direct", port: 11443 },
      { inboundId: 7, code: "paid-nl-yandex-cdn", port: 12443 },
    ],
  );

  assert.equal(mapped.get(6), direct);
  assert.equal(mapped.get(7), whitelist);
});

test("keeps a router profile direct because it has no public override", () => {
  const link = renderVpnInboundProfile(
    ROUTER_SOURCE_LINK,
    "🇳🇱 МОЖНО • Роутер — Нидерланды",
    null,
  );
  assert.equal(new URL(link).port, "10443");
  assert.equal(new URL(link).hostname, "xraynl.vpn.mozhno.org");
});

test("keeps the XHTTP extra object in JSON subscriptions", () => {
  const cdnLink = renderVpnInboundProfile(
    SOURCE_LINK,
    "🇷🇺 МОЖНО • Белые списки — Нидерланды",
    YANDEX_CDN_PUBLIC_PROFILE,
  );

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

test("replaces native HTML links with the product profiles", () => {
  const marker = "window.__SUB_PAGE_DATA__=";
  const html = `<html><head></head><body><script>${marker}${JSON.stringify({
    links: [SOURCE_LINK],
    subUrl: "https://old.example/sub/test",
  })};</script></body></html>`;

  const productLinks = [
    renderVpnInboundProfile(SOURCE_LINK, "🇳🇱 МОЖНО • Нидерланды", null),
    renderVpnInboundProfile(SOURCE_LINK, "🇷🇺 МОЖНО • Белые списки — Нидерланды", YANDEX_CDN_PUBLIC_PROFILE),
  ];
  const rewritten = rewriteNativeHtml(
    Buffer.from(html, "utf8"),
    "test-sub-id",
    productLinks,
  ).toString("utf8");
  const start = rewritten.indexOf(marker) + marker.length;
  const end = rewritten.indexOf(";</script>", start);
  const pageData = JSON.parse(rewritten.slice(start, end)) as { links: string[] };

  assert.deepEqual(pageData.links, productLinks);
});

test("keeps router HTML limited to the router product links", () => {
  const marker = "window.__SUB_PAGE_DATA__=";
  const html = `<html><head></head><body><script>${marker}${JSON.stringify({
    links: [ROUTER_SOURCE_LINK],
    subUrl: "https://old.example/sub/test",
  })};</script></body></html>`;

  const routerLinks = [renderVpnInboundProfile(
    ROUTER_SOURCE_LINK,
    "🇳🇱 МОЖНО • Роутер — Нидерланды",
    null,
  )];
  const rewritten = rewriteNativeHtml(
    Buffer.from(html, "utf8"),
    "test-sub-id",
    routerLinks,
  ).toString("utf8");
  const start = rewritten.indexOf(marker) + marker.length;
  const end = rewritten.indexOf(";</script>", start);
  const pageData = JSON.parse(rewritten.slice(start, end)) as { links: string[] };

  assert.deepEqual(pageData.links, routerLinks);
  assert.equal(new URL(pageData.links[0]).port, "10443");
  assert.equal(new URL(pageData.links[0]).hostname, "xraynl.vpn.mozhno.org");
});
