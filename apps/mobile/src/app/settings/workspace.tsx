// workspace.tsx -- Settings' Workspace page for the workspace the app works in: its name, renamed by an owner or admin; its members, whose roles the owner changes and whom an owner or admin removes; its invitations, sent and canceled by an owner or admin; and Leave.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { managesWorkspace, memberActs, WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import {
  INVITATION_ROLES,
  INVITATION_WORDS,
  LEAVE_WORDS,
  MEMBER_WORDS,
  WORKSPACE_READ_FAILED,
} from "@repo/features/workspace-settings-words";
import {
  ASSIGNABLE_ROLE,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AccountRow,
  ActionRow,
  ConfirmAsk,
  ListSection,
  MemberRow,
  type MemberRowAct,
  rejectionWords,
  Screen,
  SettingsForm,
  useAsyncAction,
  WORDS_ASK_KIND,
  WordsAsk,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The rename's alert: its title, its field's placeholder, and its act, the panel's words. */
const RENAME_WORDS = {
  ROW: "Rename",
  TITLE: "Rename workspace",
  PLACEHOLDER: "Workspace name",
} as const;

/** The page's questions, named once. */
const ASKING = {
  RENAME: "rename",
  INVITE: "invite",
  REMOVE: "remove",
  CANCEL: "cancel",
  LEAVE: "leave",
} as const;

/** What the page asks first, by the act it asks about. */
type Asking =
  | { readonly kind: typeof ASKING.RENAME }
  | { readonly kind: typeof ASKING.INVITE }
  | { readonly kind: typeof ASKING.REMOVE; readonly member: WorkspaceMember }
  | { readonly kind: typeof ASKING.CANCEL; readonly invitation: WorkspaceInvitation }
  | { readonly kind: typeof ASKING.LEAVE };

/** The members and invitations the host holds for one workspace, as a `select`; each none until read. */
function heldPeople(workspaceId: string) {
  return (state: AppStateSnapshot) => ({
    members: state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId],
    invitations: state[LIVE_READ.WORKSPACE_INVITATIONS][workspaceId],
  });
}

/** The line under an invited address: its role, and when its link stops working. */
function invitationLine(invitation: WorkspaceInvitation): string {
  const role = INVITATION_WORDS.INVITED_AS(WORKSPACE_ROLE_WORDS[invitation.role]);
  return `${role} · Expires ${dayAndTimeText(Date.parse(invitation.expiresAt))}`;
}

/** The leave's question: what goes, and what stays, as the panel names them. */
function leaveMessage(workspace: Workspace): string {
  return [
    LEAVE_WORDS.LINE,
    LEAVE_WORDS.TASKS(workspace.name),
    LEAVE_WORDS.AGENTS,
    LEAVE_WORDS.AUTOMATIONS,
    ...(workspace.role === WORKSPACE_ROLE.ADMIN ? [LEAVE_WORDS.INVITATIONS] : []),
  ].join(" ");
}

export default function WorkspaceScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);
  if (chosen === undefined) return null;
  return <WorkspacePage key={chosen.id} workspace={chosen} />;
}

