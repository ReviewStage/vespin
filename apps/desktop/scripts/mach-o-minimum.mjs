// mach-o-minimum.mjs -- the packaged app's Mach-O files that ask for a newer macOS than it declares.

import fs from "node:fs";
import path from "node:path";

// The magic numbers a Mach-O file opens with, read as written: a thin
// file's in its own (little-endian) order, a universal file's big-endian.
const MAGIC = {
  THIN_32: 0xfeedface,
  THIN_64: 0xfeedfacf,
  FAT_32: 0xcafebabe,
  FAT_64: 0xcafebabf,
};

// A thin header's bytes before its load commands, and a universal header's
// bytes for each slice it lists.
const THIN_HEADER_BYTES = { [MAGIC.THIN_32]: 28, [MAGIC.THIN_64]: 32 };
const FAT_ARCH_BYTES = { [MAGIC.FAT_32]: 20, [MAGIC.FAT_64]: 32 };

// Note that a Java class file opens with the universal magic too, its
// version where the slice count would be, so a count past this is no Mach-O.
const MAX_FAT_SLICES = 16;

const LOAD_COMMAND = { VERSION_MIN_MACOSX: 0x24, BUILD_VERSION: 0x32 };
const PLATFORM_MACOS = 1;

/** Bytes of a file from `offset`, as many as it holds up to `length`. */
function readAt(descriptor, offset, length) {
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(descriptor, buffer, 0, length, offset);

  return buffer.subarray(0, read);
}

/** A version packed as Mach-O packs one, `xxxx.yy.zz` in nibbles, as [major, minor, patch]. */
function unpackVersion(packed) {
  return [packed >>> 16, (packed >>> 8) & 0xff, packed & 0xff];
}

/** The macOS minimum a thin slice at `offset` declares, or undefined where it names none. */
function sliceMinimum(descriptor, offset) {
  const head = readAt(descriptor, offset, 32);

  if (head.length < 28) return undefined;
  const headerBytes = THIN_HEADER_BYTES[head.readUInt32LE(0)];

  if (headerBytes === undefined) return undefined;
  const commandCount = head.readUInt32LE(16);
  const commands = readAt(descriptor, offset + headerBytes, head.readUInt32LE(20));
  let at = 0;

  for (let index = 0; index < commandCount && at + 16 <= commands.length; index += 1) {
    const command = commands.readUInt32LE(at);
    const size = commands.readUInt32LE(at + 4);

    if (
      command === LOAD_COMMAND.BUILD_VERSION &&
      commands.readUInt32LE(at + 8) === PLATFORM_MACOS
    ) {
      return unpackVersion(commands.readUInt32LE(at + 12));
    }

    if (command === LOAD_COMMAND.VERSION_MIN_MACOSX) {
      return unpackVersion(commands.readUInt32LE(at + 8));
    }

    if (size === 0) break;
    at += size;
  }

  return undefined;
}

/** The byte offset of each slice a file holds: its own start where it is thin, none where it is no Mach-O. */
function sliceOffsets(descriptor, fileSize) {
  const magic = readAt(descriptor, 0, 8);

  if (magic.length < 8) return [];

  if (THIN_HEADER_BYTES[magic.readUInt32LE(0)] !== undefined) return [0];

  const archBytes = FAT_ARCH_BYTES[magic.readUInt32BE(0)];
  const slices = magic.readUInt32BE(4);

  if (archBytes === undefined || slices === 0 || slices > MAX_FAT_SLICES) return [];
  const table = readAt(descriptor, 8, slices * archBytes);

  if (table.length < slices * archBytes) return [];

  return Array.from({ length: slices }, (_, index) =>
    archBytes === FAT_ARCH_BYTES[MAGIC.FAT_64]
      ? Number(table.readBigUInt64BE(index * archBytes + 8))
      : table.readUInt32BE(index * archBytes + 8),
  ).filter((offset) => offset < fileSize);
}

/** Whether version `a` stands after version `b`, each [major, minor, patch]. */
function isAfter(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }

  return false;
}

/** Every regular file under `directory`, symbolic links left out, since a framework's point at files listed already. */
function* regularFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) yield* regularFiles(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

/**
 * Each Mach-O slice under `bundlePath` whose declared macOS minimum (its
 * LC_BUILD_VERSION `minos`, or an older file's LC_VERSION_MIN_MACOSX) stands
 * after `minimum`, such as "14.0", as `{ path, minimum }` with the path
 * relative to the bundle. Such a file would refuse to load on a Mac the
 * bundle's LSMinimumSystemVersion lets the app install on, so a toolchain
 * whose SDK quietly raised it is caught at packaging rather than on that Mac.
 */
export function machOAboveMinimum(bundlePath, minimum) {
  const floor = minimum.split(".").map(Number);
  const found = [];

  for (const filePath of regularFiles(bundlePath)) {
    const descriptor = fs.openSync(filePath, "r");

    try {
      for (const offset of sliceOffsets(descriptor, fs.fstatSync(descriptor).size)) {
        const declared = sliceMinimum(descriptor, offset);

        if (declared !== undefined && isAfter(declared, floor)) {
          found.push({ path: path.relative(bundlePath, filePath), minimum: declared.join(".") });
        }
      }
    } finally {
      fs.closeSync(descriptor);
    }
  }

  return found;
}
