// message-files.ts -- the files a row of an agent's transcript carries, as every client lists them: each by its name, type and bytes, or by the picture it was kept as where the row carries no bytes.

import { isRecord, isWireString } from "@repo/wire";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { chipBase64, type FileChip } from "./attachment-model.js";
import { keptPictureIdOf } from "./conversation-picture-wire.js";

/** How the AI SDK spells a file part's type. */
const FILE_PART = "file";

/** A file of a transcript's row as its chip draws it, beside the picture it was kept as where the row names that rather than carrying its bytes. */
export interface MessageFileChip extends FileChip {
  readonly pictureId?: string;
}

/** The files a row of the transcript carries, as chips: its AI SDK file parts, in order, each the row keeps no bytes of naming the picture it was kept as, where it was. */
export function messageFileChips(message: AgentTranscriptMessage): MessageFileChip[] {
  return message.parts.flatMap((part): MessageFileChip[] => {
    if (!isRecord(part) || part.type !== FILE_PART || !isWireString(part.mediaType)) return [];

    const chip = {
      name: isWireString(part.filename) ? part.filename : part.mediaType,
      mediaType: part.mediaType,
      url: isWireString(part.url) ? part.url : "",
    };

    const pictureId = chipBase64(chip) === "" ? keptPictureIdOf(part.providerMetadata) : undefined;

    return [pictureId === undefined ? chip : { ...chip, pictureId }];
  });
}
