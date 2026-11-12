/**
 * link-address.ts -- which addresses the service reads a page from on a member's behalf: a web page over HTTPS on its own port, with no credential in the address.
 *
 * Only `https` is read, since an address may carry a token of the member's
 * that a plaintext fetch would show to whoever watches the service's path
 * out, and only on its own port, so a hovered link cannot aim the service
 * at another service on a public host. Where the address's host stands,
 * on the internet or inside a network, is the connection's to refuse
 * (`node-link-reach.ts`), at the moment the socket is made.
 */

/** The scheme a page is read over, on its own port alone. */
const WEB_PORT = {
  "https:": "443",
} as const;

/** The address as a page the service may read: an `https` address on its own port with no credential; none for anything else. */
export function webPageAddressOf(href: string): URL | undefined {
  if (!URL.canParse(href)) return undefined;
  const url = new URL(href);
  const port = WEB_PORT[url.protocol as keyof typeof WEB_PORT];

  if (port === undefined) return undefined;

  if (url.username !== "" || url.password !== "") return undefined;

  if (url.port !== "" && url.port !== port) return undefined;

  return url;
}
