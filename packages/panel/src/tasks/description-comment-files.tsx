import { type AgentAttachment, isAgentAttachmentType } from "@repo/features/agent-wire";
import { chipBase64, type FileChip } from "@repo/features/attachment-model";
import type { DescriptionCommentFile } from "@repo/features/description-comment-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { useRef } from "react";
import { sendAct } from "../act.js";
import { pictureQuery } from "../picture-query.js";
import { AttachedFileChips } from "./attached-file-chips.js";

/**
 * description-comment-files.tsx -- the files a description's comment carries, drawn over its words.
 *
 * A comment's files are kept by the service beside the comment and named
 * on its entry by id; the window reads each one's bytes through the description's
 * own attachment read, the one its pictures take and keep it under
 * (`../picture-query.ts`), under the account, and
 * draws them as the agent box draws a sent message's files: a row of chips,
 * a picture by its thumbnail and any other file by its type's icon, each
 * opening over the window. A chip whose bytes have not landed, or whose read
 * failed, is drawn by its name alone.
 *
 * A comment's field takes files by its + (`attach-files-button.tsx`), a
 * paste of pictures, or a drop, as every message box does
 * (`../use-attached-files.ts`), held to the bounds a message to an agent is.
 * Its edit holds the files it keeps in its box with the files it adds, as
 * ordinary entries of the box's (`useCommentFileEntries`). A file its words
 * name (`[Picture 1]`, `[File: spec.pdf]`) is drawn in the words, where its
 * marker stands, rather than in the row (`useWordFiles`), written and
 * posted alike.
 */

/** How a plan's comment's file is read: as the plan's attachment, which its pictures read too. */
function readDescriptionFile(planId: string, attachmentId: string) {
  return sendAct(ACT_KIND.TASKS_PICTURE_READ, { planId, attachmentId });
}

/** A comment's files as read, in order: each one's `data:` URL once it landed, and an empty one until then or where it did not. */
function useCommentFileReads(planId: string, files: readonly DescriptionCommentFile[]): string[] {
  const reads = useQueries({
    queries: files.map((file) => pictureQuery(planId, file.attachmentId, readDescriptionFile)),
    combine: (results) => results.map((result) => result.data),
  });

  return files.map((_, index) => {
    const read = reads[index];

    return read?.kind === PICTURE_STATE.READY ? read.url : "";
  });
}

/** A comment's files as chips, each read once and kept as the plan's pictures are (`../picture-query.ts`). */
export function useCommentFileChips(
  planId: string,
  files: readonly DescriptionCommentFile[],
): FileChip[] {
  const urls = useCommentFileReads(planId, files);

  return files.map((file, index) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: urls[index] ?? "",
  }));
}

/** A comment's files over its words, as chips; none where it carries none or its words draw every one. */
export function CommentFiles({ chips }: { chips: readonly FileChip[] }): React.ReactNode {
  if (chips.length === 0) return null;

  return (
    <div className="comment-files mx-0 mt-tight-gap mb-item-gap">
      <AttachedFileChips files={chips} />
    </div>
  );
}

type UseCommentFileEntriesResult = {
  readonly entries: readonly AgentAttachment[];
  readonly idOf: (entry: AgentAttachment) => string | undefined;
};

/**
 * A comment's files as its edit's box holds them, each read as the
 * comment's are: a file of the box's, its bytes empty until they land, and
 * the comment's file each one is, by its id. Note that an entry stays the
 * same object for as long as its file and bytes do, because the box knows
 * each file it holds by the object, and a new one each draw would take it
 * for another file; and that a file of a type this window does not know,
 * one added after it, is no entry, since no box holds it, and stays on the
 * comment as it stands.
 */
export function useCommentFileEntries(
  planId: string,
  files: readonly DescriptionCommentFile[],
): UseCommentFileEntriesResult {
  const urls = useCommentFileReads(planId, files);
  const known = useRef(new Map<string, AgentAttachment>());

  const entries = files.flatMap((file, index) => {
    const { mediaType } = file;

    if (!isAgentAttachmentType(mediaType)) return [];
    const data = chipBase64({ name: file.name, mediaType, url: urls[index] ?? "" });
    const was = known.current.get(file.attachmentId);

    if (was?.name === file.name && was.mediaType === mediaType && was.data === data) return [was];
    const entry: AgentAttachment = { name: file.name, mediaType, data };
    known.current.set(file.attachmentId, entry);

    return [entry];
  });

  const idOf = (entry: AgentAttachment) =>
    [...known.current].find(([, each]) => each === entry)?.[0];

  return { entries, idOf };
}
