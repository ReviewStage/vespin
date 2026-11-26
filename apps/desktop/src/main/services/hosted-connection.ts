/**
 * hosted-connection.ts -- main's connection to the service, which every call the host makes goes out on (`hostedFetchOverUndici`), and which a wake or a network come back replaces.
 *
 * One for main's life, since the held reads that keep it warm are the
 * host's for as long as main runs; it opens nothing until the first call.
 */

import { hostedFetchOverUndici } from "@repo/features/node";

export const hostedConnection = hostedFetchOverUndici();
