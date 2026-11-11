import type { AutomationPresetName } from "@repo/features/automation-presets";

/**
 * automations-place.ts -- the window's Automations pages by kind: the list, the runs, a new automation, and one automation's page.
 */

/** Which Automations page stands: the list, a new automation's editor, or one automation's. */
export const AUTOMATIONS_PAGE = {
  LIST: "list",
  /** Every run of the listed workspace's automations, beside the list as its other tab. */
  RUNS: "runs",
  NEW: "new",
  EDIT: "edit",
} as const;

export type AutomationsPlace =
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.LIST;
      /** The automation whose page was left for the list by deleting it, which the window's history passes over from then on; an opening's alone, which no address holds. */
      readonly deleted?: string;
    }
  | { readonly kind: typeof AUTOMATIONS_PAGE.RUNS }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.NEW;
      /** The suggestion on the list it was opened from, whose preset fills its draft in, as its address's `preset` names it; none for a blank one. */
      readonly preset?: AutomationPresetName;
    }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.EDIT;
      readonly automationId: string;
      /** The run a link named, which its runs mark and bring into view. */
      readonly runId?: string;
      /** Opened by the new automation's page that made it, as its Create landed, so it takes that page's step in the window's history; an opening's alone, which no address holds. */
      readonly created?: true;
    };

/** Whether a place is one of the Automations page's two tabs, the list or the runs, rather than one automation's page. */
export function automationsTab(place: AutomationsPlace): boolean {
  return place.kind === AUTOMATIONS_PAGE.LIST || place.kind === AUTOMATIONS_PAGE.RUNS;
}
