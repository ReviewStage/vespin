// machines.tsx -- Settings' Machines page: the account's machines, each by its name, where it stands, and what it is, and Remove, asked first, as the panel's Machines page offers it; a machine is added from the machine itself, so the phone offers no Add.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import type { HostLine } from "@repo/features/host-live";
import { HOST_UNINSTALL_COMMAND } from "@repo/features/host-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { type ListedMachine, machineName } from "@repo/features/machine-name";
import {
  hostStanding,
  MACHINE_STANDING_WORDS,
  MACHINES_WORDS,
  removeMachineQuestion,
} from "@repo/features/machines-settings-words";
import { readFailedWords, readingWords, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  ConfirmAsk,
  EmptyState,
  ListSection,
  NoteRow,
  Screen,
  SettingsForm,
  type SfSymbol,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** What the page says while it reads the machines, and where the read failed, as the panel names them. */
const READ_WORDS = {
  READING: readingWords("your machines"),
  FAILED: readFailedWords("your machines"),
} as const;

/** The glyph a machine's row leads with, by its platform, as SF Symbols draws a Mac and a server. */
const PLATFORM_SYMBOL = {
  [DEVICE_PLATFORM.DARWIN]: "laptopcomputer",
  [DEVICE_PLATFORM.LINUX]: "server.rack",
} as const satisfies Record<DevicePlatform, SfSymbol>;

/** A machine Remove was asked of: the host, what it is called, and whether it reads offline, which hears it only once it is online again. */
interface RemoveAsked {
  readonly host: HostLine;
  readonly label: string;
  readonly offline: boolean;
}

/** The account's machines the host holds, as a `select`; none until read. */
function heldHosts(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.HOSTS][accountId];
}

/** A host as the list of machines names it. */
function machineOf(host: HostLine): ListedMachine {
  return { deviceId: host.id, name: host.name, machineId: host.machineId, model: host.model };
}

/** A machine's platform; a Linux server where the service named none, as one older than platforms listed only those. */
function platformOf(host: HostLine): DevicePlatform {
  return host.platform ?? DEVICE_PLATFORM.LINUX;
}

/** The line under a machine's name: where it stands, then what it is, as the panel's line reads. */
function machineLine(host: HostLine, now: number): string {
  const standing = MACHINE_STANDING_WORDS[hostStanding(host, now)];

  return `${standing} · ${DEVICE_PLATFORM_NAME[platformOf(host)]}`;
}

/** What Remove asks, and for a machine that reads offline the command that removes it by hand. */
function removeMessage(asked: RemoveAsked | undefined): string {
  const { body } = removeMachineQuestion(asked?.label ?? "");

  return asked?.offline === true
    ? `${body}\n\n${MACHINES_WORDS.REMOVED_OFFLINE}\n\n${HOST_UNINSTALL_COMMAND}`
    : body;
}

export default function MachinesScreen() {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  if (accountId === undefined) return null;

  return <MachinesPage key={accountId} accountId={accountId} />;
}

function MachinesPage({ accountId }: { readonly accountId: string }) {
  const acts = useHostActs();
  const write = useWrite();
  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);
  useLiveFollow(accountId, () => acts[ACT_KIND.HOSTS_FOLLOW]());

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useCallback(heldHosts(accountId), [accountId]),
  });

  const hosts = held?.rows?.hosts;
  const listed = (hosts ?? []).map(machineOf);
  const now = Date.now();
  const question = removeMachineQuestion(asked?.label ?? "");

  const body =
    hosts === undefined ? (
      held?.failed === true ? (
        <EmptyState
          title={READ_WORDS.FAILED}
          symbol="exclamationmark.triangle"
          action={{
            label: VERB.RETRY,
            onPress: () =>
              void acts[ACT_KIND.HOSTS_RETRY]().catch((cause: unknown) =>
                console.error("Reading the machines again did not go.", cause),
              ),
          }}
        />
      ) : (
        <EmptyState title={READ_WORDS.READING} symbol="desktopcomputer" loading />
      )
    ) : hosts.length === 0 ? (
      <EmptyState title={MACHINES_WORDS.NONE} symbol="desktopcomputer" />
    ) : (
      <SettingsForm>
        <ListSection title={MACHINES_WORDS.TITLE} count={hosts.length}>
          {[...hosts]
            .sort((one, other) => one.name.localeCompare(other.name))
            .map((host) => {
              const label = machineName(machineOf(host), listed, undefined);

              return (
                <NoteRow
                  key={host.id}
                  symbol={PLATFORM_SYMBOL[platformOf(host)]}
                  words={label}
                  line={machineLine(host, now)}
                  remove={{
                    label: MACHINES_WORDS.REMOVE,
                    onPress: () =>
                      setAsked({
                        host,
                        label,
                        offline:
                          host.away === true || hostStanding(host, now) === DEVICE_STANDING.OFFLINE,
                      }),
                  }}
                />
              );
            })}
        </ListSection>
      </SettingsForm>
    );

  return (
    <>
      <Screen>{body}</Screen>
      <ConfirmAsk
        title={question.title}
        message={removeMessage(asked)}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const { id } = asked.host;
          setAsked(undefined);
          void write(() => acts[ACT_KIND.HOSTS_REMOVE]({ id }), {
            refused: (answer) => ("failure" in answer ? MACHINES_WORDS.REMOVE_FAILED : undefined),
          });
        }}
      />
    </>
  );
}
