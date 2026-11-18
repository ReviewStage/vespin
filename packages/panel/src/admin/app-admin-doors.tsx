/**
 * app-admin-doors.tsx -- the app's doors into the admin screens: the service's admin reads and its star asked through the window's host, and the gate's refusals in the app's own words.
 *
 * The window acts through its act port alone, so each read is `admin.read`
 * on it, which the host asks of the service under the account's session
 * (`@repo/features/admin-client`), and the star is `admin.favorite`. The
 * port carries no signal, so a read whose query was canceled runs to its
 * end, and Query drops its answer (`admin-queries.ts`), as it drops any
 * read it canceled. The app is signed in before it
 * draws, so nothing is held at the gate up front, and a refusal stands in
 * the page as the app's centered failure rather than a sign-in card. The app
 * keeps its places in its own history, whose step for each view has an app
 * link of its own (`links-at-hand.ts`), so a screen here keeps its search
 * to itself and an account opens on a press, as a step of that history. A
 * page outside the dashboard opens as every link in the window does
 * (`useOpenLink`), since the window opens no browser tab of its own.
 */

import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { COLLECTION_STATE, ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { useMemo } from "react";
import { askAct } from "../act.js";
import { failureShown } from "../failure-report.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import {
  type AdminDoors,
  AdminDoorsProvider,
  type AdminReads,
  adminReadsAnswering,
} from "./admin-doors.js";
import { AdminCollectionPage } from "./chrome/page-header.js";

/** What the page says where the gate refused the read, in place of the view. */
const GATE_WORDS = {
  SIGNED_OUT: "Your session has ended. Sign in again to read the admin dashboard.",
  FORBIDDEN: "This account does not have the admin role, which is set in the database.",
} as const;

/** The service's admin reads through the host, each `admin.read` on the window's act port, and the star `admin.favorite`. */
const APP_ADMIN_READS: AdminReads = adminReadsAnswering(
  (params) => askAct(ACT_KIND.ADMIN_READ, params),
  (id, favorite) => askAct(ACT_KIND.ADMIN_FAVORITE, { id, favorite }).catch(() => false),
);

/** A refusal standing in the view's place, as the app's centered failure, under the place's own toolbar and sections. */
function GateRefusal({ words }: { words: string }): React.JSX.Element {
  return (
    <AdminCollectionPage
      title="Admin"
      controls={null}
      filters={undefined}
      state={COLLECTION_STATE.ERROR}
      loadingLabel="Admin"
      error={
        <ErrorState
          failure={failureShown({
            surface: FAILURE_SURFACE.ADMIN_GATE,
            cause: FAILURE_CONDITION.REFUSED,
            refused: true,
          })}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
        >
          {words}
        </ErrorState>
      }
    />
  );
}

const APP_ADMIN_DOORS: AdminDoors = {
  reads: APP_ADMIN_READS,
  gate: {
    heldAtGate: () => false,
    signedOut: () => <GateRefusal words={GATE_WORDS.SIGNED_OUT} />,
    forbidden: () => <GateRefusal words={GATE_WORDS.FORBIDDEN} />,
  },
  address: {
    accountHref: () => undefined,
    workspaceHref: () => undefined,
    search: () => "",
    keepSearch: () => undefined,
    onSearchMoved: () => () => undefined,
  },
};

/** The app's doors, handed to every admin screen under it, a page outside the dashboard opening as the window opens links. */
export function AppAdminDoors({ children }: { children: React.ReactNode }): React.JSX.Element {
  const openLink = useOpenLink();
  const doors = useMemo<AdminDoors>(() => ({ ...APP_ADMIN_DOORS, openLink }), [openLink]);

  return <AdminDoorsProvider value={doors}>{children}</AdminDoorsProvider>;
}
