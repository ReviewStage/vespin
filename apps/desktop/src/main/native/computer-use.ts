import { ComputerUseHelper, computerUseHelperProcess } from "@repo/host/effect";
import { Layer } from "effect";
import { nativeHelperPath } from "./native-helper";

/**
 * computer-use.ts -- the Mac's computer-use helper as the host asks it (`@repo/host/effect`'s `ComputerUseHelper`): the `mac-computer-use` binary beside the app, run as the app's own child.
 *
 * Note that the app spawns it itself, rather than any agent's process,
 * because macOS holds Screen Recording and Accessibility against the process
 * responsible for the one asking, and that is the app the developer granted.
 */

/** The helper's binary, as `NATIVE_HELPERS` names it (`scripts/package-layout.mjs`). */
const COMPUTER_USE_BINARY = "mac-computer-use";

export function computerUseHelperLayer() {
  return Layer.effect(
    ComputerUseHelper,
    computerUseHelperProcess(nativeHelperPath(COMPUTER_USE_BINARY)),
  );
}
