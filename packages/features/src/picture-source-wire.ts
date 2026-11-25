import { Schema as EffectSchema } from "effect";
import {
  agentPicturePath,
  descriptionAttachmentPath,
  inboxAttachmentPath,
} from "./service-paths.js";

/**
 * picture-source-wire.ts -- where the iOS app's image loader reads a picture from: the service's address for it and the account's header, or, in a fixture run, the picture's own `data:` address.
 *
 * The iOS app draws a picture through its platform's image loader, which
 * downloads, caches, and decodes it natively, as React Native apps draw a
 * picture behind a sign-in. The host answers the address and the header the
 * loader sends; the screens hand them to the loader's source alone, and they
 * reach no log, trace, counted event, or fixture. The address names the
 * picture by its ids alone, so the loader keeps it under that address
 * whatever header read it.
 */

/** Whose picture a source is asked for: one an agent showed, an Inbox item's attachment, or a description's or a comment's. */
export const PICTURE_OWNER = {
  AGENT: "agent",
  INBOX: "inbox",
  TASK: "task",
} as const;

export type PictureOwner = (typeof PICTURE_OWNER)[keyof typeof PICTURE_OWNER];

/** Why a picture has no source: the platform's screens take no header, as a window apart from the host's process, or no account is signed in. */
export const PICTURE_SOURCE_FAILURE = {
  UNOFFERED: "unoffered",
  SIGNED_OUT: "signed-out",
} as const;

/** One picture, by whose it is and its ids, and whether the account is renewed first, as a read the service refused asks. */
export const pictureSourceParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({
    owner: EffectSchema.Literal(PICTURE_OWNER.AGENT),
    agentId: EffectSchema.NonEmptyString,
    pictureId: EffectSchema.NonEmptyString,
    renew: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
  EffectSchema.Struct({
    owner: EffectSchema.Literal(PICTURE_OWNER.INBOX),
    itemId: EffectSchema.NonEmptyString,
    attachmentId: EffectSchema.NonEmptyString,
    renew: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
  EffectSchema.Struct({
    owner: EffectSchema.Literal(PICTURE_OWNER.TASK),
    taskId: EffectSchema.NonEmptyString,
    attachmentId: EffectSchema.NonEmptyString,
    renew: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
]);

export type PictureSourceParams = typeof pictureSourceParamsSchema.Type;

/** Where the loader reads a picture: its address and the headers it sends, or why there is none. */
export const pictureSourceViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    uri: EffectSchema.String,
    headers: EffectSchema.optionalKey(
      EffectSchema.Record(EffectSchema.String, EffectSchema.String),
    ),
  }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(PICTURE_SOURCE_FAILURE)) }),
]);

export type PictureSourceView = typeof pictureSourceViewSchema.Type;

/** The service's path a picture is served under as its bytes. */
export function picturePathOf(picture: PictureSourceParams): string {
  switch (picture.owner) {
    case PICTURE_OWNER.AGENT:
      return agentPicturePath(picture.agentId, picture.pictureId);
    case PICTURE_OWNER.INBOX:
      return inboxAttachmentPath(picture.itemId, picture.attachmentId);
    case PICTURE_OWNER.TASK:
      return descriptionAttachmentPath(picture.taskId, picture.attachmentId);
  }
}
