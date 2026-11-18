import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenStatus,
  type GitHubTokenSummary,
  pastedTokenFits,
} from "@repo/features/github-token-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dayText } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  OutsideLink,
  PasteSteps,
  SETTINGS_ROW_STATE,
  SettingsRowStateLine,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { sendAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";

/**
 * github-dialog.tsx -- Settings › Profile › GitHub personal access token: the member's own classic token, added in a dialog, described on its row, and removed from its ⋯.
 *
 * The dialog holds the paste alone, setup's own (`GitHubTokenPaste`), whose first step
 * opens GitHub's page for a new classic token in the browser. A saved token is told in
 * the row's description (`TokenFacts`), and Disconnect, which asks first
 * (`useGitHubTokenDisconnect`), stands in the row's ⋯. Every
 * refusal and status says what to do next, in a line.
 *
 * The token stands in the open field alone, is sent once as it is pasted or on Enter, and is
 * cleared as soon as the service keeps it; the service never answers one.
 */

/** What the token's paste says: its steps, its field, and the check while a save is out. */
const PASTE_WORDS = {
  CREATE: "Create a classic token with repo ticked",
  OPEN: "Open GitHub",
  LABEL: "Paste the token",
  RUNNING: "Checking the token",
} as const;

const LINE = {
  SAVE_FAILED: "The token could not be saved. Try again.",
  REMOVE_FAILED: "The token could not be removed. Try again.",
} as const;

/** Why a save kept nothing, and what to do next, as one short line. */
function rejectionLabel(rejection: GitHubTokenRejection): ReactNode {
  switch (rejection) {
    case GITHUB_TOKEN_REJECTION.FINE_GRAINED:
      return "This isn't a classic token. Create a classic token and paste that.";
    case GITHUB_TOKEN_REJECTION.INVALID:
      return "GitHub rejected this token. Check that you copied all of it, or create a new one.";
    case GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE:
      return "This token is missing the repo scope. Create a new token with repo ticked.";
    case GITHUB_TOKEN_REJECTION.UNREACHABLE:
      return "GitHub could not be reached. Try again.";
    case GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES:
      return "Too many tokens tried in the last hour. Try again later.";
  }
}

/** A saved token's status where it is not in use, and what to do about it, as one short line. */
function statusLabel(status: GitHubTokenStatus): string | undefined {
  switch (status) {
    case GITHUB_TOKEN_STATUS.VERIFIED:
      return undefined;
    case GITHUB_TOKEN_STATUS.INVALID:
      return "GitHub rejected this token. Disconnect it and add a new one.";
    case GITHUB_TOKEN_STATUS.UNREADABLE:
      return "Can no longer be read. Disconnect it and add it again.";
  }
}

/** A problem said in the attention tint, announced as it lands. */
function Problem({ children }: { children: string }): React.JSX.Element {
  useAnnounceShown(ANNOUNCE.ALERT, children);

  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>{children}</SettingsRowStateLine>
  );
}

/**
 * What tells a saved token apart, as one sentence with no dots: whose it is,
 * the end of it, and when it expires, then its status where it is not in use.
 */
export function TokenFacts({ token }: { token: GitHubTokenSummary }): React.JSX.Element {
  const status = statusLabel(token.status);
  const expiry = token.expiresAt === null ? "" : `, expires ${dayText(token.expiresAt)}`;

  return (
    <>
      <ReplayMask>{`${token.login}'s token ending ${token.hint}${expiry}`}</ReplayMask>
      {status === undefined ? null : <Problem>{status}</Problem>}
    </>
  );
}

/** The saved token's removal, as Disconnect's question holds its own mutation over it, answered as that question reads it. */
const TOKEN_REMOVE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.GITHUB_TOKEN_REMOVE],
  mutationFn: (): Promise<ActionResult> =>
    sendAct(ACT_KIND.GITHUB_TOKEN_REMOVE, undefined)
      .catch(() => undefined)
      .then((answer): ActionResult => {
        if (answer === undefined || "failure" in answer) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: LINE.REMOVE_FAILED };
        }

        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      }),
});

