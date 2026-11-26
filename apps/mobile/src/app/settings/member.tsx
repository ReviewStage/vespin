// member.tsx -- one member of the workspace the app works in, as Settings › Workspace's Members opens them: their photo, name and address at the head, their role, picked where the reader may change it, Make owner where the owner may hand the workspace to them, and Remove from workspace alone in red at the foot, each asked first where today's menu asked.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { ACT_UNREACHED_WORDS, readingWords } from "@repo/features/words";
import { memberActs, WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import {
  MEMBER_WORDS,
  TRANSFER_WORDS,
  transferQuestionTitle,
  WORKSPACE_READ_FAILED,
} from "@repo/features/workspace-settings-words";
import { ASSIGNABLE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AccountHead,
  ActionRow,
  ConfirmAsk,
  EmptyState,
  footerToneOf,
  GLYPH,
  ListSection,
  MenuPickRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  useAsyncAction,
  ValueRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { refusalOf, useWrite } from "../../use-write.js";
import { heldPeople, ROLE_LABEL, useBackWhenGone } from "../../workspace-people.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The bar's title: none, since the member's name heads the page under it, as Apple Account's page stands. */
const NO_BAR_TITLE = "";

/** The roles a member may be given, in the order the picker lists them, as an invitation offers them. */
const PICKED_ROLES = [ASSIGNABLE_ROLE.MEMBER, ASSIGNABLE_ROLE.ADMIN] as const;

/** The page's questions, named once. */
const ASKING = {
  TRANSFER: "transfer",
  REMOVE: "remove",
} as const;

type Asking = (typeof ASKING)[keyof typeof ASKING];

export default function MemberScreen() {
  const { userId = "" } = useLocalSearchParams<{ userId: string }>();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  return <MemberPage key={chosen.id} workspace={chosen} userId={userId} />;
}

function MemberPage({
  workspace,
  userId,
}: {
  readonly workspace: Workspace;
  readonly userId: string;
}) {
  const acts = useHostActs();
  const workspaceId = workspace.id;
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const readerId = account === undefined ? undefined : signedInAccountId(account);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldPeople(workspaceId), [workspaceId]),
  });

  const members = held?.members?.rows?.members;
  const member = members?.find((each) => each.userId === userId);
  // Note that a member removed, here or elsewhere, has no page left, so it goes back to the list.
  const leave = useBackWhenGone(members !== undefined && member === undefined);
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  // Note that a role change and a handover say a refusal under their own rows, while a removal says one in the shared notice, since its page may be gone by then.
  const write = useWrite();
  const role = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const transfer = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const dismiss = () => setAsking(undefined);

  if (member === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: NO_BAR_TITLE }} />
        <Screen ground={SCREEN_GROUND.GROUPED}>
          {members !== undefined ? null : held?.members?.failed === true ? (
            <EmptyState title={WORKSPACE_READ_FAILED.MEMBERS} symbol={GLYPH.FAILED} readFailed />
          ) : (
            <EmptyState title={readingWords("the members")} symbol={GLYPH.PERSON} loading />
          )}
        </Screen>
      </>
    );
  }

  const may = memberActs(workspace, member, member.userId === readerId);

  const pickRole = (id: string) => {
    const next = PICKED_ROLES.find((each) => each === id);

    if (next === undefined || next === member.role) return;

    void role.run(() =>
      refusalOf(write, () =>
        acts[ACT_KIND.WORKSPACE_MEMBER_ROLE]({ workspaceId, userId, role: next }),
      ),
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: NO_BAR_TITLE }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection>
            <AccountHead name={member.name} email={member.email} picture={member.pictureUrl} />
          </ListSection>
          <ListSection footer={role.refusal} footerTone={footerToneOf(role.refusal)}>
            {may.promote || may.demote ? (
              <MenuPickRow
                label={ROLE_LABEL}
                options={PICKED_ROLES.map((each) => ({
                  id: each,
                  label: WORKSPACE_ROLE_WORDS[each],
                }))}
                picked={member.role}
                onPick={pickRole}
              />
            ) : (
              <ValueRow label={ROLE_LABEL} value={WORKSPACE_ROLE_WORDS[member.role]} />
            )}
          </ListSection>
          {may.transfer ? (
            <ListSection footer={transfer.refusal} footerTone={footerToneOf(transfer.refusal)}>
              <ActionRow
                label={MEMBER_WORDS.MAKE_OWNER}
                disabled={transfer.running}
                onPress={() => setAsking(ASKING.TRANSFER)}
              />
            </ListSection>
          ) : null}
          {may.remove ? (
            <ListSection>
              <ActionRow
                label={MEMBER_WORDS.REMOVE}
                destructive
                centered
                onPress={() => setAsking(ASKING.REMOVE)}
              />
            </ListSection>
          ) : null}
        </SettingsForm>
      </Screen>
      {/* Note that a handover asks in the accent rather than red, as the panel's does, and waits on the workspace's name typed, since only the new owner can give it back. */}
      <ConfirmAsk
        title={transferQuestionTitle(workspace.name, member.name)}
        message={TRANSFER_WORDS.BODY}
        act={TRANSFER_WORDS.VERB}
        gate={workspace.name}
        presented={asking === ASKING.TRANSFER}
        onDismiss={dismiss}
        onAct={() => {
          dismiss();
          void transfer.run(() =>
            refusalOf(write, () => acts[ACT_KIND.WORKSPACE_TRANSFER]({ workspaceId, userId })),
          );
        }}
      />
      {/* Note that a removal asks in the accent rather than red, as the panel's does, since inviting again undoes it. */}
      <ConfirmAsk
        title={MEMBER_WORDS.REMOVE_QUESTION(member.name)}
        message={MEMBER_WORDS.REMOVE_BODY}
        act={MEMBER_WORDS.REMOVE_VERB}
        presented={asking === ASKING.REMOVE}
        onDismiss={dismiss}
        onAct={() => {
          dismiss();
          void write(() => acts[ACT_KIND.WORKSPACE_MEMBER_REMOVE]({ workspaceId, userId })).then(
            (went) => {
              if (went) leave();
            },
          );
        }}
      />
    </>
  );
}
