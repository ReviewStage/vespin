/**
 * link-address.ts -- which addresses the service reads a page from on a member's behalf: a web page on the public internet, and nothing inside a network.
 *
 * A preview is a fetch of an address a member hovered, from the service's
 * own network, so what it may reach is held here before any byte is sent.
 * Only `http` and `https` are read, on their own ports, with no credential
 * in the address; a host is named by a public name with a dot in it, never
 * by a LAN or loopback name (`REFUSED_HOST_SUFFIXES`); and every address
 * the host resolves to must be public: none of the private, loopback,
 * link-local, carrier-grade NAT, multicast, reserved, documentation, or
 * unspecified ranges, in IPv4 or IPv6, an IPv4 address mapped or embedded
 * in an IPv6 one checked as the IPv4 it carries. The cloud metadata
 * addresses (`169.254.169.254`, `fd00:ec2::254`) fall inside those ranges.
 * A host that resolves to one private address among public ones is refused
 * whole, since which one a connection takes is the resolver's choice. The
 * check is of the resolved addresses, not the name alone, because a name is
 * the attacker's to point anywhere; the connection is then made to the
 * very addresses checked, never by resolving again (`link-preview-read.ts`,
 * `node-link-reach.ts`), so a name that answers differently a moment later
 * reaches nothing.
 */

import { isIPv4, isIPv6 } from "node:net";

/** The schemes a page is read over, each on its own port alone. */
const WEB_PORT = {
  "http:": "80",
  "https:": "443",
} as const;

/** Host names, and the suffixes of names, that name a machine inside a network or none at all, whatever they resolve to. */
const REFUSED_HOST_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "test",
  "example",
  "invalid",
  "onion",
];

/** An IPv4 range as a prefix: its first address's bytes and how many leading bits name it. */
interface Ipv4Range {
  readonly bytes: readonly [number, number, number, number];
  readonly bits: number;
}

/** The IPv4 ranges no public host stands in. */
const REFUSED_IPV4: readonly Ipv4Range[] = [
  { bytes: [0, 0, 0, 0], bits: 8 }, // this network
  { bytes: [10, 0, 0, 0], bits: 8 }, // private
  { bytes: [100, 64, 0, 0], bits: 10 }, // carrier-grade NAT
  { bytes: [127, 0, 0, 0], bits: 8 }, // loopback
  { bytes: [169, 254, 0, 0], bits: 16 }, // link-local, the cloud metadata address among it
  { bytes: [172, 16, 0, 0], bits: 12 }, // private
  { bytes: [192, 0, 0, 0], bits: 24 }, // IETF protocol assignments
  { bytes: [192, 0, 2, 0], bits: 24 }, // documentation
  { bytes: [192, 88, 99, 0], bits: 24 }, // 6to4 relay anycast
  { bytes: [192, 168, 0, 0], bits: 16 }, // private
  { bytes: [198, 18, 0, 0], bits: 15 }, // benchmarking
  { bytes: [198, 51, 100, 0], bits: 24 }, // documentation
  { bytes: [203, 0, 113, 0], bits: 24 }, // documentation
  { bytes: [224, 0, 0, 0], bits: 4 }, // multicast
  { bytes: [240, 0, 0, 0], bits: 4 }, // reserved, the broadcast address among it
];

/** An IPv6 range as a prefix: its first address's sixteen bytes and how many leading bits name it. */
interface Ipv6Range {
  readonly bytes: readonly number[];
  readonly bits: number;
}

/** The sixteen bytes of an IPv6 address from its leading bytes, the rest zero. */
function ipv6Prefix(...leading: number[]): readonly number[] {
  return [...leading, ...Array.from({ length: 16 - leading.length }, () => 0)];
}

/** The IPv6 ranges no public host stands in; an address carrying an IPv4 one is checked as that IPv4 instead. */
const REFUSED_IPV6: readonly Ipv6Range[] = [
  { bytes: ipv6Prefix(), bits: 127 }, // the unspecified address and loopback, :: and ::1
  { bytes: ipv6Prefix(0x01), bits: 64 }, // discard-only
  { bytes: ipv6Prefix(0x20, 0x01, 0x0d, 0xb8), bits: 32 }, // documentation
  { bytes: ipv6Prefix(0xfc), bits: 7 }, // unique local, the cloud metadata address among it
  { bytes: ipv6Prefix(0xfe, 0x80), bits: 10 }, // link-local
  { bytes: ipv6Prefix(0xfe, 0xc0), bits: 10 }, // site-local, deprecated but still routed inside networks
  { bytes: ipv6Prefix(0xff), bits: 8 }, // multicast
];

