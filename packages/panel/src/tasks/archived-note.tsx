import { ArchiveIcon, BANNER_LOOK, Banner, BUTTON_VARIANT, Button, Text } from "@repo/ui";
import { useState } from "react";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";

/**
 * archived-note.tsx -- what stands in a composer's place while the agent it writes to is archived.
 *
 * An archived agent reads but takes no message until it is brought back, so
 * its composer says why rather than standing there as a dead control, with
 * the one press that brings it back.
 */

/** What the composer's note says, worded once. */
const ARCHIVED_NOTE_COPY = {
  COMPOSER: "This agent is archived",
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/** The two presses the note waits on, of which one is out at a time. */
const ARCHIVED_PRESS = { STOP: "stop", UNARCHIVE: "unarchive" } as const;

type ArchivedPress = (typeof ARCHIVED_PRESS)[keyof typeof ARCHIVED_PRESS];

/**
 * What stands in an agent's composer's place while the agent is archived:
 * that it is, and Unarchive, and nothing of who archived it or why, which
 * its card says. An agent still running finishes the turn it is on, so its
 * Stop stands beside them. A press that waits on the service
 * shows busy until it settles, a Stop it took until the agent offers none,
 * and the other waits meanwhile.
 */
export function ArchivedComposerNote({
  onUnarchive,
  stop,
}: {
  onUnarchive: () => void | Promise<void>;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered, with whether it took the stop. */
  stop?: (() => Promise<boolean>) | undefined;
}): React.JSX.Element {
  const [out, setOut] = useState<ArchivedPress | undefined>(undefined);

  // Note that a Stop the service took reads Stopping until the agent offers none, because the task
  // list carries the stop a moment after the answer.
  if (out === ARCHIVED_PRESS.STOP && stop === undefined) setOut(undefined);

  const press = (which: ArchivedPress, run: () => void | Promise<void> | Promise<boolean>) => {
    if (out !== undefined) return;
    const settles = run();

    // Note that a press that answers at once, as one that asks first does, has nothing to wait on.
    if (!(settles instanceof Promise)) return;
    setOut(which);
    settles.then(
      (took) => {
        if (which !== ARCHIVED_PRESS.STOP || took !== true) setOut(undefined);
      },
      () => setOut(undefined),
    );
  };

  return (
    <div className={COMPOSER_ROOM_CLASS}>
      <Banner
        look={BANNER_LOOK.ROW}
        glyph={<ArchiveIcon />}
        actions={
          <>
            {stop === undefined ? null : (
              <Button
                disabled={out === ARCHIVED_PRESS.UNARCHIVE}
                busy={out === ARCHIVED_PRESS.STOP}
                busyLabel={ARCHIVED_NOTE_COPY.STOPPING}
                onClick={() => press(ARCHIVED_PRESS.STOP, stop)}
              >
                {ARCHIVED_NOTE_COPY.STOP}
              </Button>
            )}
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              disabled={out === ARCHIVED_PRESS.STOP}
              busy={out === ARCHIVED_PRESS.UNARCHIVE}
              busyLabel={ARCHIVED_NOTE_COPY.UNARCHIVING}
              onClick={() => press(ARCHIVED_PRESS.UNARCHIVE, onUnarchive)}
            >
              {ARCHIVED_NOTE_COPY.UNARCHIVE}
            </Button>
          </>
        }
      >
        <Text>{ARCHIVED_NOTE_COPY.COMPOSER}</Text>
      </Banner>
    </div>
  );
}
