// invitation.tsx -- one pending invitation of the workspace the app works in, as Settings › Workspace's Invitations opens it: the address in the bar, the role it invites as and when its link stops working, Copy invite link, and Cancel invitation alone in red at the foot, asked first.

import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import { managesWorkspace, WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import { INVITATION_WORDS, WORKSPACE_READ_FAILED } from "@repo/features/workspace-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  BUZZ,
  buzz,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  ListSection,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { useWrite } from "../../use-write.js";
import { heldPeople, ROLE_LABEL, useBackWhenGone } from "../../workspace-people.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The page's rows, named once. */
const INVITATION_PAGE_WORDS = {
  EXPIRES: "Expires",
  /** The accept link copied, to send by hand where the service mails none. */
  COPY_LINK: "Copy invite link",
} as const;

/** The bar's title before the invitation is read: none, since its address comes with it. */
const NO_BAR_TITLE = "";

export default function InvitationScreen() {
  const { invitation = "" } = useLocalSearchParams<{ invitation: string }>();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  return <InvitationPage key={chosen.id} workspace={chosen} invitationId={invitation} />;
}

function InvitationPage({
  workspace,
  invitationId,
}: {
  readonly workspace: Workspace;
  readonly invitationId: string;
}) {
  const acts = useHostActs();
  const workspaceId = workspace.id;
  const manages = managesWorkspace(workspace);
  useLiveFollow(manages ? workspaceId : undefined, (id) =>
    acts[ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]({ workspaceId: id }),
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldPeople(workspaceId), [workspaceId]),
  });

  const invitations = held?.invitations?.rows;
  const invitation = invitations?.find((each) => each.id === invitationId);

  // Note that an invitation canceled or accepted, or a reader who no longer manages the workspace, has no page left, so it goes back to the list.
  const leave = useBackWhenGone(
    !manages || (invitations !== undefined && invitation === undefined),
  );

  const [asking, setAsking] = useState(false);
  // Note that a cancel refused says so in the shared notice, since its page may be gone by then.
  const write = useWrite();

  if (invitation === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: NO_BAR_TITLE }} />
        <Screen ground={SCREEN_GROUND.GROUPED}>
          {invitations !== undefined ? null : held?.invitations?.failed === true ? (
            <EmptyState
              title={WORKSPACE_READ_FAILED.INVITATIONS}
              symbol={GLYPH.FAILED}
              readFailed
            />
          ) : (
            <EmptyState title={readingWords("the invitations")} symbol={GLYPH.PERSON} loading />
          )}
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: invitation.email }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection>
            <ValueRow label={ROLE_LABEL} value={WORKSPACE_ROLE_WORDS[invitation.role]} />
            <ValueRow
              label={INVITATION_PAGE_WORDS.EXPIRES}
              value={dayAndTimeText(Date.parse(invitation.expiresAt))}
            />
          </ListSection>
          {/* Note that the service mails the accept link where the deployment names a sender, so Copy invite link sends it by hand, as the panel's row offers it. */}
          <ListSection>
            <ActionRow
              label={INVITATION_PAGE_WORDS.COPY_LINK}
              symbol={GLYPH.LINK}
              onPress={() =>
                void setStringAsync(invitation.acceptUrl)
                  .then(() => buzz(BUZZ.SUCCESS))
                  .catch((cause: unknown) =>
                    console.error("The invite link was not copied.", cause),
                  )
              }
            />
          </ListSection>
          <ListSection>
            <ActionRow
              label={INVITATION_WORDS.CANCEL}
              destructive
              centered
              onPress={() => setAsking(true)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
      {/* Note that a cancel asks in the accent rather than red, as the panel's does, since inviting the address again undoes it. */}
      <ConfirmAsk
        title={INVITATION_WORDS.CANCEL_QUESTION}
        message={INVITATION_WORDS.CANCEL_BODY(invitation.email)}
        act={INVITATION_WORDS.CANCEL}
        presented={asking}
        onDismiss={() => setAsking(false)}
        onAct={() => {
          setAsking(false);
          void write(() =>
            acts[ACT_KIND.WORKSPACE_INVITATION_CANCEL]({ workspaceId, invitationId }),
          ).then((went) => {
            if (went) leave();
          });
        }}
      />
    </>
  );
}
