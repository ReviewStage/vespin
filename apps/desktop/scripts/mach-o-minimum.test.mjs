import fs from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@repo/wire/testing";
import { expect, test } from "vitest";
import { machOAboveMinimum } from "./mach-o-minimum.mjs";

// Versions as Mach-O packs them, worked by hand: major << 16 | minor << 8 | patch.
const MACOS = { V10_13: 0x000a0d00, V14_0: 0x000e0000, V15_0: 0x000f0000, V26_0: 0x001a0000 };

/** A thin 64-bit Mach-O whose one load command declares `version`, in the newer or the older command. */
function thinMachO(version, { older = false } = {}) {
  const command = older ? Buffer.alloc(16) : Buffer.alloc(24);

  if (older) {
    command.writeUInt32LE(0x24, 0); // LC_VERSION_MIN_MACOSX
    command.writeUInt32LE(16, 4);
    command.writeUInt32LE(version, 8);
  } else {
    command.writeUInt32LE(0x32, 0); // LC_BUILD_VERSION
    command.writeUInt32LE(24, 4);
    command.writeUInt32LE(1, 8); // macOS
    command.writeUInt32LE(version, 12);
  }

  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(command.length, 20);

  return Buffer.concat([header, command]);
}

/** A universal file holding `slices`, each at its own 4096-byte boundary. */
function universalMachO(slices) {
  const header = Buffer.alloc(4096);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);

  const body = slices.map((slice, index) => {
    header.writeUInt32BE(4096 * (index + 1), 8 + index * 20 + 8);
    header.writeUInt32BE(slice.length, 8 + index * 20 + 12);

    return Buffer.concat([slice, Buffer.alloc(4096 - slice.length)]);
  });

  return Buffer.concat([header, ...body]);
}

test("names each Mach-O, thin or universal, that asks for a newer macOS than the floor, and nothing else", async (t) => {
  const bundle = await temporaryDirectory(t, "mach-o-minimum-");

  const write = (relative, bytes) => {
    fs.mkdirSync(path.dirname(path.join(bundle, relative)), { recursive: true });
    fs.writeFileSync(path.join(bundle, relative), bytes);
  };

  write("Contents/MacOS/Vespin", thinMachO(MACOS.V14_0));
  write("Contents/Resources/old.node", thinMachO(MACOS.V10_13, { older: true }));
  write(
    "Contents/Resources/universal",
    universalMachO([thinMachO(MACOS.V10_13), thinMachO(MACOS.V15_0)]),
  );
  write("Contents/Frameworks/New.framework/New", thinMachO(MACOS.V26_0));
  fs.symlinkSync("New.framework/New", path.join(bundle, "Contents/Frameworks/New"));
  // A Java class file opens with the universal magic, its version where a slice count would stand.
  write("Contents/Resources/Example.class", Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41]));
  write("Contents/Resources/notes.txt", "not a Mach-O");

  const above = machOAboveMinimum(bundle, "14.0").sort((a, b) => a.path.localeCompare(b.path));

  expect(above).toEqual([
    { path: path.join("Contents", "Frameworks", "New.framework", "New"), minimum: "26.0.0" },
    { path: path.join("Contents", "Resources", "universal"), minimum: "15.0.0" },
  ]);
});