/** The prefixes under which an IPv6 address carries an IPv4 one in its last four bytes: mapped, NAT64, and 6to4's first two bytes. */
const IPV4_CARRIED: readonly Ipv6Range[] = [
  { bytes: ipv6Prefix(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff), bits: 96 }, // IPv4-mapped
  { bytes: ipv6Prefix(0x00, 0x64, 0xff, 0x9b), bits: 96 }, // NAT64
];

/** 6to4, whose IPv4 stands in bytes two to five. */
const SIX_TO_FOUR: Ipv6Range = { bytes: ipv6Prefix(0x20, 0x02), bits: 16 };

/** Whether `address` starts with the range's first `bits` bits. */
function inRange(address: readonly number[], range: Ipv6Range | Ipv4Range): boolean {
  const whole = Math.floor(range.bits / 8);
  for (let at = 0; at < whole; at += 1) {
    if (address[at] !== range.bytes[at]) return false;
  }
  const rest = range.bits % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((address[whole] ?? 0) & mask) === ((range.bytes[whole] ?? 0) & mask);
}

/** An IPv4 address's four bytes; none where it is no IPv4 address. */
function ipv4Bytes(address: string): readonly number[] | undefined {
  if (!isIPv4(address)) return undefined;
  return address.split(".").map(Number);
}

/**
 * An IPv6 address's sixteen bytes; none where it is no IPv6 address. A
 * zone (`fe80::1%eth0`) is dropped, `::` expands to the zeros it stands
 * for, and a trailing dotted quad is read as its four bytes.
 */
function ipv6Bytes(address: string): readonly number[] | undefined {
  const unzoned = address.split("%")[0] ?? "";
  if (!isIPv6(unzoned)) return undefined;
  const groups: number[] = [];
  const [head, tail] = unzoned.split("::");
  const parts = (side: string | undefined): number[] =>
    (side ?? "")
      .split(":")
      .filter((part) => part !== "")
      .flatMap((part) => {
        const quad = ipv4Bytes(part);
        if (quad !== undefined) return [(quad[0]! << 8) | quad[1]!, (quad[2]! << 8) | quad[3]!];
        return [Number.parseInt(part, 16)];
      });
  const leading = parts(head);
  const trailing = tail === undefined ? [] : parts(tail);
  const missing = 8 - leading.length - trailing.length;
  groups.push(...leading, ...Array.from({ length: Math.max(missing, 0) }, () => 0), ...trailing);
  return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}

/** Whether an IPv4 address, as its bytes, is one of the public internet's. */
function publicIpv4(bytes: readonly number[]): boolean {
  return REFUSED_IPV4.every((range) => !inRange(bytes, range));
}

/** Whether an address a host resolved to is one of the public internet's. */
function isPublicAddress(address: string): boolean {
  const quad = ipv4Bytes(address);
  if (quad !== undefined) return publicIpv4(quad);
  const bytes = ipv6Bytes(address);
  if (bytes === undefined) return false;
  if (IPV4_CARRIED.some((range) => inRange(bytes, range))) return publicIpv4(bytes.slice(12));
  if (inRange(bytes, SIX_TO_FOUR)) return publicIpv4(bytes.slice(2, 6));
  return REFUSED_IPV6.every((range) => !inRange(bytes, range));
}

/** Whether a host's name, as an address spells it, is one the service never reads: a LAN or loopback name, or a bare label with no dot. */
function refusedHostName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/u, "");
  if (!name.includes(".")) return true;
  const last = name.slice(name.lastIndexOf(".") + 1);
  return REFUSED_HOST_SUFFIXES.includes(last);
}

/**
 * The address as a page the service may read, before its host is resolved:
 * an `http` or `https` address on its own port with no credential, naming
 * a host by a public name, or by a public address literal; none for
 * anything else.
 */
export function webPageAddressOf(href: string): URL | undefined {
  if (!URL.canParse(href)) return undefined;
  const url = new URL(href);
  const port = WEB_PORT[url.protocol as keyof typeof WEB_PORT];
  if (port === undefined) return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.port !== "" && url.port !== port) return undefined;
  const literal = ipLiteralOf(url.hostname);
  if (literal !== undefined) return isPublicAddress(literal) ? url : undefined;
  return refusedHostName(url.hostname) ? undefined : url;
}

/** The IP address a host name is, where it is a literal: an IPv4, or an IPv6 in its brackets; none for a name. */
export function ipLiteralOf(hostname: string): string | undefined {
  if (isIPv4(hostname)) return hostname;
  const bracketed = /^\[(.+)\]$/u.exec(hostname)?.[1];
  if (bracketed !== undefined && isIPv6(bracketed)) return bracketed;
  return undefined;
}

/** Whether every address a host resolved to is public, and there is at least one. */
export function allPublic(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every(isPublicAddress);
}
