/**
 * fcm-fake.ts -- the FCM sender as a test stands it: it records each message it was handed and answers what the test scripted.
 */

import { Effect, Layer } from "effect";
import { FCM_DELIVERY, type FcmDelivery, type FcmNotification, FcmSender } from "../push/fcm.js";

export interface RecordingFcmSender {
  readonly layer: Layer.Layer<FcmSender>;
  /** Every message handed to the sender, in order. */
  readonly sent: FcmNotification[];
}

/** A sender that records each message and answers every one as `delivery` says, for a test of what decides to push. */
export function recordingFcmSender(
  delivery: FcmDelivery = FCM_DELIVERY.DELIVERED,
): RecordingFcmSender {
  const sent: FcmNotification[] = [];

  const layer = Layer.succeed(FcmSender, {
    send: (notification) => {
      sent.push(notification);

      return Effect.succeed(delivery);
    },
  });

  return { layer, sent };
}
