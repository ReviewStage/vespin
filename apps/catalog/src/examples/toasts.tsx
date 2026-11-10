/**
 * toasts.tsx -- the passing notices in each tone, stacked as the window stacks
 * them, each stack on a Base UI manager of its own: a plain one that lets
 * clicks through, one with a second line, and one carrying Undo; then ones
 * carrying an action, one of them led by a provider's mark and one opening
 * a page, whose × shows under the pointer or focus; failures that offer
 * their details to copy, alone and beside a Retry; one whose work is under
 * way, turned in place into done or failed by a press; and one to swipe
 * sideways away, shown again by a press.
 */

import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  Button,
  createToastManager,
  GAP,
  Inline,
  type MarkProvider,
  STATUS_TONE,
  type StandingToast,
  TOAST_TYPE,
  Toast,
  ToastActions,
  type ToastCopy,
  ToastStack,
  type ToastStackManager,
  type ToastTone,
} from "@repo/ui";
import { type ReactNode, useEffect, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

function noop(): void {}

/** A toast as a catalog stack shows it: what the card draws, and its action, where it has one. */
interface CatalogNotice {
  readonly id: string;
  readonly tone: ToastTone;
  readonly words: string;
  readonly detail?: string;
  readonly mark?: MarkProvider;
  /** Its action's label, and the page it opens, where it opens one. */
  readonly action?: { readonly label: string; readonly href?: string };
  readonly copy?: ToastCopy;
}

/** The toast a catalog stack draws for `toast`, its action and × closing it on `manager`. */
function CatalogToast({
  toast,
  manager,
}: {
  toast: StandingToast<CatalogNotice>;
  manager: ToastStackManager<CatalogNotice>;
}): ReactNode {
  const notice = toast.data;
  if (notice === undefined) return null;
  const { action, copy } = notice;
  const href = action?.href;
  return (
    <Toast
      toast={toast}
      tone={notice.tone}
      mark={notice.mark}
      words={notice.words}
      detail={notice.detail}
      actions={
        action === undefined && copy === undefined ? undefined : (
          <ToastActions
            {...(action === undefined
              ? {}
              : {
                  label: action.label,
                  href,
                  onPress:
                    href === undefined ? noop : () => window.open(href, "_blank", "noreferrer"),
                })}
            copy={copy}
            dismissLabel="Dismiss"
            onDismiss={() => manager.close(toast.id)}
          />
        )
      }
    />
  );
}

/**
 * A stack in its own frame, standing `shown` until each is dismissed, and
 * the manager it keeps them on. Note that the frame's transform makes it
 * the containing block of the stack's fixed corner, and that each toast is
 * shown by its id, so showing it again in place changes nothing.
 */
function CatalogStack({
  label,
  shown,
  manager,
}: {
  label: string;
  shown: readonly CatalogNotice[];
  manager: ToastStackManager<CatalogNotice>;
}): React.JSX.Element {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    // Note that a manager only reaches a stack once the stack stands, so nothing is shown before its frame is.
    if (frame === null) return;
    for (const notice of shown) manager.add({ id: notice.id, ...standing(notice) });
  }, [frame, manager, shown]);
  return (
    <div className="catalog-toast-stage" ref={setFrame}>
      {frame === null ? null : (
        <ToastStack manager={manager} label={label} container={frame}>
          {(toast) => <CatalogToast key={toast.id} toast={toast} manager={manager} />}
        </ToastStack>
      )}
    </div>
  );
}

/** How a catalog toast stands: until it is dismissed, its words said aloud, a refusal urgently, and one saying work is under way with no hold until it settles. */
function standing(notice: CatalogNotice) {
  return {
    title: notice.words,
    description: notice.detail,
    priority: notice.tone === STATUS_TONE.DANGER ? ("high" as const) : ("low" as const),
    timeout: 0,
    type: notice.tone === STATUS_TONE.WORKING ? TOAST_TYPE.WORKING : undefined,
    data: notice,
  };
}

/** A manager of the section's own, made once. */
function useCatalogManager(): ToastStackManager<CatalogNotice> {
  return useState(() => createToastManager<CatalogNotice>())[0];
}

/** The window's stack at its fullest: a plain toast, a refusal with a second line, and an Undo. */
const STACKED: readonly CatalogNotice[] = [
  { id: "copied", tone: STATUS_TONE.COMPLETE, words: "Link copied" },
  {
    id: "unsaved",
    tone: STATUS_TONE.DANGER,
    words: "Couldn't save the description",
    detail: "Your change is kept here until you are back online.",
  },
  {
    id: "archived",
    tone: STATUS_TONE.COMPLETE,
    words: "Task archived",
    action: { label: "Undo" },
  },
];

