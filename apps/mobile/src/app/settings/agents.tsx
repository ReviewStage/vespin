// agents.tsx -- Settings' Agents page: the model, effort, and speed a new agent starts on, and the rest of how agents work for the account (default permissions, follow-up behavior, commit author), drawn from the panel's own settings rows.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  choiceOn,
  effortFor,
  effortsOf,
  FAST_WORD,
  modelIdAtSpeed,
  SPEED_LABEL,
  SPEED_WORD,
  speedsOffered,
} from "@repo/features/model-effort";
import {
  type CatalogModel,
  MODEL_SPEED,
  type ModelChoice,
  type ModelSpeed,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectAccount,
  selectAgentDefault,
  selectAppSettingsView,
} from "@repo/host/app-state-reads";
import {
  type AppSettingField,
  SETTING_SECTION,
  SETTINGS_PAGE,
  type SettingSection,
  type SettingsPage,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@repo/settings";
import {
  ListSection,
  MenuPickRow,
  rejectionWords,
  Screen,
  SettingsForm,
  ToggleRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { effortOptions, modelOptions, useModelCatalog } from "../../tasks/use-start.js";
import { useLatestWrites } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** No models read yet. */
const NO_MODELS: readonly CatalogModel[] = [];

/** What the default's own rows are headed and named by, the panel's words. */
const DEFAULT_WORDS = {
  SECTION: "New agents",
  MODEL: "Model",
  EFFORT: "Effort",
} as const;

/**
 * The settings groups the page draws, each a page and section of the
 * panel's: the new agents' own (default permissions), which joins the
 * default model's rows in one group as the panel's New agents section holds
 * them, then the Agents group of Preferences (follow-up behavior and the
 * commit author), each row a group of its own under the words that explain
 * it, as the schema orders their rows.
 */
const SCHEMA_GROUP = {
  NEW_AGENTS: { page: SETTINGS_PAGE.AGENTS, section: SETTING_SECTION.NEW_AGENTS },
  PREFERENCES: { page: SETTINGS_PAGE.PREFERENCES, section: SETTING_SECTION.AGENTS },
} as const satisfies Record<string, { page: SettingsPage; section: SettingSection }>;

/** One stored setting's row as the schema draws it on a page. */
type SchemaRow = ReturnType<typeof settingRowsForPage>[number];

/** What the platform offers, which a platform feature's row stands on. */
const selectCapabilities = (state: AppStateSnapshot) => state.run.capabilities;

/**
 * The choice a move to another catalog id sends: the effort the default
 * runs where the model lists it, else the nearest it lists, and the window
 * the default runs on where the model offers two (`choiceOn`), as the
 * panel's Agents page carries them; none where the model lists no effort.
 */
function choiceAt(
  catalog: readonly CatalogModel[],
  model: string,
  current: ModelChoice,
): ModelChoice | undefined {
  const effort = effortFor(effortsOf(catalog, model), current.effort);

  return effort === undefined
    ? undefined
    : choiceOn(catalog, { model, effort }, current.contextWindow);
}

/** The choice a pick of a model sends: the model at the speed the default runs where the catalog offers it, else its standard version. */
function modelPicked(
  catalog: readonly CatalogModel[],
  standardId: string,
  current: ModelChoice,
): ModelChoice | undefined {
  const speed = modelSpeedOf(current.model);
  const kept = speedsOffered(catalog, standardId).includes(speed) ? speed : MODEL_SPEED.STANDARD;

  return choiceAt(catalog, modelIdAtSpeed(standardId, kept), current);
}

export default function AgentsScreen() {
  const acts = useHostActs();
  const catalog = useModelCatalog()?.models ?? NO_MODELS;
  const { data: current } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const { data: settings } = useQuery({ ...appStateQuery, select: selectAppSettingsView });
  const { data: capabilities = [] } = useQuery({ ...appStateQuery, select: selectCapabilities });
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  // Note that each pick goes at once, even while an earlier one is out, such as an effort right after a model, since the host draws the default and a setting as they are sent.
  const write = useLatestWrites(rejectionWords);
  const setting = useLatestWrites(rejectionWords);
  // Note that SwiftUI's pickers and switch keep the pick a person made, so a write that was refused redraws its section, which reads the stored choice again.
  const [defaultRound, setDefaultRound] = useState(0);
  const [settingRound, setSettingRound] = useState(0);
  // Note that the newest choice sent stands until it is answered, so a pick made before the host's draw of an earlier one reaches the screen, such as an effort right after a model, builds on it rather than on the default drawn.
  const pending = useRef<ModelChoice | undefined>(undefined);
  const latest = (): ModelChoice | undefined => pending.current ?? current;
  // Note that each setting's newest pick sent stands the same way, so a pick back to the drawn value before the first is drawn still goes.
  const pendingSettings = useRef(new Map<AppSettingField, string>());
  const standard = current === undefined ? undefined : standardModelIdOf(current.model);
  const speeds = standard === undefined ? [] : speedsOffered(catalog, standard);
  const speed = current === undefined ? MODEL_SPEED.STANDARD : modelSpeedOf(current.model);

  const view: SettingsRowsInput | undefined =
    settings === undefined
      ? undefined
      : {
          settings,
          accountDrawn: account !== undefined && signedInAccountId(account) !== undefined,
          capabilities,
        };

  const choose = (choice: ModelChoice | undefined) => {
    if (choice === undefined) {
      setDefaultRound((round) => round + 1);

      return;
    }

    // Note that the model, effort and speed write the one default, so they follow each other as one row's writes.
    pending.current = choice;
    void write
      .run(ACT_KIND.AGENTS_DEFAULT_WRITE, () =>
        acts[ACT_KIND.AGENTS_DEFAULT_WRITE](choice).then(() => undefined),
      )
      .then((landed) => {
        // Note that an answered choice hands back to the drawn default, which holds it once it landed and the stored one once it was refused.
        if (pending.current === choice) pending.current = undefined;

        if (!landed) setDefaultRound((round) => round + 1);
      });
  };

  const atSpeed = (next: ModelSpeed) => {
    const now = latest();

    // Note that the speed is compared with the newest choice sent, not the one drawn, so a second speed picked before the first is drawn still goes.
    if (now === undefined || modelSpeedOf(now.model) === next) return;
    choose(choiceAt(catalog, modelIdAtSpeed(standardModelIdOf(now.model), next), now));
  };

  const store = (field: AppSettingField, token: string) => {
    if (view === undefined) return;
    const value = settingFromOption(field, token, view);
    pendingSettings.current.set(field, token);
    void setting
      .run(field, () => acts[ACT_KIND.SETTING_UPDATE]({ field, value }).then(() => undefined))
      .then((landed) => {
        if (pendingSettings.current.get(field) === token) pendingSettings.current.delete(field);

        if (!landed) setSettingRound((round) => round + 1);
      });
  };

  // Note that a schema row with no control on this platform is left out, so its group never stands empty.
  const rowsOf = (group: (typeof SCHEMA_GROUP)[keyof typeof SCHEMA_GROUP]): readonly SchemaRow[] =>
    view === undefined
      ? []
      : settingRowsForPage(group.page, group.section, view).filter(
          (row) => row.control !== undefined,
        );

  const newAgentRows = rowsOf(SCHEMA_GROUP.NEW_AGENTS);
  const preferenceRows = rowsOf(SCHEMA_GROUP.PREFERENCES);

  // The refusals said for a group's settings, each by its own field, under the group that holds its row.
  const refusalOf = (rows: readonly SchemaRow[], also: readonly string[] = []) =>
    [...also, ...rows.flatMap((row) => setting.refusals.get(row.field) ?? [])].join(" ") ||
    undefined;

  const pickRow = ({ field, entry, control }: SchemaRow) =>
    control === undefined ? null : (
      // Note that SwiftUI's picker keeps the pick a person made, so a refused write draws the row anew under the next round, reading the stored choice again.
      <Fragment key={entry.id}>
        <MenuPickRow
          key={settingRound}
          label={entry.label}
          options={control.options.map((option) => ({ id: option.value, label: option.label }))}
          picked={control.value}
          onPick={(token) => {
            if (token !== (pendingSettings.current.get(field) ?? control.value))
              store(field, token);
          }}
        />
      </Fragment>
    );

  return (
    <Screen>
      <SettingsForm>
        {current === undefined && newAgentRows.length === 0 ? null : (
          <ListSection
            key={defaultRound}
            title={DEFAULT_WORDS.SECTION}
            footer={refusalOf(newAgentRows, write.said)}
          >
            {current === undefined || standard === undefined ? null : (
              <>
                <MenuPickRow
                  label={DEFAULT_WORDS.MODEL}
                  options={modelOptions(catalog)}
                  picked={standard}
                  onPick={(id) => {
                    const now = latest();

                    if (now !== undefined && id !== standardModelIdOf(now.model)) {
                      choose(modelPicked(catalog, id, now));
                    }
                  }}
                />
                {effortOptions(catalog, current.model).length <= 1 ? null : (
                  <MenuPickRow
                    label={DEFAULT_WORDS.EFFORT}
                    options={effortOptions(catalog, current.model)}
                    picked={current.effort}
                    onPick={(effort) => {
                      const now = latest();

                      if (now === undefined) return;
                      // Note that the efforts drawn are the drawn model's, so one picked while a newer model waits is fitted to that model's, as a model pick fits its effort.
                      const fitted = effortFor(effortsOf(catalog, now.model), effort);

                      if (fitted === undefined || fitted === now.effort) return;
                      choose({
                        model: now.model,
                        effort: fitted,
                        ...(now.contextWindow === undefined
                          ? undefined
                          : { contextWindow: now.contextWindow }),
                      });
                    }}
                  />
                )}
                {/* Note that a model with only a fast version beside its standard one is switched, as the panel's Fast row is, and one with more speeds is picked among them. */}
                {speeds.length === 2 && speeds.includes(MODEL_SPEED.FAST) ? (
                  <ToggleRow
                    label={FAST_WORD}
                    on={speed === MODEL_SPEED.FAST}
                    onChange={(on) => atSpeed(on ? MODEL_SPEED.FAST : MODEL_SPEED.STANDARD)}
                  />
                ) : speeds.length > 2 ? (
                  <MenuPickRow
                    label={SPEED_LABEL}
                    options={speeds.map((each) => ({ id: each, label: SPEED_WORD[each] }))}
                    picked={speed}
                    onPick={(picked) => {
                      const next = speeds.find((each) => each === picked);

                      if (next !== undefined) atSpeed(next);
                    }}
                  />
                ) : null}
              </>
            )}
            {newAgentRows.map(pickRow)}
          </ListSection>
        )}
        {preferenceRows.map((row) => (
          <ListSection key={row.entry.id} footer={refusalOf([row]) ?? row.entry.detail}>
            {pickRow(row)}
          </ListSection>
        ))}
      </SettingsForm>
    </Screen>
  );
}
