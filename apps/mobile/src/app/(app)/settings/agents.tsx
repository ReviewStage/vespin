// agents.tsx -- Settings' Agents page: the model, effort, and speed a new agent starts on, and the rest of how agents work for the account (default permissions, follow-up behavior, commit author, and whether they ask in the Inbox), drawn from the panel's own settings rows.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEFAULT_SAVE_FAILED_NOTE } from "@repo/features/agent-refusal-words";
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
  AGENT_ENTER,
  AGENT_ENTER_TOUCH_DETAIL,
  APP_SETTING_ID,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  isAgentEnter,
  isPermissionMode,
  SETTING_SECTION,
  SETTINGS_PAGE,
  type SettingSection,
  type SettingsPage,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@repo/settings";
import {
  FOOTER_TONE,
  footerToneOf,
  ListSection,
  MenuPickRow,
  PERMISSION_MODE_GLYPH,
  rejectionWords,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  ToggleRow,
} from "@repo/ui-native";
import { actionRefused } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { AgentKeySections, useAgentKeyRemoval } from "../../../agent-keys/agent-keys.js";
import { appStateQuery } from "../../../host/app-state-query.js";
import { useHostActs } from "../../../host/host-provider.js";
import { effortOptions, modelOptions, useModelCatalog } from "../../../tasks/use-start.js";
import { useLatestWrites } from "../../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** No setting's row redrawn yet. */
const NO_ROUNDS: ReadonlyMap<AppSettingField, number> = new Map();

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
 * it, as the schema orders their rows; then the Inbox's switch, the one row
 * of the panel's General preferences the phone draws, since it decides
 * where the member's agents ask.
 */
const SCHEMA_GROUP = {
  NEW_AGENTS: { page: SETTINGS_PAGE.AGENTS, section: SETTING_SECTION.NEW_AGENTS },
  PREFERENCES: { page: SETTINGS_PAGE.PREFERENCES, section: SETTING_SECTION.AGENTS },
  GENERAL: { page: SETTINGS_PAGE.PREFERENCES, section: SETTING_SECTION.GENERAL },
} as const satisfies Record<string, { page: SettingsPage; section: SettingSection }>;

/** The Inbox's own setting, which the phone draws as a switch. */
const INBOX_FIELD = APP_SETTING_SCHEMA.inbox.field;

/** One stored setting's row as the schema draws it on a page. */
type SchemaRow = ReturnType<typeof settingRowsForPage>[number];

