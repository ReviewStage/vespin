// workspace.tsx -- Settings' Workspace page for the workspace the app works in: its name, renamed by an owner or admin, and its photo, picked, changed, or removed by one; its members, each opening their own page (`member.tsx`); its invitations, sent by an owner or admin, each opening its own page (`invitation.tsx`); and Leave.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { ACT_UNREACHED_WORDS, readingWords } from "@repo/features/words";
import { INVITATION_ROLE } from "@repo/features/workspace-invitation-wire";
import { managesWorkspace, WORKSPACE_ROLE_WORDS } from "@repo/features/workspace-role";
import {
  INVITATION_ROLES,
  INVITATION_WORDS,
  LEAVE_WORDS,
  MEMBER_WORDS,
  PHOTO_WORDS,
  TRANSFER_WORDS,
  transferQuestionTitle,
  WORKSPACE_READ_FAILED,
} from "@repo/features/workspace-settings-words";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  askForName,
  askForWords,
  ConfirmAsk,
  FOOTER_TONE,
  footerToneOf,
  GLYPH,
  ListSection,
  LoadingRow,
  MemberRow,
  MenuRow,
  PUSH_ROW_GOES,
  PushRow,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  useAsyncAction,
  WORDS_KIND,
  WorkspaceRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useChosenWorkspace } from "../../../chosen-workspace.js";
import { GitHubSection } from "../../../github/github-connection.js";
import { appStateQuery } from "../../../host/app-state-query.js";
import { useHostActs } from "../../../host/host-provider.js";
import { useLiveFollow } from "../../../host/live-follow.js";
import { SETTINGS_ROUTE } from "../../../settings-button.js";
import { refusalOf, useLatestWrites, useWrite } from "../../../use-write.js";
import { heldPeople } from "../../../workspace-people.js";
import { pickWorkspacePhoto } from "../../../workspace-photo.js";
import { selectPhotos, switcherWorkspace } from "../../../workspace-switcher.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** The rename's alert: its title and its act, the panel's words. */
const RENAME_WORDS = {
  ROW: "Rename",
  TITLE: "Rename workspace",
} as const;

/** The page's questions, named once. */
const ASKING = {
  LEAVE: "leave",
  TRANSFER: "transfer",
  PHOTO_REMOVE: "photo-remove",
} as const;

