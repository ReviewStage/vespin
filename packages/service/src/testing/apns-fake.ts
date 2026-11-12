/**
 * apns-fake.ts -- the APNs transport and the sender as a test stands them: each records what it was handed and answers what the test scripted.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { Effect, Layer } from "effect";
import {
  APNS_DELIVERY,
  type ApnsAnswer,
  type ApnsDelivery,
  type ApnsNotification,
  type ApnsRequest,
  ApnsSender,
  ApnsTransport,
  ApnsTransportFailure,
} from "../push/apns.js";

export interface RecordingApnsTransport {
  readonly layer: Layer.Layer<ApnsTransport>;
  /** Every request the sender sent, in order. */
  readonly sent: ApnsRequest[];
}

/** A transport that records each request and answers it as `answer` says, Apple's answer or a failure to reach it. */
export function recordingApnsTransport(
  answer: (request: ApnsRequest) => ApnsAnswer | ApnsTransportFailure,
): RecordingApnsTransport {
  const sent: ApnsRequest[] = [];

  const layer = Layer.succeed(ApnsTransport, {
    send: (request) => {
      sent.push(request);
      const answered = answer(request);

      return answered instanceof ApnsTransportFailure
        ? Effect.fail(answered)
        : Effect.succeed(answered);
    },
  });

  return { layer, sent };
}

export interface RecordingApnsSender {
  readonly layer: Layer.Layer<ApnsSender>;
  /** Every notification handed to the sender, in order. */
  readonly sent: ApnsNotification[];
}

/**
 * A sender that records each notification and answers it as `delivery` says,
 * one answer for every one or one by the notification, for a test of what
 * decides to push; an answer by the notification may be an effect, for a
 * test of what else happens while a push is in flight.
 */
export function recordingApnsSender(
  delivery:
    | ApnsDelivery
    | ((
        notification: ApnsNotification,
      ) =>
        | ApnsDelivery
        | Effect.Effect<ApnsDelivery, never, DatabaseServices>) = APNS_DELIVERY.DELIVERED,
): RecordingApnsSender {
  const sent: ApnsNotification[] = [];

  const layer = Layer.succeed(ApnsSender, {
    send: (notification) => {
      sent.push(notification);

      if (typeof delivery !== "function") return Effect.succeed(delivery);
      const answered = delivery(notification);

      return Effect.isEffect(answered) ? answered : Effect.succeed(answered);
    },
  });

  return { layer, sent };
}
