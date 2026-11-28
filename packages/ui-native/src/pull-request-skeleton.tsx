// pull-request-skeleton.tsx -- a pull request page's parts while they are read: its heading and its conversation, each drawn through the component its loaded state draws with, under the system's redaction.

import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { ConversationEntryRow } from "./conversation-rows.js";
import { FACE_KIND } from "./marks.js";
import { PullRequestHead } from "./pull-request-page.js";
import { PULL_REQUEST_SKELETON } from "./pull-request-skeleton-words.js";

/** No link a placeholder opens. */
const OPENS_NOTHING = (): void => undefined;

/**
 * A pull request's heading while nothing names it yet: the heading itself,
 * its title, its chip, its branches, and its sentence as the system's
 * placeholders, by its number, heard as `heard`.
 */
export function PullRequestHeadSkeleton({
  number,
  heard,
}: {
  readonly number: number;
  readonly heard: string;
}) {
  return (
    <PullRequestHead
      title={PULL_REQUEST_SKELETON.TITLE}
      number={number}
      state={PULL_REQUEST_STATE.OPEN}
      queued={false}
      stateLabel={PULL_REQUEST_SKELETON.STATE}
      reading
      placeholder={heard}
    />
  );
}

/** The conversation's entries while they are read, each an entry's own row as placeholders, heard as `heard`. */
export function ConversationSkeleton({ heard }: { readonly heard: string }) {
  return PULL_REQUEST_SKELETON.ENTRIES.map((entry) => (
    <ConversationEntryRow
      key={entry.by}
      id={`skeleton-${entry.by}`}
      by={{ name: entry.by, picture: undefined, kind: FACE_KIND.PERSON }}
      at={0}
      now={0}
      words={entry.words}
      open={false}
      onOpenLink={OPENS_NOTHING}
      placeholder={heard}
    />
  ));
}
