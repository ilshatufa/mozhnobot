export interface VpnPublicProfileOverride {
  host: string;
  port: number;
  query?: Record<string, unknown>;
  removeQuery?: string[];
}

export const YANDEX_CDN_PUBLIC_PROFILE = {
  host: "yc.cdn.mozhno.org",
  port: 443,
  query: {
    type: "xhttp",
    security: "tls",
    sni: "yc.cdn.mozhno.org",
    host: "yc.cdn.mozhno.org",
    path: "/api/upload",
    mode: "packet-up",
    alpn: "h2",
    fp: "chrome",
    extra: {
      xmux: {
        cMaxReuseTimes: "36-96",
        maxConnections: "32-64",
        hKeepAlivePeriod: 0,
        hMaxRequestTimes: "320-640",
        hMaxReusableSecs: "720-1800",
      },
      seqKey: "offset",
      headers: {
        Accept: "application/vnd.api+json, application/json, text/plain, */*",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      xPaddingKey: "q",
      seqPlacement: "query",
      uplinkDataKey: "X-Playback-Token",
      xPaddingBytes: "48-320",
      xPaddingHeader: "X-Rewrite-URL",
      xPaddingMethod: "tokenish",
      uplinkHTTPMethod: "GET",
      xPaddingObfsMode: true,
      xPaddingPlacement: "queryInHeader",
      scMaxBufferedPosts: 2048,
      scMaxEachPostBytes: "4000-5000",
      uplinkDataPlacement: "header",
      scMinPostsIntervalMs: "4-18",
      serverMaxHeaderBytes: 32768,
    },
  },
  removeQuery: ["flow", "pbk", "sid", "spx"],
} satisfies VpnPublicProfileOverride;

export function parseVpnPublicProfile(value: unknown): VpnPublicProfileOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.host !== "string" ||
    !candidate.host ||
    typeof candidate.port !== "number" ||
    !Number.isInteger(candidate.port) ||
    candidate.port <= 0
  ) {
    return null;
  }
  const query = candidate.query;
  const removeQuery = candidate.removeQuery;
  if (query !== undefined && (!query || typeof query !== "object" || Array.isArray(query))) {
    return null;
  }
  if (removeQuery !== undefined && (
    !Array.isArray(removeQuery) ||
    removeQuery.some((item) => typeof item !== "string")
  )) {
    return null;
  }
  return {
    host: candidate.host,
    port: candidate.port,
    ...(query === undefined ? {} : { query: query as Record<string, unknown> }),
    ...(removeQuery === undefined ? {} : { removeQuery: removeQuery as string[] }),
  };
}

export function renderVpnInboundProfile(
  sourceLink: string,
  name: string,
  publicProfile: unknown,
): string {
  const parsed = new URL(sourceLink);
  const override = parseVpnPublicProfile(publicProfile);
  if (override) {
    parsed.hostname = override.host;
    parsed.port = String(override.port);
    for (const [key, value] of Object.entries(override.query ?? {})) {
      parsed.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    for (const key of override.removeQuery ?? []) parsed.searchParams.delete(key);
  }
  parsed.hash = encodeURIComponent(name);
  return parsed.toString();
}
