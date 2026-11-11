/**
 * automations-route.ts -- the Automations pages as the router stands them: whether one stands, which its address names, and the navigation that opens, turns, and leaves them.
 *
 * The pages are a routed place (`panel-router.tsx`) under the workspace
 * their address names, read from the address alone: the list at
 * `/<workspace>/automations`, its Runs tab at `/automations/runs`, a new
 * automation's page at `/automations/new`, filled in from a suggestion's
 * preset where its `?preset=` names one, an automation's at
 * `/automation/<id>`, its runs alone at `/automation/<id>/runs`, and one of
 * its runs at `/automation/<id>/run/<runId>`, which a narrow room stands
 * alone too. Each is a step of its own but the automation a new page made,
 * which takes that page's step, an automation's runs outside a narrow room,
 * which take its setup's, and its setup stood again from its runs,
 * which the window's history steps back to or takes in place
 * (`places/narrow-backs.ts`). An automation deleted is held
 * for as long as the window lives, so Back passes over its steps for good.
 */

import { AUTOMATION_PRESET, type AutomationPresetName } from "@repo/features/automation-presets";
import { type NavigateOptions, useNavigate, useRouter } from "@tanstack/react-router";
import { useRoutedExits, useRoutedMemory } from "./places/routed-exits.js";
import { ROUTED_PLACE, useWindowPlace } from "./places/routed-places.js";
import { pathUnder } from "./route-gates.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "./tasks/automations-place.js";

/** The list, where the pages open with none asked for and stand while none does. */
const AUTOMATIONS_LIST: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST };

/** Each Automations route by id, and the page it stands, with whether an automation's runs stand alone over its setup. */
const AUTOMATIONS_LEAF = {
  "/places/$workspace/automation-pages/automations/": { kind: AUTOMATIONS_PAGE.LIST, runs: false },
  "/places/$workspace/automation-pages/automations/runs": {
    kind: AUTOMATIONS_PAGE.RUNS,
    runs: false,
  },
  "/places/$workspace/automation-pages/automations/new": {
    kind: AUTOMATIONS_PAGE.NEW,
    runs: false,
  },
  "/places/$workspace/automation-pages/automation/$automationId/": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: false,
  },
  "/places/$workspace/automation-pages/automation/$automationId/runs": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: true,
  },
  "/places/$workspace/automation-pages/automation/$automationId/run/$runId": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: true,
  },
} as const;

/** Which Automations page the router stands, read alone, as a surface that only draws it reads it. */
export interface AutomationsStanding {
  readonly open: boolean;
  /** The page standing, the list while none does. */
  readonly place: AutomationsPlace;
  /** Whether an automation's runs stand alone over its setup, which only a narrow room draws apart. */
  readonly runs: boolean;
  /** The address step of the workspace whose pages stand, while one does. */
  readonly standingIn: string | undefined;
}

/** The Automations pages as the router stands them. */
export interface AutomationsRoute extends AutomationsStanding {
  /** Whether the window has seen the automation `automationId` deleted, as it is asked. */
  readonly deletedNow: (automationId: string) => boolean;
  /** The address of the automation's setup while its runs stand alone over it, which a way back from them steps back to. */
  readonly setupAddress: string | undefined;
  /** Opens `to` under the workspace whose address step is `workspace`. */
  readonly onOpen: (to: AutomationsPlace, workspace: string) => void;
  /** Whether the page `to` under `workspace` is the one standing, which opening it moves nothing to. */
  readonly standsAt: (to: AutomationsPlace, workspace: string) => boolean;
  /** Stands the automation's runs alone as a step of their own, or its setup again in the step's place. */
  readonly onRuns: (shown: boolean) => void;
  readonly onClose: () => void;
  /** Stands the same page under `workspace` in the step's place, as another workspace listed under the pages does. */
  readonly onTurn: (workspace: string) => void;
}

/** The preset an address's `?preset=` names, where it names one this build knows. */
function presetOf(named: string | undefined): AutomationPresetName | undefined {
  return Object.values(AUTOMATION_PRESET).find((preset) => preset === named);
}

/** The page the address stands, where it stands one. */
function placeOf(
  leaf: string | undefined,
  params: Readonly<Record<string, string | undefined>>,
  search: Readonly<Record<string, string>>,
): { place: AutomationsPlace; runs: boolean } | undefined {
  const page = Object.entries(AUTOMATIONS_LEAF).find(([id]) => id === leaf)?.[1];
  if (page === undefined) return undefined;
  const { automationId, runId } = params;
  if (page.kind === AUTOMATIONS_PAGE.NEW) {
    const preset = presetOf(search.preset);
    return {
      place: preset === undefined ? { kind: page.kind } : { kind: page.kind, preset },
      runs: false,
    };
  }
  if (page.kind !== AUTOMATIONS_PAGE.EDIT) return { place: { kind: page.kind }, runs: false };
  if (automationId === undefined) return undefined;
  const place: AutomationsPlace =
    runId === undefined
      ? { kind: AUTOMATIONS_PAGE.EDIT, automationId }
      : { kind: AUTOMATIONS_PAGE.EDIT, automationId, runId };
  return { place, runs: page.runs };
}

