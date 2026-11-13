import {
  portForwardingAnswerSchema,
  portForwardSetParamsSchema,
  portShareSetParamsSchema,
} from "@repo/features/port-forward-acts";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * port-forwards.ts -- the Ports popover as the panel reaches the host for it: one of an agent's ports forwarded to this Mac or let go, and one shared by link, declared.
 *
 * The host's port forwards concern answers it (`compose-port-forwards.ts`),
 * since it listens on the Mac's loopback; a host without that concern, a
 * browser tab's, refuses it. Only a panel draws the control. It carries an
 * agent's id and port numbers alone, never a byte a forwarded connection
 * carries.
 */

/** The Ports popover's acts, answered by the port forwards composer. */
export const PORT_FORWARD_ACTS = declaredActs({
  PORT_FORWARD_SET: hostAct({
    input: portForwardSetParamsSchema,
    output: portForwardingAnswerSchema,
    refusal: "Could not forward this port.",
    panelOnly: true,
    // Note that forwarding a port asks the service to start it, and its state is this Mac's listeners, never a row.
    door: ACT.REMOTE_WORK,
  }),
  PORT_SHARE_SET: hostAct({
    input: portShareSetParamsSchema,
    output: portForwardingAnswerSchema,
    refusal: "Could not share this port.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
});

export const portForwardActsContract = contractOf(PORT_FORWARD_ACTS);
