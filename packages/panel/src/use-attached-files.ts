import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
  base64Bytes,
} from "@repo/features/agent-wire";
import {
  nextPictureName,
  unusedName,
  writableName,
  writtenMarkers,
} from "@repo/features/file-marker";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { useRef, useState } from "react";
import { reportShownFailure } from "./failure-report.js";
import { encodeImage, imageFiles } from "./feedback-images.js";
import { base64Of } from "./tasks/attached-files.js";
import { type FileDrop, useFileDrop } from "./use-file-drop.js";

/**
 * use-attached-files.ts -- the files a message box holds before it sends: the ones picked by its +, pasted, or dropped on it, read and taken after the ones it holds, and why any did not come.
 *
 * Every box that takes files takes them here, so a pick, a paste, and a
 * drop come the same way in each: read on this machine, held to the box's
 * count and to the bytes a message carries together, and taken after
 * whatever the box holds as the read lands, so neither a read that landed first nor a chip taken off
 * meanwhile is undone. A paste takes the pictures on the clipboard, and
 * words long enough to bury the message (`LONG_PASTE`) as a text file of
 * their own, "Pasted text 1.txt", so the box keeps the words written
 * around them; shorter words paste as they always did, and so do long
 * ones the box has no room for as a file, which the box's bound then cuts. The first file of a hand-off that
 * cannot come says why in the box's one note, and a hand-off that all came
 * takes a standing file note down. A box keeps its files where it keeps its
 * draft, or here where it keeps none.
 *
 * Only a file the developer handed the box is read, and only its bytes and
 * its own name: never a path, never a file beside it. An image is kept as
 * it is while it is PNG, JPEG, or WebP and small enough, and re-encoded
 * smaller as WebP otherwise, as a feedback screenshot is
 * (`./feedback-images.ts`); a PDF is kept as it is; anything else comes
 * as a text file where its bytes spell UTF-8 with no NUL in them, whatever
 * its extension, since code arrives under every extension there is. Each
 * is held to its type's bound, a message to ten files and to 3 MB
 * together, and the first file that cannot come says why in the box's
 * note while the ones that can still come.
 *
 * A box that takes files into its words (`inWords`) attaches each image
 * under a picture's name, "Picture 1" and on, and every other file under its
 * own name made one a marker can spell and no other file of the box holds
 * (`@repo/features/file-marker`), and has each one's marker put in as a chip
 * where the caret stood as the files were handed, once they are read, as a
 * long paste taken as a file is put in where it was pasted. A file whose
 * marker was in the words goes with it: deleting its chip takes the file
 * off, and undo bringing the chip back brings the file back (`follow`),
 * until the message goes (`settle`). A file the words could not take, the
 * box's editor not loaded or its bound reached, stays attached beside the
 * words, as every file stood before markers.
 */

/** Why a file did not come, in the words the box's note says. */
const REFUSAL = {
  KIND: (name: string) => `${name} can't be attached. Attach images, PDFs, or text files.`,
  TOO_LARGE: (name: string) => `${name} is too large to attach.`,
  EMPTY: (name: string) => `${name} is empty.`,
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
  FULL: (most: number) => `A message can carry up to ${most} files.`,
  TOO_MUCH: "These files are too large to send together.",
} as const;

/** How long pasted words run before they come as a file rather than into the box: either bound reached. */
const LONG_PASTE = {
  CHARS: 4_000,
  LINES: 40,
} as const;

/** The name a pasted file takes, numbered past every pasted file the box holds. */
const PASTED_NAME = /^Pasted text (\d+)\.txt$/u;

/** Whether pasted words run long enough to come as a file. */
function longPaste(words: string): boolean {
  if (words.length >= LONG_PASTE.CHARS) return true;
  let lines = 1;
  for (let at = words.indexOf("\n"); at !== -1; at = words.indexOf("\n", at + 1)) {
    lines += 1;
    if (lines >= LONG_PASTE.LINES) return true;
  }
  return false;
}

/** The next pasted file's name: one past the highest the box has used, so a chip taken off frees no number a later paste reuses beside its neighbor. */
function pastedName(used: readonly string[]): string {
  const highest = used.reduce((most, name) => {
    const number = PASTED_NAME.exec(name)?.[1];
    return number === undefined ? most : Math.max(most, Number(number));
  }, 0);
  return `Pasted text ${String(highest + 1)}.txt`;
}

