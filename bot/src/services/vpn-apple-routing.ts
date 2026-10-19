// Apple service hosts and address ranges, checked 2026-10-19:
// https://support.apple.com/en-us/101555
// Keep third-party CDN and certificate exceptions limited to the listed hosts.
export const APPLE_DIRECT_DOMAINS = [
  "domain:apple.com",
  "domain:icloud.com",
  "domain:icloud.com.cn",
  "domain:icloud-content.com",
  "domain:cdn-apple.com",
  "domain:apple-cloudkit.com",
  "domain:apple-livephotoskit.com",
  "domain:apple-mapkit.com",
  "domain:apple-dns.net",
  "domain:apzones.com",
  "domain:mzstatic.com",
  "domain:itunes.com",
  "domain:networking.apple",
  "domain:safebrowsing.apple",
  "domain:axm-usercontent-apple.com",
  "domain:appleschoolcontent.com",
  "full:appldnld.apple.com.edgesuite.net",
  "full:apple-relay.cloudflare.com",
  "full:apple-relay.fastly-edge.com",
  "full:cp4.cloudflare.com",
  "full:crl3.digicert.com",
  "full:crl4.digicert.com",
  "full:ocsp.digicert.com",
  "full:ocsp.digicert.cn",
];

export const APPLE_DIRECT_IPS = [
  "17.0.0.0/8",
  "2403:300::/32",
  "2620:149::/32",
  "2a01:b740::/32",
];
