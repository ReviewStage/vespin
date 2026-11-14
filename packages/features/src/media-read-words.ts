// media-read-words.ts -- what a picture, a recording or a file whose bytes did not land says, in the panel's words, so the panel and the iPhone say it alike.

/**
 * What stands where a file's bytes did not land. A failed one says so in
 * the few words its box holds (`*_FAILED`), its whole sentence spoken as
 * its name and its words (`COULD_NOT_READ`); one this reader cannot reach,
 * or whose bytes are gone, says its words are `NOT_AVAILABLE`; and a
 * message some of whose files failed says so once under them.
 */
export const MEDIA_READ_WORDS = {
  PICTURE_FAILED: "Couldn't load image",
  VIDEO_FAILED: "Couldn't load video",
  FILE_FAILED: "Couldn't load file",
  COULD_NOT_READ: "could not be read.",
  NOT_AVAILABLE: "not available",
  FILES_FAILED: "Some files could not be read.",
} as const;
