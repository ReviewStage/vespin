import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS, VERB } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND, accountDeleteRefusalWords, accountDeleteWorkspacesWords } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  FailureNote,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_LEAD,
  SettingsRow,
  SettingsSection,
  STATUS_TONE,
  useConfirmDialog,
  wholeWordsHint,
} from "@repo/ui";
import { accountActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { sendAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { githubTokenQuery, githubTokenRetryMutation } from "../live-reads.js";
import { showToast } from "../toast.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { GitHubTokenDialog, TokenFacts } from "./github-dialog.js";

/** The row's name. */
const TOKEN_LABEL = "GitHub personal access token";

/** What the row says where the token could not be read, so what stands is unknown. */
const TOKEN_READ_FAILED = "The token could not be read.";

/** What the toast says where signing out was refused, so the account is still signed in. */
const SIGN_OUT_FAILED = "The account could not be signed out. Try again.";

/**
 * Signs the account out and answers once that has settled, never by
 * rejecting: a refusal, such as a browser's whose service could not end the
 * session, is said in a toast, since the account is still signed in and the
 * press that asked is gone. Both of the app's Sign outs press through it.
 */
export async function signOutSayingFailure(onSignOut: () => Promise<void>): Promise<void> {
  try {
    await onSignOut();
  } catch (cause) {
    showToast({
      words: SIGN_OUT_FAILED,
      replayUnmasked: true,
      tone: STATUS_TONE.DANGER,
      failure: { surface: FAILURE_SURFACE.ACCOUNT_SIGN_OUT, cause },
    });
  }
}

/**
 * The member's own GitHub personal access token: its hint, login, and
 * expiry once one is saved, and Manage or Add, which
 * opens the token's dialog (`github-dialog.tsx`). The token is the one the
 * host holds for the account the row is drawn for (`LIVE_READ.GITHUB_TOKEN`),
 * where a save's and a removal's own answer lands too; a read that fails
 * says so under the row in a `FailureNote` whose Retry asks again, and draws
 * neither Add nor Manage, since what stands is unknown.
 */
function GitHubTokenRow({ accountId }: { accountId: string | undefined }): React.JSX.Element {
  const read = useQuery(githubTokenQuery(accountId));
  const retry = useMutation(githubTokenRetryMutation());
  const token = read.data?.token;
  const [managing, setManaging] = useState(false);

  // Note that the card is drawn for the token it opened over until its fade has run, so it does not change under its own exit.
  const { held: drawn, onExited } = useHeldThroughExit(
    managing && token !== undefined ? token : undefined,
  );

  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.GITHUB_ACCESS)}>
      <SettingsRow
        // Note that the row stands under the account's own, whose face is wider than a mark, so its words start where the account's do.
        lead={SETTINGS_ROW_LEAD.FACE}
        leading={
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.ROW} />
        }
        label={<OneLine hint={wholeWordsHint(TOKEN_LABEL)}>{TOKEN_LABEL}</OneLine>}
        description={
          // Note that the token's facts are masked, because Settings shows its own words and the hint ends the token.
          token ? (
            <ReplayMask>
              <TokenFacts token={token} />
            </ReplayMask>
          ) : undefined
        }
        // Note that a row with nothing below draws no `below` at all, since its box keeps a margin.
        below={
          read.isError
            ? () => (
                <FailureNote
                  failure={unreadShown(FAILURE_SURFACE.ACCOUNT_TOKEN_READ)}
                  onRetry={() => retry.mutate()}
                >
                  {TOKEN_READ_FAILED}
                </FailureNote>
              )
            : undefined
        }
      >
        {() =>
          token === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setManaging(true)}>
              {token === null ? "Add" : "Manage"}
            </Button>
          )
        }
      </SettingsRow>
      {drawn === undefined ? null : (
        <GitHubTokenDialog
          open={managing && token !== undefined}
          token={drawn}
          onClose={() => setManaging(false)}
          onExited={onExited}
        />
      )}
    </div>
  );
}

/**
 * The account's delete, as the question asking it holds its own mutation
 * over it. Note that the delete happens at the service before anything
 * local moves, so a failure answers why and the account still stands.
 */
const ACCOUNT_DELETE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.ACCOUNT_DELETE],
  mutationFn: (): Promise<ActionResult> =>
    sendAct(ACT_KIND.ACCOUNT_DELETE, undefined).then(
      () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      (cause: unknown) => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: accountDeleteRefusalWords(cause),
      }),
    ),
});

