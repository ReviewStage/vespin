// host-connect-link.ts -- a machine's pairing link, `/connect/<code>`, handed to Settings › Machines, which reads the pairing and asks over it before anything is sent, as the panel's link opens Settings › Hosts over its Connect dialog.

import { hostUserCodeOf } from "@repo/features/host-wire";
import { useRouter } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { launchHostConnect } from "./host/launch-arguments.js";
import { SETTINGS_ROUTE } from "./settings-button.js";

/** The code a link handed the app, waiting for Settings to open on it; none once it has. */
let handed: string | undefined;

/** Whether this launch's own code (`-connect <code>`) was handed, so a screen drawn again never hands it twice. */
let launchHanded = false;

/** Who hears that a code was handed. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function handedCode(): string | undefined {
  return handed;
}

/** Holds a code, or lets it go, and tells whoever listens. */
function hold(code: string | undefined): void {
  handed = code;

  for (const listener of listeners) listener();
}

/**
 * Hands the app a pairing's code, as a link that opened it or a link tapped
 * in it names one; Settings opens on it once the app stands signed in. Note
 * that the code only opens the page, which reads the pairing and asks, so a
 * link alone never connects a machine.
 */
export function handHostConnect(code: string): void {
  hold(code);
}

/**
 * Opens Settings › Machines on a handed code while `open`, the app signed in
 * and no update holding it, with Settings' main list under it so Back goes
 * there; a code handed before then waits, as a share sheet's draft does.
 * A launch that names one (`-connect <code>`) hands it as its link would.
 */
export function useHostConnectLink(open: boolean): void {
  const router = useRouter();
  const code = useSyncExternalStore(subscribe, handedCode);
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
    hold(undefined);
    router.push(
      { pathname: SETTINGS_ROUTE.MACHINE_CONNECT, params: { code } },
      { withAnchor: true },
    );
  }, [open, code, router]);
}