/** Whether bytes spell text a model can read: UTF-8, with no NUL, which no text file holds. */
function spellsText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** One file read: what the message carries of it, or why it cannot come. */
type FileRead = { readonly attachment: AgentAttachment } | { readonly refusal: string };

/** One file read into what a message carries, or why it cannot come. */
async function attachmentOf(file: File): Promise<FileRead> {
  // Note that the name needs no bound of its own here, because macOS bounds a file's name inside the wire's.
  const { name } = file;
  if (file.type.startsWith("image/")) {
    const image = await encodeImage(file, AGENT_BOUNDS.MAX_IMAGE_BYTES);
    // Note that a re-encoded image keeps the name it was picked under, which is the one its chip says.
    if (image === undefined) return { refusal: REFUSAL.UNREADABLE(name) };
    return { attachment: { name, mediaType: image.mediaType, data: image.base64 } };
  }
  const pdf = file.type === AGENT_ATTACHMENT_TYPE.PDF || name.toLowerCase().endsWith(".pdf");
  const bound = pdf ? AGENT_BOUNDS.MAX_PDF_BYTES : AGENT_BOUNDS.MAX_TEXT_BYTES;
  if (file.size > bound) return { refusal: REFUSAL.TOO_LARGE(name) };
  const bytes = await file.arrayBuffer().then(
    (buffer) => new Uint8Array(buffer),
    (cause: unknown) => {
      // Note that a file this machine could not read is reported as it is said, since nothing named why.
      reportShownFailure({ surface: FAILURE_SURFACE.ATTACHMENT_READ, cause }, Date.now());
      return undefined;
    },
  );
  if (bytes === undefined) return { refusal: REFUSAL.UNREADABLE(name) };
  if (bytes.length === 0) return { refusal: REFUSAL.EMPTY(name) };
  if (!pdf && !spellsText(bytes)) return { refusal: REFUSAL.KIND(name) };
  const mediaType = pdf ? AGENT_ATTACHMENT_TYPE.PDF : AGENT_ATTACHMENT_TYPE.TEXT;
  return { attachment: { name, mediaType, data: base64Of(bytes) } };
}

/** Files read: what the message may carry of them, in order, and why the first that cannot come did not. */
interface FilesRead {
  readonly attachments: readonly AgentAttachment[];
  readonly refusal: string | undefined;
}

/**
 * The files handed to the box, each read as above, in order, and no more
 * than a message holds; the first refusal is the one said. Nothing here
 * reads the box, so a read that lands late is taken after whatever the
 * box holds by then (`withFiles`).
 */
async function readFiles(files: readonly File[]): Promise<FilesRead> {
  const attachments: AgentAttachment[] = [];
  let refusal: string | undefined;
  for (const file of files) {
    if (attachments.length >= AGENT_BOUNDS.MAX_ATTACHMENTS) {
      refusal ??= REFUSAL.FULL(AGENT_BOUNDS.MAX_ATTACHMENTS);
      break;
    }
    const read = await attachmentOf(file);
    if ("refusal" in read) refusal ??= read.refusal;
    else attachments.push(read.attachment);
  }
  return { attachments, refusal };
}

/**
 * Files read, taken after those the box holds, in order, while the message
 * stays within its count, a message's to an agent unless the box carries
 * fewer, and its bytes together; the read's own refusal is said first, then
 * the first file the bounds left out.
 */
function withFiles(
  held: readonly AgentAttachment[],
  read: FilesRead,
  most: number = AGENT_BOUNDS.MAX_ATTACHMENTS,
): FilesRead {
  const attachments = [...held];
  let refusal = read.refusal;
  for (const attachment of read.attachments) {
    if (attachments.length >= most) {
      refusal ??= REFUSAL.FULL(most);
      break;
    }
    const total = attachments.reduce(
      (sum, each) => sum + base64Bytes(each.data),
      base64Bytes(attachment.data),
    );
    if (total > AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) {
      refusal ??= REFUSAL.TOO_MUCH;
      continue;
    }
    attachments.push(attachment);
  }
  return { attachments, refusal };
}

/** Where a box keeps its files: the files as it draws them, and a change handed what it holds as the change lands. */
interface AttachedFilesHolder {
  readonly attachments: readonly AgentAttachment[];
  readonly update: (next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[]) => void;
}

/** Where a box puts its files' markers: a place marked as files are handed, which once they are read puts in the files named and answers whether it did; nothing where the words take none now. */
export interface AttachedInWords {
  readonly place: () => ((names: readonly string[]) => boolean) | undefined;
}

