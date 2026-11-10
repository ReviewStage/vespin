/**
 * port-forward-acts.ts -- what the panel's Forward to localhost control says to the desktop and hears back: forwarding turned on or off for one coding agent, and how each of its forwarded ports stands, as the host keeps it in app state.
 *
 * The desktop's host forwards one agent's ports at a time: while forwarding
 * is on, every port the service detects listening in the agent's cloud
 * sandbox (`listening-ports-wire.ts`) is listened on at this Mac's
 * `127.0.0.1`, on the same port where it is free and the next free one
 * where it is not, and each connection it accepts is carried over the
 * service's tunnel (`sandbox-tunnel-wire.ts`). The acts carry ids, port
 * numbers, and what serves each port; no byte a connection carries ever
 * enters an act, app state, or a trace, nor does a port's label enter a
 * trace.
 *
 * While an agent is forwarded, one of its ports may also be shared by a
 * public link (`listening-ports-wire.ts`), which the host reads back from
 * the service and keeps beside the forwarded ports.
 *
 * Every host, a browser tab's among them, also asks the service for an
 * agent's ports and its shared link on the window's behalf, forwarding
 * nothing: each answer is the hosted `agentPorts` procedure's own, or why
 * there is none (`answerView`).
 */

import { Schema as EffectSchema } from "effect";
import { agentPortsContract } from "./contract/agent-ports.js";
import { answerView } from "./hosted-failure.js";
import { portShareRequestSchema } from "./listening-ports-wire.js";

/** How one forwarded port stands on this Mac. */
export const PORT_FORWARD_STATE = {
  /** Listened on at its local port, with no tunnel open: the next connection opens one. */
  LISTENING: "listening",
  /** Listened on, its tunnel open and carrying connections. */
  CONNECTED: "connected",
  /** No local port near it was free, so it is not forwarded. */
  UNAVAILABLE: "unavailable",
} as const;

/** Forwarding turned on or off for an agent; on for one turns it off for any other. */
export const portForwardSetParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  on: EffectSchema.Boolean,
});

/** One of the forwarded agent's ports shared by a public link, or the shared one closed with none. */
export const portShareSetParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  port: EffectSchema.NullOr(EffectSchema.Int),
});

/** One port forwarded: the sandbox's, the local one it is listened on where it has one, how it stands, and what serves it where that was read. */
const forwardedPortSchema = EffectSchema.Struct({
  port: EffectSchema.Int,
  localPort: EffectSchema.optional(EffectSchema.Int),
  state: EffectSchema.Literals(Object.values(PORT_FORWARD_STATE)),
  label: EffectSchema.optional(EffectSchema.String),
});

/**
 * An agent's forwarding as it stands: whether it is on, whether its sandbox
 * was running at the last look, its forwarded ports, the lowest first, and
 * the port shared by public link where one is; off, not running, and none
 * for any agent but the one forwarded.
 */
export const portForwardingAnswerSchema = EffectSchema.Struct({
  on: EffectSchema.Boolean,
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(forwardedPortSchema),
  shared: EffectSchema.optional(
    EffectSchema.Struct({ port: EffectSchema.Int, url: EffectSchema.String }),
  ),
});

export type PortForwardingAnswer = typeof portForwardingAnswerSchema.Type;

/** The one agent forwarded and how its forwarding stands, as the host keeps it in app state; none while no agent is forwarded. */
export const portForwardingSchema = EffectSchema.NullOr(
  EffectSchema.Struct({
    agentId: EffectSchema.NonEmptyString,
    ...portForwardingAnswerSchema.fields,
  }),
);

export type PortForwarding = typeof portForwardingSchema.Type;

/** The agent whose ports the service is asked for. */
export const agentPortsParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

/** One of the agent's ports to share by a public link, replacing any shared before. */
export const agentPortShareParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...portShareRequestSchema.fields,
});

/** The agent's listening ports, as the window hears the service answer them, or why it did not. */
export const agentPortsAnswerViewSchema = answerView(agentPortsContract.list);

export type AgentPortsAnswerView = typeof agentPortsAnswerViewSchema.Type;

/** The agent's port shared now and its link, or why it was not read. */
export const agentSharedPortAnswerViewSchema = answerView(agentPortsContract.shared);

export type AgentSharedPortAnswerView = typeof agentSharedPortAnswerViewSchema.Type;

/** A port shared, its link, or why it was not. */
export const agentPortShareAnswerViewSchema = answerView(agentPortsContract.share);

export type AgentPortShareAnswerView = typeof agentPortShareAnswerViewSchema.Type;

/** The shared port's link closed, or why it was not. */
export const agentPortUnshareAnswerViewSchema = answerView(agentPortsContract.unshare);

export type AgentPortUnshareAnswerView = typeof agentPortUnshareAnswerViewSchema.Type;
