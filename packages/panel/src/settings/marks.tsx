import type { FailureAbout, FailureSurface } from "@repo/features/shown-failure";
import { ErrorState, SavedTick, SettingsChangedMark, SettingsLine } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { unreadShown } from "../failure-report.js";

/**
 * The word beside a row's name while its value differs from the default,
 * as VS Code's settings editor says it: what a page's reset would change,
 * said row by row rather than only by the reset appearing. A statement, not
 * a control — the row's own control is where the value moves — and a word
 * rather than a dot, so a reader and a glance read the same thing.
 */
export function ChangedMark(): React.JSX.Element {
  return <SettingsChangedMark />;
}

/**
 * What rides a settings row's name: the Modified word while its value
 * differs from the default, and the Saved tick each time a write of the row's
 * lands (`useSettingWrite`'s `saves`).
 */
export function SettingMarks({
  changed,
  saves,
}: {
  changed: boolean | undefined;
  saves: number;
}): React.JSX.Element {
  return (
    <>
      {changed === true ? <ChangedMark /> : null}
      <SavedTick saves={saves} />
    </>
  );
}

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

/* Whether each group holds a value its reset would change, judged from the
   same resolved settings the rows draw — so the mark, the reset, and the row
   always agree on what is standing. The voice and pace compare against the
   shipped defaults the way their menus label them; a launch-environment
   override reads as changed, which is what the row shows too. */
