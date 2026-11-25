import { BILLING_USAGE_KIND, type BillingStatusAnswer } from "@repo/features/billing-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsRow,
  type SettingsRowSkeletonLayout,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
} from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { billingStatusQuery } from "../billing.js";
import { refusedShown } from "../failure-report.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * billing-page.tsx -- Settings › Billing: this month's usage against the included allowance, and where billing is set up and managed, for a workspace's owners and admins.
 *
 * It stands only while the service answers that billing is on
 * (`useBillingShown`). Usage is the ledger's month read, one total per kind,
 * so the totals match the ledger; what is left of the included allowance
 * and what is owed past it come from the same read.
 */

/** The words the page says. */
const WORDS = {
  USAGE_CAPTION: "This month in UTC; usage past the included amount is billed at month's end.",
  INCLUDED_LEFT: "Included usage left",
  OWED: "Owed past included usage",
  READING: "billing",
  READ_FAILED: "Billing could not be read.",
  STATUS: "Card",
  SET_UP: "Set up billing",
  SETTING_UP: "Opening",
  MANAGE: "Manage billing",
  MANAGING: "Opening",
  NOT_SET_UP: "Not set up",
  NOT_SET_UP_LINE: "Add one to pay for usage past the included amount.",
  BLOCKED: "Blocked by a failed payment",
  BLOCKED_LINE:
    "An invoice could not be collected, so new cloud agents are held until it is paid. Update the card from Manage billing.",
} as const;

/** What each kind of usage is called, a kind a newer service adds read by its own name. */
const USAGE_KIND_WORDS = new Map<string, string>([
  [BILLING_USAGE_KIND.SANDBOX_SESSION, "Cloud agents"],
]);

/** How often the status is read while setup is awaited, in milliseconds. */
const SETUP_POLL_MS = 5_000;

/** How long the status is read after Checkout opens before the page gives up waiting, in milliseconds. */
const SETUP_POLL_LIMIT_MS = 120_000;

const MICRO_USD_PER_USD = 1_000_000;

/** Micro-dollars as dollars and cents, as an invoice would say them. */
function dollarsOf(microUsd: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    microUsd / MICRO_USD_PER_USD,
  );
}

/** The total of every kind's usage this month, in micro-dollars. */
function usageTotal(status: BillingStatusAnswer): number {
  return status.usage.reduce((sum, each) => sum + each.amountMicroUsd, 0);
}

/** A usage row while billing is read. */
const ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: false,
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
};

/** Usage's rows: each kind's total, then what is left of the included usage and what is owed past it. */
function UsageSection({ status }: { status: BillingStatusAnswer }): React.JSX.Element {
  const left = Math.max(0, status.includedMicroUsd - usageTotal(status));

  return (
    <SettingsSection {...settingsSectionHead(SECTION.BILLING_USAGE)} caption={WORDS.USAGE_CAPTION}>
      {status.usage.length === 0 ? (
        <SettingsRow label={USAGE_KIND_WORDS.get(BILLING_USAGE_KIND.SANDBOX_SESSION)}>
          {() => <SettingsRowValue>{dollarsOf(0)}</SettingsRowValue>}
        </SettingsRow>
      ) : (
        status.usage.map((each) => (
          <Fragment key={each.kind}>
            <SettingsRow label={USAGE_KIND_WORDS.get(each.kind) ?? each.kind}>
              {() => <SettingsRowValue>{dollarsOf(each.amountMicroUsd)}</SettingsRowValue>}
            </SettingsRow>
          </Fragment>
        ))
      )}
      <SettingsRow label={WORDS.INCLUDED_LEFT}>
        {() => (
          <SettingsRowValue>
            {dollarsOf(left)} of {dollarsOf(status.includedMicroUsd)}
          </SettingsRowValue>
        )}
      </SettingsRow>
      <SettingsRow label={WORDS.OWED}>
        {() => <SettingsRowValue>{dollarsOf(status.owedMicroUsd)}</SettingsRowValue>}
      </SettingsRow>
    </SettingsSection>
  );
}

