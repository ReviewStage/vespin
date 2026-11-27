/**
 * transcript-read-failed.tsx -- what a conversation says where its messages could not be read: the whole read, at the log's end or centered in its place, and an older page, floating over the log's top, each with Retry.
 */

import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { FLOATING_OVER_LOG_CLASS } from "@repo/ui/conversation";
import { failureShown, unreadShown } from "../failure-report.js";

/** What the tab says where its transcript could not be read. */
const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";
const OLDER_FAILED_LINE = "Earlier messages could not be read.";

/** The transcript's read failed, reported under why it answered, with Retry: at the log's end under the messages held, or centered where none are. */
export function TranscriptReadFailed({
  failedWith,
  agentId,
  onRetry,
  centered = false,
}: {
  /** Why the transcript could not be read, as its read answered; unread where unsaid. */
  failedWith: unknown;
  /** The agent whose transcript it is, which the report names; none before the agent stands. */
  agentId: string | undefined;
  onRetry: () => void;
  /** Whether it stands alone, centered in the log's place, as where no message is held. */
  centered?: boolean;
}): React.JSX.Element {
  const failure = failureShown({
    surface: FAILURE_SURFACE.AGENT_TRANSCRIPT_READ,
    cause: failedWith ?? FAILURE_CONDITION.UNREAD,
    about: { agentId },
  });

  return centered ? (
    <ErrorState failure={failure} onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTERED}>
      {TRANSCRIPT_FAILED_LINE}
    </ErrorState>
  ) : (
    <ErrorState failure={failure} onRetry={onRetry}>
      {TRANSCRIPT_FAILED_LINE}
    </ErrorState>
  );
}

/**
 * The last read of older messages did not answer, said with Retry. Note
 * that it floats in a fixed slot over the log's top rather than standing in
 * its flow, so its coming and going moves no row, measured or not.
 */
export function OlderReadFailed({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className={`${FLOATING_OVER_LOG_CLASS} top-ui-8 z-1 max-w-conversation-older bg-well px-list-inset py-tight-gap`}
    >
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.AGENT_TRANSCRIPT_OLDER_READ)}
        onRetry={onRetry}
      >
        {OLDER_FAILED_LINE}
      </ErrorState>
    </div>
  );
}
