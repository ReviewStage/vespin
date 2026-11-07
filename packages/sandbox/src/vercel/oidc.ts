/**
 * oidc.ts -- the deployment's own OIDC token, which every call of Vercel Sandbox is made under.
 */

import { getVercelOidcToken } from "@vercel/oidc";

/** How the deployment's own OIDC token is read: the function's in production, a fixed one in a test. */
export type OidcTokenRead = () => Promise<string>;

/** The function's own token, as Vercel hands it to a running function. */
export const deploymentOidcToken: OidcTokenRead = () => getVercelOidcToken();
