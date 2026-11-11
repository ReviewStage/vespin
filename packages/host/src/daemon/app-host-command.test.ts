import assert from "node:assert/strict";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import {
  appHostCommandLinked,
  appRefusesCommand,
  COMMAND_LINK_OUTCOME,
} from "./app-host-command.js";

/**
 * app-host-command.test.ts -- the `vespin-host` command once the app runs This Mac's host: the app's own copy refuses every command but `run` and `version`, and the command's link is made where none stands but never written over the member's own file or link.
 */

const FILES = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const APP_HOST = "/Applications/Vespin.app/Contents/Resources/host";
const ACCOUNT_HOST = "/Users/member/.local/share/vespin-host/versions/0.30.0";

describe("the host program run from inside the app", () => {
  it.each([
    { folder: APP_HOST, command: "uninstall", refused: true },
    { folder: APP_HOST, command: "connect", refused: true },
    { folder: APP_HOST, command: "leave", refused: true },
    { folder: APP_HOST, command: "run", refused: false },
    { folder: APP_HOST, command: "version", refused: false },
    { folder: ACCOUNT_HOST, command: "connect", refused: false },
  ])(
    "answers $command from $folder only where the app does not run it",
    ({ folder, command, refused }) => {
      assert.equal(appRefusesCommand(folder, command), refused);
    },
  );
});

describe("the command's link to the app's launcher", () => {
  it.effect.each([
    { case: "a file of the member's", stands: "file", outcome: COMMAND_LINK_OUTCOME.LEFT },
    { case: "a link to another program", stands: "link", outcome: COMMAND_LINK_OUTCOME.LEFT },
    { case: "nothing", stands: "nothing", outcome: COMMAND_LINK_OUTCOME.LINKED },
  ] as const)("is made only where it stands on nothing, here on $case", ({ stands, outcome }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const home = yield* temporaryDirectoryScoped("app-host-command-");
        const link = join(home, ".local", "bin", "vespin-host");
        const launcher = join(home, "Vespin.app", "Contents", "MacOS", "vespin-host");
        const elsewhere = join(home, "bin", "vespin-host");
        yield* fileSystem.makeDirectory(join(home, ".local", "bin"), { recursive: true });
        if (stands === "file") yield* fileSystem.writeFileString(link, "#!/bin/sh\n");
        if (stands === "link") yield* fileSystem.symlink(elsewhere, link);

        assert.equal(yield* appHostCommandLinked({ home, launcher }), outcome);

        if (stands === "file") assert.equal(yield* fileSystem.readFileString(link), "#!/bin/sh\n");
        if (stands === "link") assert.equal(yield* fileSystem.readLink(link), elsewhere);
        if (stands === "nothing") assert.equal(yield* fileSystem.readLink(link), launcher);
      }).pipe(Effect.provide(FILES)),
    ),
  );
});
