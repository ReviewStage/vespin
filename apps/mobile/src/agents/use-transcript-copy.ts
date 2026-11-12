/**
 * use-transcript-copy.ts -- an agent's transcript copied or shared as the panel's Copy transcript makes it, on the phone: concise or whole, in Markdown (`@repo/features/transcript-copy`).
 *
 * The transcript is read whole from the service as the copy is asked
 * (`AGENTS_MESSAGES`, page after page from its start), never from the pages
 * the screen holds, so a copy says what the panel's would. A copy lands on
 * the clipboard with a buzz; a share opens the system's share sheet on the
 * same words. A transcript that couldn't be read says so over the composer
 * in the panel's words.
 */

import type { AgentBrief } from "@repo/features/agent-wire";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
  transcriptMarkdown,
} from "@repo/features/transcript-copy";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, buzz, shareWords } from "@repo/ui-native";
import { setStringAsync } from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";

/** What the copy says where the transcript couldn't be read or copied, in the panel's words. */
const TRANSCRIPT_UNREAD = "The transcript could not be copied. Try again.";

/** What Copy transcript does for one agent. */
export interface TranscriptCopying {
  /** Reads the transcript whole and puts it on the clipboard, concise or whole. */
  readonly copy: (way: TranscriptCopy) => void;
  /** Reads the transcript whole and opens the system's share sheet on it, concise or whole. */
  readonly share: (way: TranscriptCopy) => void;
  /** Why the last copy did not take; none while none failed. */
  readonly note: string | undefined;
}

/** Copy transcript for the agent `agentId` names, under its name `title` and with the brief it was handed. */
export function useTranscriptCopy(
  agentId: string,
  title: string,
  brief: AgentBrief | undefined,
): TranscriptCopying {
  const acts = useHostActs();
  const [note, setNote] = useState<string | undefined>(undefined);
  const latest = useRef(0);

  // Note that leaving the page, by a push over it or by closing it, outdates every press, so a read that settles after it neither copies, shares, nor says anything.
  useFocusEffect(
    useCallback(
      () => () => {
        latest.current += 1;
      },
      [],
    ),
  );

  /**
   * Reads the transcript whole and hands its words in the way asked to
   * `land`. Only the latest press lands or says why it failed, so a slow
   * earlier read never overwrites a later copy or shows a failure over it.
   */
  const press = (way: TranscriptCopy, land: (words: string) => Promise<void> | void) => {
    latest.current += 1;
    const pressed = latest.current;
    const stands = () => pressed === latest.current;

    const failed = (cause: unknown) => {
      console.error(TRANSCRIPT_UNREAD, cause);

      if (stands()) setNote(TRANSCRIPT_UNREAD);
    };

    setNote(undefined);
    void readWholeTranscript((params) => acts[ACT_KIND.AGENTS_MESSAGES](params), { agentId })
      .then(async (messages) => {
        if (!stands()) return;

        if ("unread" in messages) {
          failed(messages.unread);

          return;
        }

        await land(transcriptMarkdown(agentTranscript({ title, messages, brief }), way));
      })
      .catch(failed);
  };

  return {
    copy: (way) =>
      press(way, async (words) => {
        await setStringAsync(words);
        buzz(BUZZ.SUCCESS);
      }),
    share: (way) => press(way, shareWords),
    note,
  };
}