/** Toasts carrying an action: an ask, a connection led by its provider's mark, and one opening a page. */
const ACTING: readonly CatalogNotice[] = [
  {
    id: "ask",
    tone: STATUS_TONE.ATTENTION,
    words: "Should withdrawn invitations count?",
    detail: "Relay · Retry the webhook",
    action: { label: "View" },
  },
  {
    id: "expired",
    tone: STATUS_TONE.ATTENTION,
    mark: INTEGRATION_PROVIDER.LINEAR,
    words: "Linear's sign-in expired",
    action: { label: "Reconnect" },
  },
  {
    id: "credit",
    tone: STATUS_TONE.DANGER,
    words: "Your OpenAI account is out of credit.",
    action: {
      label: "Add credit",
      href: "https://platform.openai.com/settings/organization/billing/overview",
    },
  },
];

function Toasts(): React.JSX.Element {
  const manager = useCatalogManager();
  return (
    <CatalogSection id="toast-stack" title="Stacked in the corner">
      <CatalogStack label="Notifications" shown={STACKED} manager={manager} />
    </CatalogSection>
  );
}

function Acting(): React.JSX.Element {
  const manager = useCatalogManager();
  return (
    <CatalogSection id="toast-actions" title="Carrying an action">
      <CatalogStack label="Action notifications" shown={ACTING} manager={manager} />
    </CatalogSection>
  );
}

/** What a failure's Copy details puts on the clipboard, as the panel builds it from the failure's report. */
const FAILURE_DETAILS = [
  `${PRODUCT_NAME} error details. Include these when you report this problem:`,
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: agent.stop",
  "failure.kind: unexpected",
  "failure.code: TypeError",
].join("\n");

/** A catalog's clipboard: the browser's own. */
function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** The details a failure toast copies, through the browser's clipboard. */
const FAILURE_COPY: ToastCopy = { text: FAILURE_DETAILS, what: "details", copy: copyToClipboard };

/** Failure toasts, each offering its details to copy: one with nothing else to press, and one beside its Retry. */
const FAILED: readonly CatalogNotice[] = [
  {
    id: "unstopped",
    tone: STATUS_TONE.DANGER,
    words: "The agent could not be stopped.",
    copy: FAILURE_COPY,
  },
  {
    id: "unsaved",
    tone: STATUS_TONE.DANGER,
    words: "Your description edits could not be saved.",
    action: { label: "Retry" },
    copy: FAILURE_COPY,
  },
];

function Failures(): React.JSX.Element {
  const manager = useCatalogManager();
  return (
    <CatalogSection id="toast-failure-copy" title="Failures copy their details">
      <CatalogStack label="Failure notifications" shown={FAILED} manager={manager} />
    </CatalogSection>
  );
}

/** What the working toast says, by what came of its work. */
const SAYING = {
  [STATUS_TONE.WORKING]: "Adding to the description…",
  [STATUS_TONE.COMPLETE]: "Added to the description",
  [STATUS_TONE.DANGER]: "The description could not be saved.",
} as const;

type Outcome = keyof typeof SAYING;

/** The working toast's id on its stack. */
const WORK_ID = "work";

/** The working toast as the section first shows it. */
const WORK: readonly CatalogNotice[] = [
  { id: WORK_ID, tone: STATUS_TONE.WORKING, words: SAYING[STATUS_TONE.WORKING] },
];

/** A working toast, turned in place by a press into what came of its work. */
function Working(): React.JSX.Element {
  const manager = useCatalogManager();
  const say = (tone: Outcome) => {
    const notice = { id: WORK_ID, tone, words: SAYING[tone] };
    manager.add({ id: WORK_ID, ...standing(notice) });
  };
  return (
    <CatalogSection id="toast-working" title="Working, then done in place">
      <Inline gap={GAP.CONTROL}>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => say(STATUS_TONE.WORKING)}>
          Start
        </Button>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => say(STATUS_TONE.COMPLETE)}>
          Succeed
        </Button>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => say(STATUS_TONE.DANGER)}>
          Fail
        </Button>
      </Inline>
      <CatalogStack label="Working notifications" shown={WORK} manager={manager} />
    </CatalogSection>
  );
}

/** A toast to swipe sideways away, shown anew by a press once it has gone. */
function Swiped(): React.JSX.Element {
  const manager = useCatalogManager();
  const [shown] = useState<readonly CatalogNotice[]>(() => [swipeable()]);
  return (
    <CatalogSection id="toast-swipe" title="Swiped away">
      <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => manager.add(standing(swipeable()))}>
        Show again
      </Button>
      <CatalogStack label="Swipeable notifications" shown={shown} manager={manager} />
    </CatalogSection>
  );
}

/** The toast the swipe section shows. */
function swipeable(): CatalogNotice {
  return {
    id: crypto.randomUUID(),
    tone: STATUS_TONE.COMPLETE,
    words: "Task archived",
    detail: "Swipe it sideways",
    action: { label: "Undo" },
  };
}

function AllToasts(): React.JSX.Element {
  return (
    <>
      <Toasts />
      <Acting />
      <Failures />
      <Working />
      <Swiped />
    </>
  );
}

export const TOASTS_EXAMPLE: Example = { id: "toasts", title: "Toasts", Render: AllToasts };