/** The glyph a Default permissions option leads with, the panel's own (`modeGlyph`); none for any other choice. */
function modeSymbol(field: AppSettingField, token: string) {
  return field === APP_SETTING_SCHEMA.agentPermissionMode.field && isPermissionMode(token)
    ? PERMISSION_MODE_GLYPH[token]
    : undefined;
}

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
  const removal = useAgentKeyRemoval();
  const catalog = useModelCatalog()?.models ?? NO_MODELS;
  const { data: current } = useQuery({ ...appStateQuery, select: selectAgentDefault });
  const { data: settings } = useQuery({ ...appStateQuery, select: selectAppSettingsView });
  const { data: capabilities = [] } = useQuery({ ...appStateQuery, select: selectCapabilities });
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  // Note that each pick goes at once, even while an earlier one is out, such as an effort right after a model, since the host draws the default and a setting as they are sent.
  const write = useLatestWrites<string, ModelChoice | undefined>(rejectionWords);
  const setting = useLatestWrites<string, string>(rejectionWords);
  // Note that SwiftUI's pickers and switch keep the pick a person made, so a write that was refused redraws its own controls, which read the stored choice again: the default's model, effort and speed together, and each setting's row alone, so another row's pick still out stands.
  const [defaultRound, setDefaultRound] = useState(0);

  const [settingRounds, setSettingRounds] =
    useState<ReadonlyMap<AppSettingField, number>>(NO_ROUNDS);

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

  // Note that the newest choice sent stands until it is answered, so a pick made before the host's draw of an earlier one reaches the screen, such as an effort right after a model, builds on it rather than on the default drawn.
  const latest = (): ModelChoice | undefined =>
    write.newest(ACT_KIND.AGENTS_DEFAULT_WRITE, current);

  const choose = (choice: ModelChoice | undefined) => {
    if (choice === undefined) {
      setDefaultRound((round) => round + 1);

      return;
    }

    // Note that the model, effort and speed write the one default, so they follow each other as one row's writes.
    void write
      .run(ACT_KIND.AGENTS_DEFAULT_WRITE, choice, () =>
        // Note that a refusal comes back in the answer rather than thrown, as the panel reads it (`choiceRefused`).
        acts[ACT_KIND.AGENTS_DEFAULT_WRITE](choice).then((answer) =>
          "failure" in answer ? DEFAULT_SAVE_FAILED_NOTE : undefined,
        ),
      )
      .then((landed) => {
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
    void setting
      .run(field, token, () => acts[ACT_KIND.SETTING_UPDATE]({ field, value }).then(actionRefused))
      .then((landed) => {
        if (!landed) {
          setSettingRounds((rounds) => new Map(rounds).set(field, (rounds.get(field) ?? 0) + 1));
        }
      });
  };

  // Note that the Inbox's switch goes as the choice rows do, its refusal said under its row and a refused turn redrawn from the stored choice.
  const storeInbox = (on: boolean) => {
    void setting
      .run(INBOX_FIELD, String(on), () =>
        acts[ACT_KIND.SETTING_UPDATE]({ field: INBOX_FIELD, value: on }).then(actionRefused),
      )
      .then((landed) => {
        if (!landed) {
          setSettingRounds((rounds) =>
            new Map(rounds).set(INBOX_FIELD, (rounds.get(INBOX_FIELD) ?? 0) + 1),
          );
        }
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

  // Note that the Inbox's row stands only where the schema shows it, so the phone draws it once every window hides the Inbox it turns off.
  const inboxRow =
    view === undefined
      ? undefined
      : settingRowsForPage(SCHEMA_GROUP.GENERAL.page, SCHEMA_GROUP.GENERAL.section, view).find(
          (row) => row.field === INBOX_FIELD,
        );

  // The refusals said for a group's settings, each by its own field, under the group that holds its row.
  const refusalOf = (rows: readonly SchemaRow[], also: readonly string[] = []) =>
    [...also, ...rows.flatMap((row) => setting.refusals.get(row.field) ?? [])].join(" ") ||
    undefined;

  // Note that Follow-up behavior's footer says what a phone's Send does, since the desktop's words name ⌘ Enter, which a touch screen has none of.
  const detailOf = ({ entry, control }: SchemaRow) =>
    entry.id !== APP_SETTING_ID.AGENT_ENTER || control === undefined
      ? entry.detail
      : AGENT_ENTER_TOUCH_DETAIL[isAgentEnter(control.value) ? control.value : AGENT_ENTER.STEER];

  const pickRow = ({ field, entry, control }: SchemaRow) =>
    control === undefined ? null : (
      // Note that SwiftUI's picker keeps the pick a person made, so a refused write draws the row anew under the next round, reading the stored choice again.
      <Fragment key={entry.id}>
        <MenuPickRow
          key={settingRounds.get(field) ?? 0}
          label={entry.label}
          options={control.options.map((option) => ({
            id: option.value,
            label: option.label,
            symbol: modeSymbol(field, option.value),
          }))}
          picked={control.value}
          onPick={(token) => {
            if (token !== setting.newest(field, control.value)) store(field, token);
          }}
        />
      </Fragment>
    );

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <AgentKeySections onRemove={removal.remove} />
          {current === undefined && newAgentRows.length === 0 ? null : (
            <ListSection
              title={DEFAULT_WORDS.SECTION}
              footer={refusalOf(newAgentRows, write.said)}
              footerTone={FOOTER_TONE.FAILURE}
            >
              {current === undefined || standard === undefined ? null : (
                <Fragment key={defaultRound}>
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
                </Fragment>
              )}
              {newAgentRows.map(pickRow)}
            </ListSection>
          )}
          {preferenceRows.map((row) => (
            <ListSection
              key={row.entry.id}
              footer={refusalOf([row]) ?? detailOf(row)}
              footerTone={footerToneOf(refusalOf([row]))}
            >
              {pickRow(row)}
            </ListSection>
          ))}
          {inboxRow === undefined || settings === undefined ? null : (
            <ListSection
              footer={refusalOf([inboxRow]) ?? inboxRow.entry.detail}
              footerTone={footerToneOf(refusalOf([inboxRow]))}
            >
              <ToggleRow
                key={settingRounds.get(INBOX_FIELD) ?? 0}
                label={inboxRow.entry.label}
                on={settings.inbox !== false}
                onChange={storeInbox}
              />
            </ListSection>
          )}
        </SettingsForm>
      </Screen>
      {removal.ask}
    </>
  );
}