/** What a box takes and where its files and its note go. */
export interface AttachedFilesOptions {
  /** Says the box's note: why the last files handed did not all come, or nothing once they did. */
  readonly onRefusal: (words: string | undefined) => void;
  /** Where the box keeps its files, its draft for one; the hook's own state where none is given. */
  readonly holder?: AttachedFilesHolder | undefined;
  /** The most files the box carries; a message to an agent's where none is given. */
  readonly most?: number | undefined;
  /** Whether the box takes no files now, as the agent box while a send holds it. */
  readonly held?: boolean | undefined;
  /** Where the box puts the files it takes into its words; none where it takes them beside the words alone. */
  readonly inWords?: AttachedInWords | undefined;
  /** The box's words as it opens, whose markers name the files its chips hold already, as a draft kept or a message opened for editing does. */
  readonly words?: string | undefined;
  /** The names of files the owner holds beside the box's, a comment's edit's kept of the comment's, which a file the box takes is named past. */
  readonly named?: readonly string[] | undefined;
}

/** The files a box holds and the ways it takes more and lets them go. */
export interface AttachedFiles {
  readonly attachments: readonly AgentAttachment[];
  /** Whether files handed to the box are still being read, which a send waits on. */
  readonly reading: boolean;
  /** Takes files picked or handed to the box, in order. */
  readonly attach: (files: readonly File[]) => void;
  /** Takes the pictures among pasted files, answering whether there were any, so text pastes as it always does. */
  readonly paste: (files: readonly File[]) => boolean;
  /** Takes pasted words as a text file where they run long and the box has room for them as one, answering whether it did. */
  readonly pasteText: (words: string) => boolean;
  readonly remove: (index: number) => void;
  /** The files the box holds this moment, for a callback that outlives the render it was made in. */
  readonly now: () => readonly AgentAttachment[];
  /** Sets the files the box holds outright, as a send empties it and a send that failed puts them back. */
  readonly set: (attachments: readonly AgentAttachment[]) => void;
  /** The drop target the box's card spreads, and whether files are over it. */
  readonly drop: FileDrop;
  /** The box's words as they now stand, which take off a file whose marker they no longer hold and bring back one whose marker came back. */
  readonly follow: (words: string) => void;
  /** The box's message sent: once the box stands empty after it, the files taken off with their chips, which undo can no longer bring back, are let go, and the next picture is "Picture 1" again; a send that leaves the words standing lets go of nothing. */
  readonly settle: () => void;
}

