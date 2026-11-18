// setup-place.tsx -- where setup stands for the account (`APP_SETTING_SCHEMA.setupPlace`), as setup's steps read and keep it, so setup left on one device resumes at the same step on another; and New task opened once setup lets the app in.

import { ACT_KIND } from "@repo/host/acts";
import { selectAppSettingsView, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  APP_SETTING_SCHEMA,
  SETUP_AUDIENCE,
  type SetupPlace,
  type SetupStep,
  setupPlaceFrom,
  setupPlaceStored,
  setupSteps,
} from "@repo/settings";
import { actionRefused } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** Where setup starts, for an account of its own or one a team invited. */
const SETUP_START: SetupPlace = { audience: SETUP_AUDIENCE.ME, at: 0 };
const INVITED_START: SetupPlace = { audience: SETUP_AUDIENCE.INVITED, at: 0 };

/** The route each step stands at, by its `step`. */
export const SETUP_STEP_ROUTE = "/setup/[step]";

/** The route New task opens on once setup lets the app in. */
const START_TASK_ROUTE = "/start-task";

/** The place last written, shared by every step of setup's stack. */
const WrittenPlace = createContext<RefObject<SetupPlace | undefined> | undefined>(undefined);

/**
 * Whether setup's Finish asked for New task once the app stands, which the
 * tabs take as they come up (`useNewTaskAfterSetup`). Note that it is held
 * here rather than sent as a route, because the app's screens join the
 * stack only once the account's finish is drawn, after the press.
 */
let newTaskOwed = false;

/** Where setup stands, as its steps read it, and the move that keeps a step's change. */
export interface SetupPlaceRead {
  readonly place: SetupPlace;
  /** The steps the place's audience walks, every client's alike, so a place's `at` names the same step everywhere. */
  readonly steps: readonly SetupStep[];
  /** The step the place stands at, held to the steps, since a place kept by an earlier build may stand past the last. */
  readonly at: number;
  /** Keeps a change over the place last written. */
  readonly move: (change: Partial<SetupPlace>) => void;
  /** Keeps `at` as the step setup stands at, where the place last written stands elsewhere, as a step come back to by Back does. */
  readonly keepAt: (at: number) => void;
}

/**
 * Holds the place last written for setup's stack. Note that each move is
 * merged over the last one written, because two may land before the
 * account's place comes back, as a team's workspace made and the step after
 * it do; the account's own place takes its stead as it arrives.
 */
export function SetupPlaceProvider({ children }: { readonly children: ReactNode }) {
  const stored = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.setupPlace;
  const written = useRef<SetupPlace | undefined>(undefined);
  useEffect(() => {
    written.current = setupPlaceFrom(stored);
  }, [stored]);

  return <WrittenPlace.Provider value={written}>{children}</WrittenPlace.Provider>;
}

/**
 * Where setup stands: the account's place, else where it starts, for a team
 * that invited the account its survey and agent alone. Note that the place
 * is first kept on the first move rather than as setup opens, because a
 * preferences read that failed lets setup open without the account's place,
 * and nothing written unasked may then put back another device's.
 */
export function useSetupPlace(): SetupPlaceRead {
  const written = useContext(WrittenPlace);
  const acts = useHostActs();
  const write = useWrite();
  const stored = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.setupPlace;
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  if (written === undefined) throw new Error("A setup step stood outside setup's stack.");

  const invited = workspaces.some((workspace) => workspace.personal !== true);
  const place = setupPlaceFrom(stored) ?? (invited ? INVITED_START : SETUP_START);

  const move = (change: Partial<SetupPlace>) => {
    const next = { ...(written.current ?? place), ...change };
    written.current = next;
    void write(
      () =>
        acts[ACT_KIND.SETTING_UPDATE]({
          field: APP_SETTING_SCHEMA.setupPlace.field,
          value: setupPlaceStored(next),
        }),
      { refused: actionRefused },
    );
  };

  const steps = setupSteps(place.audience);

  return {
    place,
    steps,
    at: Math.min(Math.max(place.at, 0), steps.length - 1),
    move,
    keepAt: (at) => {
      if ((written.current ?? place).at !== at) move({ at });
    },
  };
}

/** Asks for New task once setup lets the app in. */
export function askNewTaskAfterSetup(): void {
  newTaskOwed = true;
}

/** Lets go of New task asked for, as a finish refused does. */
export function letGoNewTaskAfterSetup(): void {
  newTaskOwed = false;
}

/** Opens New task as the app's tabs come up after setup's Finish asked for it, once. */
export function useNewTaskAfterSetup(): void {
  const router = useRouter();
  useEffect(() => {
    if (!newTaskOwed) return;
    newTaskOwed = false;
    router.push(START_TASK_ROUTE);
  }, [router]);
}
