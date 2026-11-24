import { REWIND_ACTION, type RewindAction } from "@repo/features/agent-rewind-model";
import { fileMarkers, unescapedMarkers } from "@repo/features/file-marker";
import { BUTTON_SIZE, CopyButton, HeldMessageAction, MessageActions } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import { type ReactNode, useContext } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { useSideBundles } from "../bundle-loader.js";
import { copyRichThroughShell, copyThroughShell, LINK_COPY } from "../copy-feedback.js";
import { useCopyLink } from "../copy-link-item.js";
import type { CopiedFile, DescriptionEditorModule } from "../description-editor/contract.js";
import { copiedFileOf } from "../description-editor/copied-files.js";
import { type WordFiles, WordFilesContext } from "./file-chips.js";
import { ForkMessageAction } from "./fork-action.js";
import { useMessagePlace } from "./message-links.js";
import { EditMessageAction, RevertMessageAction } from "./rewind-action.js";

/**
 * copy-message.tsx -- the actions under a transcript's message: a copy of its words to the clipboard, where its transcript names its messages Copy link, on an agent's own message where its tab offers it, Fork to new agent (`fork-action.tsx`), and, where its tab offers a rewind, a line's Edit or a reply's Rewind conversation to here (`rewind-action.tsx`).
 *
 * A thin wrapper over AI Elements' message actions, shared by every
 * transcript's messages, whose Copy is `@repo/ui`'s, answered as every copy
 * button in the window is: the glyph turns to a check for a moment and back.
 * A message whose words name its files copies them too, as a copy out of a
 * message box does (`useMessageCopy`).
 */

/** What its Copy copies, which `CopyButton` names ("Copy message"). */
const COPY_WHAT = "message";

/** The files the words name whose bytes are here, by name, as a copy of the message carries them. */
function carriedFiles(
  words: string,
  files: WordFiles | undefined,
): ReadonlyMap<string, CopiedFile> {
  return new Map(
    fileMarkers(words).flatMap((marker): [string, CopiedFile][] => {
      const file = copiedFileOf(files?.file(marker.name)?.url ?? null);

      return file === undefined ? [] : [[marker.name, file]];
    }),
  );
}

/**
 * The message's Copy: its words as plain text, and where they name a file
 * whose bytes are here, beside them the HTML a copy out of a message box
 * writes, each such file's chip carrying it (`messageClipboard`), so a paste
 * into a box brings the chips back and another app pastes a picture as one.
 * Note that the editor's bundle is read as it stands where it has landed,
 * which the panel starts as it first paints, so the clipboard is written in
 * the press's own task, as Safari asks.
 */
function useMessageCopy(): (words: string) => Promise<void> {
  const files = useContext(WordFilesContext);
  const client = useQueryClient();
  const { descriptionEditor } = useSideBundles();

  return (words) => {
    const carried = carriedFiles(words, files);

    if (carried.size === 0) return copyThroughShell(unescapedMarkers(words));

    const write = (editor: DescriptionEditorModule) =>
      copyRichThroughShell(editor.messageClipboard(words, carried));

    const landed = client.getQueryData(descriptionEditor.queryKey);

    return landed === undefined
      ? client.ensureQueryData(descriptionEditor).then(write)
      : write(landed);
  };
}

export function CopyMessageAction({
  words,
  copyable = true,
  messageId,
  forkable = false,
  lead,
  rewind,
}: {
  words: string;
  /** Whether it has any words, which its Copy needs. */
  copyable?: boolean;
  /** The message's id, by which its transcript names it for its Copy link; none where it has no link. */
  messageId?: string | undefined;
  /** Whether the message is the agent's own, which its tab may offer to fork. */
  forkable?: boolean;
  /** An action of the message's own set before Copy. */
  lead?: ReactNode;
  /** How its tab may offer to rewind to it: Edit on a line of the developer's, Rewind conversation to here on the agent's own; none where it offers neither. */
  rewind?: RewindAction | undefined;
}): ReactNode {
  const place = useMessagePlace(messageId ?? "");
  const copyLink = useCopyLink();
  const copy = useMessageCopy();

  return (
    <MessageActions>
      {lead}
      {copyable ? (
        <HeldMessageAction>
          <CopyButton text={words} what={COPY_WHAT} copy={copy} size={BUTTON_SIZE.COMPACT} />
        </HeldMessageAction>
      ) : null}
      {messageId === undefined || place === undefined || copyLink === undefined ? null : (
        <MessageAction
          label={LINK_COPY.LABEL}
          tooltip={LINK_COPY.LABEL}
          onClick={() => copyLink(place)}
        >
          <LinkIcon />
        </MessageAction>
      )}
      {!forkable || messageId === undefined ? null : (
        <ForkMessageAction messageId={messageId} words={words} />
      )}
      {rewind === undefined || messageId === undefined ? null : rewind === REWIND_ACTION.REVERT ? (
        <RevertMessageAction messageId={messageId} />
      ) : (
        <EditMessageAction messageId={messageId} />
      )}
    </MessageActions>
  );
}
