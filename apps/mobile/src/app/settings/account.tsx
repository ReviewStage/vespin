// account.tsx -- Settings' Account page: who is signed in, the Privacy group (Share usage data and support access), Sign out, and Delete account last, asked first as the panel asks it.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { TASKS_READ } from "@repo/features/tasks-view";
import { IRREVERSIBLE_WORDS, VERB } from "@repo/features/words";
import { ACT_KIND, accountDeleteRefusalWords, accountDeleteWorkspacesWords } from "@repo/host/acts";
import {
  selectAccount,
  selectAppSettingsView,
  selectTaskListStatus,
  selectWorkspaces,
  supportAccessStanding,
} from "@repo/host/app-state-reads";
import {
  AccountRow,
  ActionRow,
  ConfirmAsk,
  ListSection,
  Screen,
  SettingsForm,
  ToggleRow,
  useAsyncAction,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { clearAccountNotifications } from "../../notifications.js";
import { unregisterPushDevice, useFixtureRun } from "../../push-device.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The act that ends the account, its row's words and the question's alike. */
const DELETE_ACCOUNT = "Delete account";

export default function AccountScreen() {
  const acts = useHostActs();
  const write = useWrite();
  const fixture = useFixtureRun();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { data: settings } = useQuery({ ...appStateQuery, select: selectAppSettingsView });
  const { data: workspaces } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: listStatus } = useQuery({ ...appStateQuery, select: selectTaskListStatus });
  const { data: support } = useQuery({
    ...appStateQuery,
    select: (state) => supportAccessStanding(state, Date.now()),
  });
  const signOut = useAsyncAction(() => undefined);
  const deletion = useAsyncAction(accountDeleteRefusalWords);
  const supportPress = useAsyncAction(() => undefined);
  const [asking, setAsking] = useState(false);
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return null;
  // Note that the phone is unregistered first, while the account's credential still stands, so no push of the account reaches a phone signed out of it; the unregister's own deadline bounds the wait.
  const signOutNow = () =>
    void signOut.run(() =>
      write(
        () =>
          unregisterPushDevice(acts, fixture)
            .then(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]())
            .then(() => clearAccountNotifications()),
        { retry: true },
      ).then(() => undefined),
    );
  // Note that support access goes through the write door too, so a refusal says why in the notice.
  const pressSupport = (grant: boolean) =>
    void supportPress.run(() =>
      write(() => acts[ACT_KIND.ACCOUNT_SUPPORT_ACCESS]({ grant }), { retry: true }).then(
        () => undefined,
      ),
    );
  // Note that the delete happens at the service before anything local moves, so a refusal says why under the row and the account, and this phone's pushes, still stand.
  const deleteNow = () =>
    void deletion.run(() =>
      acts[ACT_KIND.ACCOUNT_DELETE]().then(() => clearAccountNotifications()),
    );
  const goneWith = accountDeleteWorkspacesWords(workspaces, listStatus === TASKS_READ.READY);
  return (
    <>
      <Screen>
        <SettingsForm>
          <ListSection>
            <AccountRow
              name={account.name ?? account.email}
              email={account.email}
              picture={account.pictureUrl}
              detail={`Signed in with ${SOCIAL_PROVIDER_LABEL[account.provider]}`}
            />
          </ListSection>
          <ListSection title="Privacy" footer={support?.words}>
            {settings === undefined ? null : (
              <ToggleRow
                label="Share usage data"
                on={settings.usageData === true}
                onChange={(on) => {
                  write(() => acts[ACT_KIND.SETTING_UPDATE]({ field: "usageData", value: on }), {
                    retry: true,
                  });
                }}
              />
            )}
            {support?.granted === true ? (
              <ActionRow label="Revoke support access" onPress={() => pressSupport(false)} />
            ) : support?.grantable === true ? (
              <ActionRow
                label="Grant support access for 7 days"
                onPress={() => pressSupport(true)}
              />
            ) : null}
          </ListSection>
          <ListSection>
            <ActionRow label={VERB.SIGN_OUT} destructive onPress={signOutNow} />
          </ListSection>
          <ListSection footer={deletion.refusal}>
            <ActionRow label={DELETE_ACCOUNT} destructive onPress={() => setAsking(true)} />
          </ListSection>
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={`Delete the account ${account.email}?`}
        message={goneWith === undefined ? IRREVERSIBLE_WORDS : `${IRREVERSIBLE_WORDS} ${goneWith}`}
        act={DELETE_ACCOUNT}
        destructive
        gate={account.email}
        presented={asking}
        onAct={() => {
          setAsking(false);
          deleteNow();
        }}
        onDismiss={() => setAsking(false)}
      />
    </>
  );
}