/**
 * Who is signed in, the member's own GitHub personal access token, and the
 * two ways out of being signed in, the Account page Settings opens on, and
 * the one place either way out is offered: the account's rows at its head,
 * its other groups (`children`) under them, and Delete account last, where
 * Linear, Notion, and Slack keep it. Sign out acts on
 * the press, since nothing is lost: the host asks first where a call or
 * unsaved words would go. Deleting asks first in the confirm dialog, since it
 * erases the account at the service for good, naming the workspaces that go
 * with it, and a refusal to delete is said in it.
 */
export function AccountSection({
  account,
  workspaces,
  workspacesRead = false,
  listFailed = false,
  onSignOut,
  children,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  /** The account's workspaces as the Workspace page lists them. */
  workspaces?: readonly Workspace[] | undefined;
  /** Whether the workspaces have been read. */
  workspacesRead?: boolean;
  /** Whether the read the workspaces arrive with failed, so the list may not be whole. */
  listFailed?: boolean;
  onSignOut: () => Promise<void>;
  /** The page's groups between the account's rows and Delete account. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const listKnown = workspacesRead && !listFailed;
  const goneWith = accountDeleteWorkspacesWords(workspaces, listKnown);
  const signOut = useAsyncAction(rejectionWords);
  // Note that the section is only drawn while its page is, so the page
  // leaving takes the question with it.
  const deleting = useMutation(ACCOUNT_DELETE_MUTATION);

  const deletionAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(),
    answered: sameAnswer,
  });

  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    deletionAct,
    confirmFailure(FAILURE_SURFACE.ACCOUNT_DELETE),
  );

  // Note that each row stands in a wrapper wearing its search anchor, because
  // a pressed result lands on and rings the whole row, as it did before the
  // row was shared, and the shared row takes no attribute of a caller's. The
  // section is untitled, as the Workspace page's first is, because the page
  // over it is already headed Account, and so is the last, which holds
  // Delete account alone.
  return (
    <>
      <SettingsSection>
        <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
          <SettingsRow
            lead={SETTINGS_ROW_LEAD.FACE}
            // The account's face as the sidebar's foot and every list draw it: its picture, else its letter on its hue.
            leading={
              <ReplayMask>
                <ActorMark actor={accountActor(account)} size={ACTOR_SIZE.CARD} />
              </ReplayMask>
            }
            label={
              <OneLine hint={wholeWordsHint(account.email)}>
                <ReplayMask>{account.email}</ReplayMask>
              </OneLine>
            }
            description={
              <span className="inline-flex flex-wrap items-center gap-ui-4 whitespace-nowrap">
                Signed in with
                <ProviderMark provider={account.provider} size={PROVIDER_MARK_SIZE.CAPTION} />
                {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
              </span>
            }
          >
            {() => (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={signOut.running}
                busyLabel="Signing out"
                disabled={deletion.busy}
                onClick={() => void signOut.run(() => signOutSayingFailure(onSignOut))}
              >
                {VERB.SIGN_OUT}
              </Button>
            )}
          </SettingsRow>
        </div>
        <GitHubTokenRow key={account.id} accountId={signedInAccountId(account)} />
      </SettingsSection>
      {children}
      <SettingsSection>
        <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.DELETE_ACCOUNT)}>
          <SettingsRow label="Delete account">
            {() => (
              <Button
                variant={BUTTON_VARIANT.DANGER_OUTLINE}
                busy={deletion.busy}
                busyLabel="Deleting the account"
                disabled={signOut.running}
                onClick={deletion.ask}
              >
                Delete
              </Button>
            )}
          </SettingsRow>
        </div>
        <ConfirmDialog
          open
          confirm={deletion}
          gate={account.email}
          question={{
            title: `Delete the account ${account.email}?`,
            body: goneWith === undefined ? IRREVERSIBLE_WORDS : `${IRREVERSIBLE_WORDS} ${goneWith}`,
            verb: "Delete account",
            running: "Deleting account",
            loss: CONFIRM_LOSS.IRREVERSIBLE,
            replayUnmasked: true,
            titleReplayMasked: true,
            // Note that the workspaces' names are a person's words, so the body is masked once it names any.
            bodyReplayMasked: listKnown && goneWith !== undefined,
          }}
        />
      </SettingsSection>
    </>
  );
}
