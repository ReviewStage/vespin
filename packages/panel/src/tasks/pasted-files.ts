import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { ACT_KIND } from "@repo/host/acts";
import { askAct } from "../act.js";
import type { LinkedPicture } from "../description-editor/contract.js";
import type { PendingFile } from "../use-attached-files.js";

/**
 * pasted-files.ts -- the files a paste brings a message box: a copied chip's file as it came, and a description's picture read as the file it is.
 *
 * A description's picture pasted into a message box is read as the
 * description's pictures are read (`TASKS_PICTURE_READ`), as the account
 * signed in, and attached as the file it is. Its chip stands from the paste
 * under the name the box gives it, a picture the box's next picture and a
 * PDF its own name, which the description writes as its alt; one that
 * cannot be read goes back out, and the box says why, as a file that could
 * not be read does. Note that the chip is named before the picture is read,
 * by its alt, so a read whose type the alt misnamed, a picture whose alt
 * ends `.pdf` or a PDF whose alt was renamed, goes back out too rather than
 * be kept under the other kind; and a read that has not landed by
 * `READ_DEADLINE_MS` goes back out, since the box sends nothing while one
 * is still being read.
 */

/** A description's PDF's alt, which is its file's name. */
const PDF_ALT = /\.pdf$/iu;

/** How long a description's picture may take to read before it goes back out. */
const READ_DEADLINE_MS = 30_000;

/** A description's picture read as a file under the name given, a PDF where `pdf` says; nothing where it could not be read in time, or read as the other kind. */
async function pictureFile(address: string, name: string, pdf: boolean): Promise<File | undefined> {
  const named = descriptionAttachmentOf(address);

  if (named === undefined) return undefined;

  const read = askAct(ACT_KIND.TASKS_PICTURE_READ, {
    planId: named.taskId,
    attachmentId: named.attachmentId,
  }).catch(() => undefined);

  let deadline: ReturnType<typeof setTimeout> | undefined;

  const late = new Promise<undefined>((resolve) => {
    deadline = setTimeout(resolve, READ_DEADLINE_MS, undefined);
  });

  const answer = await Promise.race([read, late]).finally(() => clearTimeout(deadline));

  if (answer === undefined || "failure" in answer) return undefined;

  if ((answer.contentType === AGENT_ATTACHMENT_TYPE.PDF) !== pdf) return undefined;
  const bytes = Uint8Array.from(atob(answer.base64), (character) => character.charCodeAt(0));

  return new File([bytes], name, { type: answer.contentType });
}

/** Files a copied chip carried in, as they came. */
export function copiedFiles(files: readonly File[]): PendingFile[] {
  return files.map((file) => ({ name: file.name, type: file.type, file: Promise.resolve(file) }));
}

/** A description's pictures pasted in, each read as the file it is: a PDF under its own name, any other with none, so the box numbers it among its pictures. */
export function linkedFiles(pictures: readonly LinkedPicture[]): PendingFile[] {
  return pictures.map((picture) => {
    const pdf = PDF_ALT.test(picture.alt.trim());
    const name = pdf ? picture.alt.trim() : "";
    const type = pdf ? AGENT_ATTACHMENT_TYPE.PDF : AGENT_ATTACHMENT_TYPE.PNG;

    return { name, type, file: pictureFile(picture.address, name, pdf) };
  });
}