/** The files a box holds, read as they are handed to it on the terms `options` sets. */
export function useAttachedFiles(options: AttachedFilesOptions): AttachedFiles {
  const [own, setOwn] = useState<readonly AgentAttachment[]>([]);
  // The files held as of the last change, which a read landing late is taken after.
  const ownNow = useRef(own);
  const ownHolder: AttachedFilesHolder = {
    attachments: own,
    update: (next) => {
      ownNow.current = next(ownNow.current);
      setOwn(ownNow.current);
    },
  };
  // Note that a read lands on the options as they stand when it lands, since the box may have drawn again meanwhile.
  const latest = useRef(options);
  latest.current = options;
  const holderNow = () => latest.current.holder ?? ownHolder;
  const heldNow = () => latest.current.holder?.attachments ?? ownNow.current;
  const [reading, setReading] = useState(0);
  // The files whose markers the words have held, the files taken off with their markers, by name, and every name handed out, all until the box empties.
  // Note that the words the box opens on name files too, since its editor hands back no words it opened on.
  const [opened] = useState(
    () => new Set(writtenMarkers(options.words ?? "").map((marker) => marker.name)),
  );
  const placed = useRef(opened);
  const stashed = useRef(new Map<string, AgentAttachment>());
  const minted = useRef(new Set<string>());
  // Whether the box's message went, so the next time its words and files stand empty its files are let go.
  const settling = useRef(false);

  /** Every name held, taken off, or handed out, and the owner's, which no file the box takes is named again. */
  const usedNames = () =>
    new Set([
      ...heldNow().map((file) => file.name),
      ...stashed.current.keys(),
      ...minted.current,
      ...(latest.current.named ?? []),
    ]);
  /** The files read named as their markers name them: an image as the next picture, any other file by its own name written so a marker can carry it, each past every name used, so no two files of the box share one. */
  const named = (read: FilesRead): FilesRead => {
    const used = usedNames();
    const attachments = read.attachments.map((file) => {
      const picture = file.mediaType.startsWith("image/");
      const name = picture ? nextPictureName(used) : unusedName(writableName(file.name), used);
      used.add(name);
      minted.current.add(name);
      return { ...file, name };
    });
    return { ...read, attachments };
  };
  const take = (read: FilesRead, place: ((names: readonly string[]) => boolean) | undefined) => {
    const { most = AGENT_BOUNDS.MAX_ATTACHMENTS, onRefusal } = latest.current;
    const kept = place === undefined ? read : named(read);
    const taken = withFiles(heldNow(), kept, most);
    holderNow().update((now) => withFiles(now, kept, most).attachments);
    onRefusal(taken.refusal);
    // Note that the markers go in once the files are held, so the words never name a file the box does not hold.
    const names = kept.attachments
      .filter((file) => taken.attachments.includes(file))
      .map((file) => file.name);
    // Note that the place is answered even with no file to put in, so its mark is let go.
    if (place?.(names) === true) {
      for (const name of names) placed.current.add(name);
    }
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || latest.current.held === true) return;
    // Note that the place is marked as the files are handed, so their markers land where the caret stood then.
    const place = latest.current.inWords?.place();
    setReading((count) => count + 1);
    void readFiles(files)
      .then((read) => take(read, place))
      .finally(() => setReading((count) => count - 1));
  };
  const drop = useFileDrop((files) => attach(Array.from(files)), { over: options.held !== true });
  return {
    attachments: (options.holder ?? ownHolder).attachments,
    reading: reading > 0,
    attach,
    paste: (files) => {
      const pasted = imageFiles(files);
      if (pasted.length === 0) return false;
      attach(pasted);
      return true;
    },
    pasteText: (words) => {
      const { most = AGENT_BOUNDS.MAX_ATTACHMENTS, held } = latest.current;
      if (held === true || !longPaste(words)) return false;
      const bytes = new TextEncoder().encode(words);
      if (bytes.length > AGENT_BOUNDS.MAX_TEXT_BYTES) return false;
      // Note that the words are read here and now rather than through `attach`, so a box with no room for them keeps them as words.
      const file: AgentAttachment = {
        name: pastedName([...usedNames()]),
        mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
        data: base64Of(bytes),
      };
      const read = { attachments: [file], refusal: undefined };
      if (withFiles(heldNow(), read, most).refusal !== undefined) return false;
      latest.current.onRefusal(undefined);
      minted.current.add(file.name);
      holderNow().update((now) => withFiles(now, read, most).attachments);
      // Note that the pasted file goes in where the words would have, as a file handed to the box does.
      if (latest.current.inWords?.place()?.([file.name]) === true) placed.current.add(file.name);
      return true;
    },
    remove: (index) => {
      latest.current.onRefusal(undefined);
      holderNow().update((was) => was.filter((_, at) => at !== index));
    },
    now: heldNow,
    set: (next) => {
      latest.current.onRefusal(undefined);
      holderNow().update(() => next);
    },
    drop,
    settle: () => {
      settling.current = true;
    },
    follow: (words) => {
      if (latest.current.inWords === undefined) return;
      const held = heldNow();
      // Note that a message is let go only once the box stands empty after it, because a send that
      // leaves its words standing, a queued edit refused, still holds its files and what undo brings back.
      if (settling.current && words === "" && held.length === 0) {
        settling.current = false;
        placed.current.clear();
        stashed.current.clear();
        minted.current.clear();
        return;
      }
      if (words !== "") settling.current = false;
      // Note that a marker in code still holds its file, which the box then draws beside its words.
      const marked = new Set(writtenMarkers(words).map((marker) => marker.name));
      const gone = held.filter((file) => placed.current.has(file.name) && !marked.has(file.name));
      const back = [...stashed.current.values()].filter(
        (file) => marked.has(file.name) && !held.some((each) => each.name === file.name),
      );
      for (const file of gone) stashed.current.set(file.name, file);
      for (const file of back) stashed.current.delete(file.name);
      for (const name of marked) placed.current.add(name);
      if (gone.length === 0 && back.length === 0) return;
      holderNow().update((now) => [
        ...now.filter((file) => !gone.includes(file)),
        ...back.filter((file) => !now.some((each) => each.name === file.name)),
      ]);
    },
  };
}
