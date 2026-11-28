import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  type CopiedTranscript,
  type TranscriptCopy,
  type TranscriptUnread,
  transcriptMarkdown,
} from "@repo/features/transcript-copy";
import { STATUS_TONE } from "@repo/ui";
import { useCopyToast } from "../copy-feedback.js";
import { useToast } from "../toast.js";

/**
 * transcript-copier.ts -- a transcript's copy as the strips' tabs, the side panel, and an agent's menu offer it: read on demand, then put on the clipboard as concise or full markdown, answered with the window's toast.
 *
 * Note that the copy stands apart from the strips' tabs (`strip-tabs.tsx`)
 * and the agent menu (`agent-actions.tsx`), because the strips' tabs draw
 * the agent menu, and each reads the copy.
 */

/** What the toast says once a tab's transcript, concise or full, is on the clipboard. */
const TRANSCRIPT_COPIED_NOTE = "Transcript copied";

/** What the toast says when a tab's transcript could not be read whole for a copy. */
const TRANSCRIPT_UNREAD_NOTE = "The transcript could not be copied. Try again.";

/** A transcript read on demand for a copy, or why it could not be read; nothing where no read says why. */
export type TranscriptRead = () => Promise<CopiedTranscript | TranscriptUnread | undefined>;

/** A copy of a transcript as the strips' tabs and the sidebar's pins offer it: read, then put on the clipboard as concise or full markdown. */
export type TranscriptCopier = (read: TranscriptRead) => (copy: TranscriptCopy) => void;

/** The copy of a transcript read on demand, answered with the window's toast: copied, or not read. */
export function useTranscriptCopier(): TranscriptCopier {
  const copyWithToast = useCopyToast();
  const toast = useToast();

  const unread = (cause: unknown) =>
    toast({
      words: TRANSCRIPT_UNREAD_NOTE,
      tone: STATUS_TONE.DANGER,
      failure: { surface: FAILURE_SURFACE.TRANSCRIPT_COPY, cause },
      replayUnmasked: true,
    });

  return (read) => (copy) => {
    read().then((transcript) => {
      if (transcript === undefined) return unread(FAILURE_CONDITION.UNREAD);

      if ("unread" in transcript) return unread(transcript.unread);

      return copyWithToast(transcriptMarkdown(transcript, copy), TRANSCRIPT_COPIED_NOTE);
    }, unread);
  };
}