/** Where billing stands, with Set up billing where it is not set up and Manage billing where it is. */
function StatusSection({
  workspace,
  status,
  onSetupOpened,
}: {
  workspace: Workspace;
  status: BillingStatusAnswer;
  /** Called once Stripe's Checkout has opened, so the page reads the status until setup is recorded. */
  onSetupOpened: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendSetup } = useMutation(actMutation(ACT_KIND.WORKSPACE_BILLING_SETUP));
  const { mutateAsync: sendPortal } = useMutation(actMutation(ACT_KIND.WORKSPACE_BILLING_PORTAL));
  // Note that a second press while the browser is being sent is taken as none.
  const opening = useAsyncAction(rejectionWords);
  const workspaceId = workspace.id;

  // Note that billing set up and in good standing says nothing beside its Manage billing button.
  const state = status.blocked
    ? { tone: SETTINGS_ROW_STATE.ATTENTION, name: WORDS.BLOCKED, line: WORDS.BLOCKED_LINE }
    : status.setUp
      ? undefined
      : { tone: SETTINGS_ROW_STATE.PLAIN, name: WORDS.NOT_SET_UP, line: WORDS.NOT_SET_UP_LINE };

  const press = () =>
    void opening
      .run(() =>
        (status.setUp ? sendPortal({ workspaceId }) : sendSetup({ workspaceId })).then(
          () => undefined,
        ),
      )
      .then((opened) => {
        if (opened && !status.setUp) onSetupOpened();
      });

  return (
    <SettingsSection {...settingsSectionHead(SECTION.BILLING_STATUS)}>
      <SettingsRow
        label={WORDS.STATUS}
        description={
          state === undefined ? undefined : (
            <SettingsRowStateLine state={state.tone}>
              {state.name}. {state.line}
            </SettingsRowStateLine>
          )
        }
        error={replayMaskedError(refusedShown(opening.refusal, FAILURE_SURFACE.WORKSPACE_BILLING))}
      >
        {() => (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={opening.running}
            busyLabel={status.setUp ? WORDS.MANAGING : WORDS.SETTING_UP}
            onClick={press}
          >
            {status.setUp ? WORDS.MANAGE : WORDS.SET_UP}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

/** Settings › Billing over one workspace, read as the page opens; keyed to the workspace so another reads its own. */
export function BillingPage({ workspace }: { workspace: Workspace }): React.JSX.Element {
  // Note that setup is recorded by Stripe's webhook, which may land after the member returns, so once Checkout has opened the page reads the status every few seconds until it shows setup.
  const [waitingSince, setWaitingSince] = useState<number | undefined>(undefined);

  const billing = useQuery({
    ...billingStatusQuery(workspace.id),
    // Note that a hidden tab is never polled (`refetchIntervalInBackground` stays off), and the reading gives up after a bound, so a tab left open does not poll for ever.
    refetchInterval: (query) =>
      waitingSince !== undefined &&
      Date.now() - waitingSince < SETUP_POLL_LIMIT_MS &&
      query.state.data?.setUp !== true
        ? SETUP_POLL_MS
        : false,
  });

  const status = billing.data;

  if (billing.isError) {
    return (
      <SettingsSection>
        <ReadFailed
          line={WORDS.READ_FAILED}
          surface={FAILURE_SURFACE.WORKSPACE_BILLING_READ}
          onRetry={() => void billing.refetch()}
        />
      </SettingsSection>
    );
  }

  if (status === undefined) {
    return <SettingsRowsSkeleton label={readingWords(WORDS.READING)} rows={[ROW_SKELETON]} />;
  }

  return (
    <Fragment key={workspace.id}>
      <UsageSection status={status} />
      <StatusSection
        workspace={workspace}
        status={status}
        onSetupOpened={() => setWaitingSince(Date.now())}
      />
    </Fragment>
  );
}
