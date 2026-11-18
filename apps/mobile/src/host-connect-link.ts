// host-connect-link.ts -- a machine's pairing link, `/connect/<code>`, handed to Settings › Machines, which reads the pairing and asks over it before anything is sent, as the panel's link opens Settings › Hosts over its Connect dialog.

import { hostUserCodeOf } from "@repo/features/host-wire";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { launchHostConnect } from "./host/launch-arguments.js";
import { SETTINGS_ROUTE } from "./settings-button.js";

/** The code a link handed the app, waiting for Settings to open on it; none once it has. */
const handed = heldValue<string | undefined>(undefined);

/** Whether this launch's own code (`-connect <code>`) was handed, so a screen drawn again never hands it twice. */
let launchHanded = false;

/**
 * Hands the app a pairing's code, as a link that opened it or a link tapped
 * in it names one; Settings opens on it once the app stands signed in. Note
 * that the code only opens the page, which reads the pairing and asks, so a
 * link alone never connects a machine.
 */
export function handHostConnect(code: string): void {
  handed.set(code);
}

/**
 * Opens Settings › Machines on a handed code while `open`, the app signed in
 * and no update holding it, with Settings' main list under it so Back goes
 * there; a code handed before then waits, as a share sheet's draft does.
 * A launch that names one (`-connect <code>`) hands it as its link would.
 */
export function useHostConnectLink(open: boolean): void {
  const router = useRouter();
  const code = useHeldValue(handed);
  // Note that a launch naming a code (`-connect <code>`) hands it once, as the link it stands for would.
  useEffect(() => {
    if (launchHanded) return;
    launchHanded = true;
    const launched = hostUserCodeOf(launchHostConnect() ?? "");

    if (launched !== undefined) handHostConnect(launched);
  }, []);
  useEffect(() => {
    if (!open || code === undefined) return;
    // Note that the code is let go aloud, so the same link opened again later is heard as new.
    handed.set(undefined);
    router.push(
      { pathname: SETTINGS_ROUTE.MACHINE_CONNECT, params: { code } },
      { withAnchor: true },
    );
  }, [open, code, router]);
}