/** What the page asks first, by the act it asks about. */
type Asking =
  | { readonly kind: typeof ASKING.LEAVE }
  | { readonly kind: typeof ASKING.TRANSFER; readonly member: WorkspaceMember }
  | { readonly kind: typeof ASKING.PHOTO_REMOVE };

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
  const { data: photos } = useQuery({ ...appStateQuery, select: selectPhotos });
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
  // Note that each refusal says why in place, in the host's words through the one write door, never an error's own text.
  const write = useWrite();
  const rename = useAsyncAction(() => ACT_UNREACHED_WORDS);
  // Note that each invitation sent goes at once and says a refusal by its own address, since the host draws them as they go and one must not wait on, or hide, another's.
  const invite = useLatestWrites(() => ACT_UNREACHED_WORDS);
  const leave = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const transfer = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const photo = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const hasPhoto = workspace.photoVersion !== undefined && workspace.photoVersion !== null;

  /** Sets the workspace's photo, or removes it for none, saying a refusal under its row. */
  const setPhoto = (next: string | null) =>
    void photo.run(() =>
      refusalOf(write, () => acts[ACT_KIND.WORKSPACE_PHOTO_SET]({ workspaceId, photo: next })),
    );

  /** A photo picked and set, or why the pick cannot be one, said under its row. */
  const pickPhoto = () =>
    void photo.run(() =>
      pickWorkspacePhoto().then((picked) => {
        if ("canceled" in picked) return undefined;

        if ("refusal" in picked) return picked.refusal;

        return refusalOf(write, () =>
          acts[ACT_KIND.WORKSPACE_PHOTO_SET]({ workspaceId, photo: picked.photo }),
        );
      }),
    );

  const dismiss = () => setAsking(undefined);
  // Note that Transfer ownership offers the first admin, as the panel's chooser stands on; another is made owner from their own row.
  const heir = members?.find((member) => member.role === WORKSPACE_ROLE.ADMIN);
  // Note that an owner with no admin to hand the workspace to has nothing to press here, so why they can't leave is said under Members.
  const ownerAlone = owner && !personal && members !== undefined && heir === undefined;

  const openMember = (member: WorkspaceMember) =>
    router.push({ pathname: SETTINGS_ROUTE.MEMBER, params: { userId: member.userId } });

  const sendInvite = (role: (typeof INVITATION_ROLES)[number]) => (email: string) => {
    dismiss();
    void invite.run(email, undefined, () =>
      refusalOf(write, () => acts[ACT_KIND.WORKSPACE_INVITE]({ workspaceId, email, role })),
    );
  };

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ListSection
            footer={
              [rename.refusal, photo.refusal]
                .filter((refusal) => refusal !== undefined)
                .join(" ") || undefined
            }
            footerTone={FOOTER_TONE.FAILURE}
          >
            <WorkspaceRow
              workspace={switcherWorkspace(workspace, false, photos)}
              role={WORKSPACE_ROLE_WORDS[workspace.role]}
            />
            {manages && !personal ? (
              <ActionRow
                label={RENAME_WORDS.ROW}
                symbol={GLYPH.RENAME}
                onPress={() =>
                  askForName({
                    title: RENAME_WORDS.TITLE,
                    act: RENAME_WORDS.ROW,
                    name: workspace.name,
                    onName: (name) =>
                      void rename.run(() =>
                        refusalOf(write, () =>
                          acts[ACT_KIND.WORKSPACE_RENAME]({ workspaceId, name }),
                        ),
                      ),
                  })
                }
              />
            ) : null}
            {manages && !hasPhoto ? (
              <ActionRow
                label={PHOTO_WORDS.ADD}
                symbol={GLYPH.IMAGE}
                disabled={photo.running}
                onPress={pickPhoto}
              />
            ) : null}
            {manages && hasPhoto ? (
              // Note that a photo's Replace and Delete stand in one menu, as the panel's Change photo offers them, so no red row sits among the head's; the menu waits while a pick or delete is out, since a second act would be dropped unseen.
              <MenuRow
                label={PHOTO_WORDS.CHANGE}
                symbol={GLYPH.IMAGE}
                acts={
                  photo.running
                    ? []
                    : [
                        { label: PHOTO_WORDS.REPLACE, onPress: pickPhoto },
                        {
                          label: PHOTO_WORDS.DELETE,
                          destructive: true,
                          onPress: () => setAsking({ kind: ASKING.PHOTO_REMOVE }),
                        },
                      ]
                }
              />
            ) : null}
          </ListSection>
          {/* Note that GitHub is the managers', as the panel's Settings › Workspace offers it to an owner or an admin alone. */}
          {manages ? <GitHubSection workspaceId={workspaceId} opensPage /> : null}
          <ListSection
            title="Members"
            count={members?.length}
            footer={
              held?.members?.failed === true
                ? WORKSPACE_READ_FAILED.MEMBERS
                : ownerAlone
                  ? LEAVE_WORDS.OWNER_NO_ADMIN
                  : undefined
            }
            footerTone={held?.members?.failed === true ? FOOTER_TONE.FAILURE : FOOTER_TONE.NOTE}
          >
            {members === undefined && held?.members?.failed !== true ? (
              <LoadingRow words={readingWords("the members")} />
            ) : null}
            {(members ?? []).map((member) => (
              // Note that the reader's own row says You where another's says their address, as iOS Settings marks the reader's own card, rather than a badge joined to the name.
              <MemberRow
                key={member.userId}
                name={member.name}
                line={member.userId === readerId ? MEMBER_WORDS.YOU : member.email}
                picture={member.pictureUrl}
                role={WORKSPACE_ROLE_WORDS[member.role]}
                onOpen={() => openMember(member)}
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
                  : invite.said.join(" ") || undefined
              }
              footerTone={FOOTER_TONE.FAILURE}
            >
              <ActionRow
                label={INVITATION_WORDS.INVITE}
                symbol={GLYPH.ADD}
                onPress={() =>
                  askForWords({
                    title: INVITATION_WORDS.INVITE_TITLE(workspace.name),
                    kind: WORDS_KIND.EMAIL,
                    // Note that only the owner invites an admin, so an admin's alert offers the member's invite alone.
                    acts: owner
                      ? INVITATION_ROLES.map((role) => ({
                          label: INVITATION_WORDS.INVITE_AS(WORKSPACE_ROLE_WORDS[role]),
                          onWords: sendInvite(role),
                        }))
                      : [
                          {
                            label: INVITATION_WORDS.INVITE,
                            onWords: sendInvite(INVITATION_ROLE.MEMBER),
                          },
                        ],
                  })
                }
              />
              {invitations === undefined && held?.invitations?.failed !== true ? (
                <LoadingRow words={readingWords("the invitations")} />
              ) : null}
              {(invitations ?? []).map((invitation) => (
                <PushRow
                  key={invitation.id}
                  label={invitation.email}
                  goes={PUSH_ROW_GOES.PAGE}
                  onPress={() =>
                    router.push({
                      pathname: SETTINGS_ROUTE.INVITATION,
                      params: { invitation: invitation.id },
                    })
                  }
                />
              ))}
            </ListSection>
          ) : null}
          {owner && !personal && heir !== undefined ? (
            <ListSection
              footer={transfer.refusal ?? LEAVE_WORDS.OWNER}
              footerTone={footerToneOf(transfer.refusal)}
            >
              <ActionRow
                label={TRANSFER_WORDS.VERB}
                onPress={() => setAsking({ kind: ASKING.TRANSFER, member: heir })}
              />
            </ListSection>
          ) : null}
          {personal || owner ? null : (
            <ListSection
              footer={leave.refusal ?? LEAVE_WORDS.LINE}
              footerTone={footerToneOf(leave.refusal)}
            >
              <ActionRow
                label={LEAVE_WORDS.VERB(workspace.name)}
                destructive
                centered
                onPress={() => setAsking({ kind: ASKING.LEAVE })}
              />
            </ListSection>
          )}
        </SettingsForm>
      </Screen>
      {/* Note that a handover asks in the accent rather than red, as the panel's does, and waits on the workspace's name typed, since only the new owner can give it back. */}
      <ConfirmAsk
        title={transferQuestionTitle(
          workspace.name,
          asking?.kind === ASKING.TRANSFER ? asking.member.name : undefined,
        )}
        message={TRANSFER_WORDS.BODY}
        act={TRANSFER_WORDS.VERB}
        gate={workspace.name}
        presented={asking?.kind === ASKING.TRANSFER}
        onDismiss={dismiss}
        onAct={() => {
          if (asking?.kind !== ASKING.TRANSFER) return;
          const { userId } = asking.member;
          dismiss();
          void transfer.run(() =>
            refusalOf(write, () => acts[ACT_KIND.WORKSPACE_TRANSFER]({ workspaceId, userId })),
          );
        }}
      />
      {/* Note that deleting the photo asks in red, as the panel's irreversible acts do, since the photo itself is gone. */}
      <ConfirmAsk
        title={PHOTO_WORDS.DELETE_QUESTION(workspace.name)}
        message={PHOTO_WORDS.DELETE_BODY}
        act={PHOTO_WORDS.DELETE}
        destructive
        presented={asking?.kind === ASKING.PHOTO_REMOVE}
        onDismiss={dismiss}
        onAct={() => {
          dismiss();
          setPhoto(null);
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
            .run(() => refusalOf(write, () => acts[ACT_KIND.WORKSPACE_LEAVE]({ workspaceId })))
            .then((left) => {
              if (left) router.back();
            });
        }}
      />
    </>
  );
}