/** The navigation that stands `to` under `workspace`. */
function navigationTo(to: AutomationsPlace, workspace: string): NavigateOptions {
  switch (to.kind) {
    case AUTOMATIONS_PAGE.LIST:
      return { to: "/$workspace/automations", params: { workspace } };
    case AUTOMATIONS_PAGE.RUNS:
      return { to: "/$workspace/automations/runs", params: { workspace } };
    case AUTOMATIONS_PAGE.NEW:
      return {
        to: "/$workspace/automations/new",
        params: { workspace },
        search: to.preset === undefined ? {} : { preset: to.preset },
      };
    case AUTOMATIONS_PAGE.EDIT:
      return to.runId === undefined
        ? {
            to: "/$workspace/automation/$automationId",
            params: { workspace, automationId: to.automationId },
          }
        : {
            to: "/$workspace/automation/$automationId/run/$runId",
            params: { workspace, automationId: to.automationId, runId: to.runId },
          };
  }
}

/** Which Automations page the router stands, if any. */
export function useAutomationsPlace(): AutomationsStanding {
  const here = useWindowPlace();
  const standing =
    here.place === ROUTED_PLACE.AUTOMATIONS
      ? placeOf(here.leaf, here.params, here.search)
      : undefined;
  return {
    open: standing !== undefined,
    place: standing?.place ?? AUTOMATIONS_LIST,
    runs: standing?.runs ?? false,
    standingIn: standing === undefined ? undefined : here.params.workspace,
  };
}

/** The Automations pages as the router stands them, in a room `narrow` or not, left by the window's routed exit, and kept standing by its stay where a leave was asked of them before a door asked for the page standing. */
export function useAutomationsRoute(input: { narrow: boolean }): AutomationsRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const standing = useAutomationsPlace();
  const exits = useRoutedExits();
  // Only grows: every automation the window has seen deleted.
  const deleted = useRoutedMemory().deletedAutomations;
  const { standingIn } = standing;
  const standsAt = (to: AutomationsPlace, workspace: string) =>
    router.buildLocation(navigationTo(to, workspace)).href === router.history.location.href;
  const onOpen = (to: AutomationsPlace, workspace: string) => {
    const gone = to.kind === AUTOMATIONS_PAGE.LIST ? to.deleted : undefined;
    if (gone !== undefined) deleted.setState((held) => new Map(held).set(gone, true));
    const options = navigationTo(to, workspace);
    // Opening the page already standing moves nothing, as pressing the place standing always has,
    // and keeps it standing where the door that asked for it left the routed place first, as ⌘K's does.
    if (standsAt(to, workspace)) {
      exits.stay();
      return;
    }
    // The automation a new page made takes that page's step.
    const replace = to.kind === AUTOMATIONS_PAGE.EDIT && to.created === true;
    void navigate({ ...options, replace });
  };
  const automation =
    standing.place.kind === AUTOMATIONS_PAGE.EDIT && standingIn !== undefined
      ? { workspace: standingIn, automationId: standing.place.automationId }
      : undefined;
  const setup =
    automation === undefined
      ? undefined
      : ({ to: "/$workspace/automation/$automationId", params: automation } as const);
  // Note that the runs alone are a step of their own in a narrow room alone, as a page of Settings is; a wide room's take the setup's step, as its setup takes theirs back.
  const onRuns = (shown: boolean) => {
    if (setup === undefined || standing.runs === shown) return;
    if (shown) {
      void navigate({
        to: "/$workspace/automation/$automationId/runs",
        params: setup.params,
        replace: !input.narrow,
      });
    } else void navigate({ ...setup, replace: true });
  };
  const onTurn = (workspace: string) => {
    if (standingIn === undefined || standingIn === workspace) return;
    const { pathname } = router.history.location;
    void navigate({ href: pathUnder(pathname, workspace), replace: true });
  };
  return {
    ...standing,
    deletedNow: (automationId) => deleted.state.has(automationId),
    setupAddress:
      setup === undefined || !standing.runs ? undefined : router.buildLocation(setup).href,
    onOpen,
    standsAt,
    onRuns,
    onClose: () => exits.leave(),
    onTurn,
  };
}
