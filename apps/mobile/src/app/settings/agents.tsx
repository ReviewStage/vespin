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
  useAsyncAction,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { effortOptions, modelOptions, useModelCatalog } from "../../tasks/use-start.js";

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
 * panel's: the new agents' own (default permissions) under the default
 * model, then the Agents group of Preferences (follow-up behavior and the
 * commit author), as the schema orders their rows.
 */
const SCHEMA_GROUPS = [
  { page: SETTINGS_PAGE.AGENTS, section: SETTING_SECTION.NEW_AGENTS },
  { page: SETTINGS_PAGE.PREFERENCES, section: SETTING_SECTION.AGENTS },
] as const satisfies readonly { page: SettingsPage; section: SettingSection }[];

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
  const write = useAsyncAction(rejectionWords);
  const setting = useAsyncAction(rejectionWords);
  // Note that SwiftUI's pickers and switch keep the pick a person made, so a write that was dropped or refused redraws its section, which reads the stored choice again.
  const [defaultRound, setDefaultRound] = useState(0);
  const [settingRound, setSettingRound] = useState(0);
  // The setting last written, whose section says why a refusal was given.
  const [written, setWritten] = useState<AppSettingField | undefined>(undefined);
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

    void write
      .run(() => acts[ACT_KIND.AGENTS_DEFAULT_WRITE](choice).then(() => undefined))
      .then((landed) => {
        if (!landed) setDefaultRound((round) => round + 1);
      });
  };

  const atSpeed = (next: ModelSpeed) => {
    if (current === undefined || standard === undefined) return;
    choose(choiceAt(catalog, modelIdAtSpeed(standard, next), current));
  };

  const store = (field: AppSettingField, token: string) => {
    if (view === undefined) return;
    const value = settingFromOption(field, token, view);
    setWritten(field);
    void setting
      .run(() => acts[ACT_KIND.SETTING_UPDATE]({ field, value }).then(() => undefined))
      .then((landed) => {
        if (!landed) setSettingRound((round) => round + 1);
      });
  };

  return (
    <Screen>
      <SettingsForm>
        {current === undefined || standard === undefined ? null : (
          <ListSection key={defaultRound} title={DEFAULT_WORDS.SECTION} footer={write.refusal}>
            <MenuPickRow
              label={DEFAULT_WORDS.MODEL}
              options={modelOptions(catalog)}
              picked={standard}
              onPick={(id) => {
                if (id !== standard) choose(modelPicked(catalog, id, current));
              }}
            />
            {effortOptions(catalog, current.model).length <= 1 ? null : (
              <MenuPickRow
                label={DEFAULT_WORDS.EFFORT}
                options={effortOptions(catalog, current.model)}
                picked={current.effort}
                onPick={(effort) => {
                  if (effort === current.effort) return;
                  choose({
                    model: current.model,
                    effort,
                    ...(current.contextWindow === undefined
                      ? undefined
                      : { contextWindow: current.contextWindow }),
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

                  if (next !== undefined && next !== speed) atSpeed(next);
                }}
              />
            ) : null}
          </ListSection>
        )}
        {view === undefined
          ? null
          : SCHEMA_GROUPS.flatMap(({ page, section }) =>
              settingRowsForPage(page, section, view).flatMap(({ field, entry, control }) =>
                control === undefined
                  ? []
                  : [
                      <ListSection
                        key={entry.id}
                        footer={
                          written === field && setting.refusal !== undefined
                            ? setting.refusal
                            : entry.detail
                        }
                      >
                        <MenuPickRow
                          key={settingRound}
                          label={entry.label}
                          options={control.options.map((option) => ({
                            id: option.value,
                            label: option.label,
                          }))}
                          picked={control.value}
                          onPick={(token) => {
                            if (token !== control.value) store(field, token);
                          }}
                        />
                      </ListSection>,
                    ],
              ),
            )}
      </SettingsForm>
    </Screen>
  );
}