function WorkspacePage({ workspace }: { readonly workspace: Workspace }) {
  const acts = useHostActs();
  const router = useRouter();
  const workspaceId = workspace.id;
  const manages = managesWorkspace(workspace);
  const personal = workspace.personal === true;
  const owner = workspace.role === WORKSPACE_ROLE.OWNER;
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const readerId = account === undefined ? undefined : signedInAccountId(account);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]({ workspaceId: id }));
  useLiveFollow(manages ? workspaceId : undefined, (id) =>
    acts[ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]({ workspaceId: id }),
  );
  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldPeople(workspaceId), [workspaceId]),
  });
  const members = held?.members?.rows?.members;
  const invitations = held?.invitations?.rows;
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const rename = useAsyncAction(rejectionWords);
  const people = useAsyncAction(rejectionWords);
  const invite = useAsyncAction(rejectionWords);
  const leave = useAsyncAction(rejectionWords);
  const dismiss = () => setAsking(undefined);
  const hasAdmin = members?.some((member) => member.role === WORKSPACE_ROLE.ADMIN) === true;

  const actsOn = (member: WorkspaceMember): readonly MemberRowAct[] => {
    const may = memberActs(workspace, member, member.userId === readerId);
    const role = (next: typeof ASSIGNABLE_ROLE.ADMIN | typeof ASSIGNABLE_ROLE.MEMBER) => () =>
      void people.run(() =>
        acts[ACT_KIND.WORKSPACE_MEMBER_ROLE]({
          workspaceId,
          userId: member.userId,
          role: next,
        }).then(() => undefined),
      );
    return [
      ...(may.promote
        ? [{ label: MEMBER_WORDS.MAKE_ADMIN, onPress: role(ASSIGNABLE_ROLE.ADMIN) }]
        : []),
      ...(may.demote
        ? [{ label: MEMBER_WORDS.MAKE_MEMBER, onPress: role(ASSIGNABLE_ROLE.MEMBER) }]
        : []),
      ...(may.remove
        ? [
            {
              label: MEMBER_WORDS.REMOVE,
              destructive: true,
              onPress: () => setAsking({ kind: ASKING.REMOVE, member }),
            },
          ]
        : []),
    ];
  };

  const sendInvite = (role: (typeof INVITATION_ROLES)[number]) => (email: string) => {
    dismiss();
    void invite.run(() =>
      acts[ACT_KIND.WORKSPACE_INVITE]({ workspaceId, email, role }).then(() => undefined),
    );
  };

  return (
    <>
      <Screen>
        <SettingsForm>
          <ListSection footer={rename.refusal}>
            <AccountRow name={workspace.name} email={WORKSPACE_ROLE_WORDS[workspace.role]} />
            {manages && !personal ? (
              <ActionRow
                label={RENAME_WORDS.ROW}
                onPress={() => setAsking({ kind: ASKING.RENAME })}
              />
            ) : null}
          </ListSection>
          <ListSection
            title="Members"
            count={members?.length}
            footer={held?.members?.failed === true ? WORKSPACE_READ_FAILED.MEMBERS : people.refusal}
          >
            {(members ?? []).map((member) => (
              <MemberRow
                key={member.userId}
                name={member.name}
                email={member.email}
                picture={member.pictureUrl}
                role={WORKSPACE_ROLE_WORDS[member.role]}
                badge={member.userId === readerId ? MEMBER_WORDS.YOU : undefined}
                acts={actsOn(member)}
              />
            ))}
          </ListSection>
          {manages ? (
            <ListSection
              title="Invitations"
              count={invitations?.length}
              footer={
                held?.invitations?.failed === true
                  ? WORKSPACE_READ_FAILED.INVITATIONS
                  : invite.refusal
              }
            >
              <ActionRow
                label={INVITATION_WORDS.INVITE}
                symbol="person.badge.plus"
                onPress={() => setAsking({ kind: ASKING.INVITE })}
              />
              {(invitations ?? []).map((invitation) => (
                <MemberRow
                  key={invitation.id}
                  name={invitation.email}
                  email={invitationLine(invitation)}
                  acts={[
                    {
                      label: INVITATION_WORDS.CANCEL,
                      destructive: true,
                      onPress: () => setAsking({ kind: ASKING.CANCEL, invitation }),
                    },
                  ]}
                />
              ))}
            </ListSection>
          ) : null}
          {personal ? null : owner ? (
            <ListSection footer={hasAdmin ? LEAVE_WORDS.OWNER : LEAVE_WORDS.OWNER_NO_ADMIN}>
              {null}
            </ListSection>
          ) : (
            <ListSection footer={leave.refusal ?? LEAVE_WORDS.LINE}>
              <ActionRow
                label={LEAVE_WORDS.VERB(workspace.name)}
                destructive
                onPress={() => setAsking({ kind: ASKING.LEAVE })}
              />
            </ListSection>
          )}
        </SettingsForm>
      </Screen>
      <WordsAsk
        title={RENAME_WORDS.TITLE}
        placeholder={RENAME_WORDS.PLACEHOLDER}
        initial={workspace.name}
        kind={WORDS_ASK_KIND.NAME}
        presented={asking?.kind === ASKING.RENAME}
        onDismiss={dismiss}
        acts={[
          {
            label: RENAME_WORDS.ROW,
            onAct: (name) => {
              dismiss();
              if (name === workspace.name) return;
              void rename.run(() =>
                acts[ACT_KIND.WORKSPACE_RENAME]({ workspaceId, name }).then(() => undefined),
              );
            },
          },
        ]}
      />
      <WordsAsk
        title={INVITATION_WORDS.INVITE_TITLE(workspace.name)}
        placeholder={INVITATION_WORDS.EMAIL_PLACEHOLDER}
        kind={WORDS_ASK_KIND.EMAIL}
        presented={asking?.kind === ASKING.INVITE}
        onDismiss={dismiss}
        // Note that only the owner invites an admin, so an admin's alert offers the member's invite alone.
        acts={
          owner
            ? INVITATION_ROLES.map((role) => ({
                label: INVITATION_WORDS.INVITE_AS(WORKSPACE_ROLE_WORDS[role]),
                onAct: sendInvite(role),
              }))
            : [{ label: INVITATION_WORDS.INVITE, onAct: sendInvite(INVITATION_ROLE.MEMBER) }]
        }
      />
      {/* Note that a removal and a cancel ask in the accent rather than red, as the panel's do, since inviting again undoes either. */}
      <ConfirmAsk
        title={
          asking?.kind === ASKING.REMOVE ? MEMBER_WORDS.REMOVE_QUESTION(asking.member.name) : ""
        }
        message={MEMBER_WORDS.REMOVE_BODY}
        act={MEMBER_WORDS.REMOVE_VERB}
        presented={asking?.kind === ASKING.REMOVE}
        onDismiss={dismiss}
        onAct={() => {
          if (asking?.kind !== ASKING.REMOVE) return;
          const { userId } = asking.member;
          dismiss();
          void people.run(() =>
            acts[ACT_KIND.WORKSPACE_MEMBER_REMOVE]({ workspaceId, userId }).then(() => undefined),
          );
        }}
      />
      <ConfirmAsk
        title={INVITATION_WORDS.CANCEL_QUESTION}
        message={
          asking?.kind === ASKING.CANCEL
            ? INVITATION_WORDS.CANCEL_BODY(asking.invitation.email)
            : undefined
        }
        act={INVITATION_WORDS.CANCEL}
        presented={asking?.kind === ASKING.CANCEL}
        onDismiss={dismiss}
        onAct={() => {
          if (asking?.kind !== ASKING.CANCEL) return;
          const invitationId = asking.invitation.id;
          dismiss();
          void invite.run(() =>
            acts[ACT_KIND.WORKSPACE_INVITATION_CANCEL]({ workspaceId, invitationId }).then(
              () => undefined,
            ),
          );
        }}
      />
      <ConfirmAsk
        title={LEAVE_WORDS.QUESTION(workspace.name)}
        message={leaveMessage(workspace)}
        act={LEAVE_WORDS.VERB(workspace.name)}
        destructive
        presented={asking?.kind === ASKING.LEAVE}
        onDismiss={dismiss}
        onAct={() => {
          dismiss();
          void leave
            .run(() => acts[ACT_KIND.WORKSPACE_LEAVE]({ workspaceId }).then(() => undefined))
            .then((left) => {
              if (left) router.back();
            });
        }}
      />
    </>
  );
}
