import type { FailureAbout, FailureSurface } from "@repo/features/shown-failure";
import { ErrorState, SettingsLine } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { unreadShown } from "../failure-report.js";

/** A card's line where the read of its rows did not land: the read failure, then Retry, in the rows' place. */
export function ReadFailed({
  line,
  surface,
  about,
  onRetry,
}: {
  line: string;
  /** Where the read failed, which its report names. */
  surface: FailureSurface;
  /** The ids the read was about, which its report names too. */
  about?: FailureAbout;
  onRetry?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <SettingsLine>
      <ErrorState failure={unreadShown(surface, about)} onRetry={onRetry}>
        {line}
      </ErrorState>
    </SettingsLine>
  );
}

/**
 * A row's error line kept masked in a screen recording, though the page
 * around it shows its own words, because a refusal the host or the service
 * words can quote what a person set or named.
 */
export function replayMaskedError(error: ShownError | undefined): ShownError | undefined {
  // Note that words saying nothing stay as they are, so the row still draws no line for them.
  const { words } = error ?? {};

  if (
    error === undefined ||
    words === undefined ||
    words === null ||
    words === false ||
    words === ""
  ) {
    return error;
  }

  return { ...error, words: <ReplayMask>{words}</ReplayMask> };
}
