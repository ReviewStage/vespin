/**
 * view-choice-live.ts -- the account's view choices as each of its devices follows them over the service's held poll: the read declared, and a choice as a reader reads it.
 *
 * The service answers one statement, every view choice the account keeps
 * (`view-choice-wire.ts`), each by its key and the workspace it is kept for,
 * none for one of a workspace the account has since left. Only the account
 * reads its own, never a teammate.
 */

import { Option, Schema } from "effect";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { VIEW_CHOICE, type ViewChoiceKey, type ViewChoiceValue } from "./view-choice-wire.js";

/**
 * The account's view choices: one part, every choice it keeps. Note that
 * the key and the value are read as text and as any JSON, because a key a
 * later build declares, or a value it writes, is passed over by the reader
 * that does not know it rather than failing the rows beside it.
 */
export const VIEW_CHOICES_READ = liveRead({
  name: LIVE_READ.VIEW_CHOICES,
  path: HOSTED_SERVICE_PATH.LIVE_VIEW_CHOICES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    choices: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        key: Schema.String,
        workspaceId: Schema.NullOr(Schema.String),
        value: Schema.Unknown,
      }),
      key: "id",
      order: [
        ["key", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
});

export type ViewChoicesLiveAnswer = LiveReadAnswer<typeof VIEW_CHOICES_READ>;

/** One view choice as the statement delivers it. */
export type ViewChoiceLiveRow = LiveRowOf<typeof VIEW_CHOICES_READ.parts.choices>;

/**
 * The value the account keeps for `key`, in `workspaceId` for a
 * workspace's choice and in none for the account's own; none where it
 * keeps none, or keeps one this build cannot read, which then stands at
 * the surface's default.
 */
export function viewChoiceOf<Key extends ViewChoiceKey>(
  rows: readonly ViewChoiceLiveRow[],
  key: Key,
  workspaceId: string | null,
): Option.Option<ViewChoiceValue<Key>> {
  const row = rows.find((each) => each.key === key && each.workspaceId === workspaceId);

  if (row === undefined) return Option.none();
  const schema: Schema.Codec<ViewChoiceValue<Key>, unknown> = VIEW_CHOICE[key].schema;

  return Schema.decodeUnknownOption(schema)(row.value);
}