/**
 * The saved token's Disconnect, which asks first, as every connection in
 * Settings ends: the act for the row's ⋯ and the question it opens at the
 * foot of the page.
 */
export function useGitHubTokenDisconnect() {
  const removing = useMutation(TOKEN_REMOVE_MUTATION);

  const removalAct = useConfirmAct(removing, {
    send: () => removing.mutateAsync(),
    answered: sameAnswer,
  });

  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.GITHUB_TOKEN_REMOVE),
  );

  return {
    act: {
      label: "Disconnect",
      danger: true,
      disabled: removal.busy,
      onSelect: removal.ask,
    } satisfies MenuAction,
    question: (
      <ConfirmDialog
        open
        confirm={removal}
        question={{
          title: "Disconnect your GitHub token?",
          body: `${PRODUCT_NAME} deletes the token it holds, and your pull requests stop using it until you add one again.`,
          verb: "Disconnect token",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
        }}
      />
    ),
  };
}

/**
 * Sends a pasted token once, answering why GitHub or the service kept
 * nothing, or nothing where the token was kept. Note that a paste no token
 * could be is answered as GitHub's invalid one, unsent.
 */
export function useGitHubTokenSave(): (pasted: string) => Promise<ReactNode> {
  const { mutateAsync: sendGithubTokenSave } = useMutation(actMutation(ACT_KIND.GITHUB_TOKEN_SAVE));

  return (pasted) =>
    !pastedTokenFits(pasted)
      ? Promise.resolve(rejectionLabel(GITHUB_TOKEN_REJECTION.INVALID))
      : sendGithubTokenSave({ token: pasted })
          .catch(() => undefined)
          .then((answer) => {
            if (answer === undefined || "failure" in answer) return LINE.SAVE_FAILED;

            return answer.rejected === undefined ? undefined : rejectionLabel(answer.rejected);
          });
}

/**
 * A classic token's paste, setup's and the dialog's alike, drawn as an
 * agent key's is: two steps, making the token on GitHub's own page and
 * pasting it. The first checks off once its link is opened; the second is
 * the field, which a paste saves as it lands, as Enter saves what was typed,
 * saying it checks the token while the save is out and why one kept nothing
 * under it, the paste kept. The token leaves the field as soon as it is kept.
 */
export function GitHubTokenPaste({
  field,
  onSave,
}: {
  /** The way to the field, for a surface that hands it focus. */
  field?: React.RefObject<HTMLInputElement | null> | undefined;
  /** Saves the token, answering why it was refused, or nothing where it was kept. */
  onSave: (token: string) => Promise<ReactNode>;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(undefined);

  const save = (value: string) => {
    const token = value.trim();

    if (token === "" || saving) return;
    setSaving(true);
    setProblem(undefined);
    void onSave(token).then((refused) => {
      setSaving(false);
      setProblem(refused);

      // Kept: the token leaves the field, and the surface draws the service's word for it.
      if (refused === undefined) setPasted("");
    });
  };

  return (
    <PasteSteps
      first={{
        title: PASTE_WORDS.CREATE,
        body: (done) => (
          <OutsideLink href={GITHUB_TOKEN_CREATE_URL} open={openLink} onOpened={done}>
            {PASTE_WORDS.OPEN}
          </OutsideLink>
        ),
      }}
      fieldRef={field}
      label={PASTE_WORDS.LABEL}
      placeholder="ghp_…"
      busy={saving}
      busyWords={PASTE_WORDS.RUNNING}
      error={refusedShown(problem, FAILURE_SURFACE.GITHUB_TOKEN_SAVE)}
      value={pasted}
      onChange={(value) => {
        setPasted(value);
        setProblem(undefined);
      }}
      onSave={save}
    />
  );
}

/** The dialog the Profile row's Add opens: setup's token paste, closed once the token is kept. */
export function GitHubTokenDialog({
  open,
  onClose,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const save = useGitHubTokenSave();
  const field = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      title="Personal access token"
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      initialFocus={field}
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      <GitHubTokenPaste field={field} onSave={save} />
    </Dialog>
  );
}
