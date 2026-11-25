// usage-data-switch.tsx -- this device's "Share usage data" switch, as Settings › Account and setup's first step both stand it: one row writing the one setting (`APP_SETTING_SCHEMA.usageData`), and why a turn did not land.

import { ACT_UNREACHED_WORDS, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectAppSettingsView } from "@repo/host/app-state-reads";
import { APP_SETTING_SCHEMA } from "@repo/settings";
import { LoadingRow, ToggleRow, useAsyncAction } from "@repo/ui-native";
import { actionRefused } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";
import { useWrite } from "./use-write.js";

/** The switch's name, Settings' and setup's alike. */
const USAGE_DATA_LABEL = "Share usage data";

type Said = { words?: string };

/** The switch as a row of its screen's group, and why its last turn did not land, which the group says under it. */
export interface UsageDataSwitch {
  readonly row: ReactNode;
  readonly refusal: string | undefined;
}

/**
 * The "Share usage data" row: a spinner while the settings are read, then
 * the system's switch. Note that a refusal says why under the group, in the
 * host's words, and puts the switch back, since the system's switch keeps
 * the turn a person made; flipping it again is the retry, so no Try again
 * could replay an older choice.
 */
export function useUsageDataSwitch(): UsageDataSwitch {
  const acts = useHostActs();
  const write = useWrite();
  const { data: settings } = useQuery({ ...appStateQuery, select: selectAppSettingsView });
  const usage = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const [round, setRound] = useState(0);

  const turn = (on: boolean) =>
    void usage
      .run(() => {
        const said: Said = {};

        return write(
          () =>
            acts[ACT_KIND.SETTING_UPDATE]({ field: APP_SETTING_SCHEMA.usageData.field, value: on }),
          {
            // Note that a refusal comes back in the answer rather than thrown, so it is read from it.
            refused: actionRefused,
            inPlace: (words) => {
              said.words = words;
            },
          },
        ).then(() => said.words);
      })
      .then((landed) => {
        if (!landed) setRound((last) => last + 1);
      });

  const row =
    settings === undefined ? (
      <LoadingRow words={readingWords("your settings")} />
    ) : (
      <ToggleRow
        key={round}
        label={USAGE_DATA_LABEL}
        on={settings.usageData === true}
        onChange={turn}
      />
    );

  return { row, refusal: usage.refusal };
}
