/**
 * view-choice-wire.ts -- the account's view choices: each declared once (its key, whether it is the account's or one workspace's, and the Schema its value reads through), and a write as `/api/account/view-choices` carries it.
 *
 * A view choice is how a member reads their own lists (a sort, a filter, a
 * fold), kept on their account so it follows them to every device, as Slack
 * keeps a sidebar's sort and Linear its display options. What is tied to a
 * window rather than to the person (a width, which tab is open) stays on the
 * device (`@repo/panel`'s `use-kept.ts`).
 *
 * Each choice is declared once in `VIEW_CHOICE`, which the service checks
 * every write against and every client reads through, so the service holds
 * no value a build could not have chosen. A choice of a workspace's is kept
 * for each workspace apart, by its id, and one of the account's once.
 *
 * Note that a value's shape never changes under its key: a choice whose
 * shape must change is declared again under a new key, because a released
 * client keeps reading the key it knows for weeks (AGENTS.md's "Breaking
 * the hosted wire"), and a value it cannot read only stands at its default.
 */

import { type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Schema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";
import { MANAGER_SORT } from "./workspace-managers-model.js";

/** Whether a choice is the account's once, or one workspace's, kept for each apart. */
export const VIEW_CHOICE_SCOPE = {
  ACCOUNT: "account",
  WORKSPACE: "workspace",
} as const;

export type ViewChoiceScope = (typeof VIEW_CHOICE_SCOPE)[keyof typeof VIEW_CHOICE_SCOPE];

/** Each view choice's key, as the service stores it and the wire carries it. */
export const VIEW_CHOICE_KEY = {
  /** How a workspace's Managers are sorted in the sidebar (`MANAGER_SORT`). */
  MANAGER_SORT: "managerSort",
} as const;

export type ViewChoiceKey = (typeof VIEW_CHOICE_KEY)[keyof typeof VIEW_CHOICE_KEY];

/** The Schema a view choice's value reads through, needing no service to read or write. */
type ViewChoiceSchema = Schema.Codec<unknown, unknown>;

/** A view choice as declared: its key, its scope, and the Schema its value reads through, whose encoded side is JSON. */
export interface ViewChoice<S extends ViewChoiceSchema> {
  readonly key: ViewChoiceKey;
  readonly scope: ViewChoiceScope;
  readonly schema: S;
}

/** Declares one view choice. */
function viewChoice<S extends ViewChoiceSchema>(
  key: ViewChoiceKey,
  scope: ViewChoiceScope,
  schema: S,
): ViewChoice<S> {
  return { key, scope, schema };
}

/** Every view choice, by its key. */
export const VIEW_CHOICE = {
  [VIEW_CHOICE_KEY.MANAGER_SORT]: viewChoice(
    VIEW_CHOICE_KEY.MANAGER_SORT,
    VIEW_CHOICE_SCOPE.WORKSPACE,
    Schema.Literals(Object.values(MANAGER_SORT)),
  ),
} as const satisfies { readonly [Key in ViewChoiceKey]: ViewChoice<ViewChoiceSchema> };

/** The value a view choice holds, as a client reads it. */
export type ViewChoiceValue<Key extends ViewChoiceKey> =
  (typeof VIEW_CHOICE)[Key]["schema"]["Type"];

/** How long a value may stand, as its JSON, so no one key holds more than a view needs. */
export const VIEW_CHOICE_BOUNDS = {
  MAX_VALUE_CHARS: 16_384,
} as const;

/**
 * A view choice written: its key, the workspace it is kept for (null for
 * the account's own), and its value as JSON, which the service reads
 * through the key's own Schema; null forgets the choice, which then stands
 * at its default on every device.
 */
export const viewChoiceWriteSchema = Schema.Struct({
  key: Schema.Literals(Object.values(VIEW_CHOICE_KEY)),
  workspaceId: Schema.NullOr(workspaceIdSchema),
  value: WireValueSchema,
});

export type ViewChoiceWrite = typeof viewChoiceWriteSchema.Type;

/** A write as the service answers it: the transaction it committed in, where it changed a row, which the account's live read of its view choices carries. */
export const viewChoiceWrittenSchema = Schema.Struct({
  txid: Schema.optionalKey(Schema.String),
});

export type ViewChoiceWritten = typeof viewChoiceWrittenSchema.Type;

/**
 * Whether `workspaceId` names a place `key` is kept: a workspace for a
 * workspace's choice, and none for the account's own.
 */
export function viewChoicePlaced(key: ViewChoiceKey, workspaceId: string | null): boolean {
  return (VIEW_CHOICE[key].scope === VIEW_CHOICE_SCOPE.WORKSPACE) === (workspaceId !== null);
}

/**
 * The value `key` holds as JSON, read through its Schema and written back
 * out through it, so what is stored is what a client of this build would
 * write; none where the value is not one the key holds, or its JSON runs
 * past the bound.
 */
export function viewChoiceStored(key: ViewChoiceKey, value: WireValue): WireValue | undefined {
  const schema: ViewChoiceSchema = VIEW_CHOICE[key].schema;

  const stored = Schema.decodeUnknownOption(schema)(value).pipe(
    Option.flatMap(Schema.encodeUnknownOption(schema)),
    Option.flatMap(Schema.decodeUnknownOption(WireValueSchema)),
    Option.filter((json) => JSON.stringify(json).length <= VIEW_CHOICE_BOUNDS.MAX_VALUE_CHARS),
  );

  return Option.getOrUndefined(stored);
}
