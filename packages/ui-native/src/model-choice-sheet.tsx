// model-choice-sheet.tsx -- the sheet a coding agent's model is chosen in, as iOS stands a long choice: Model one row that pushes the models under each harness's mark, its effort right under it as the system's segmented control, Fast where the model has a fast version, and Permissions where the agent's harness takes a mode, with Done in the sheet's bar.

import {
  BottomSheet,
  Form,
  Group,
  Host,
  Label,
  NavigationStack,
  Picker,
  Section,
  Button as SwiftUIButton,
  Text,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import {
  background,
  listRowBackground,
  navigationBarTitleDisplayMode,
  navigationTitle,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { HARNESS_INFO } from "@repo/features/agent-credentials-model";
import { FAST_WORD } from "@repo/features/model-effort";
import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import type { ReactNode } from "react";
import { HarnessMark } from "./marks.js";
import { SwitchRow } from "./option-rows.js";
import { FOOTER_TONE, SectionFooter } from "./row-list.js";
import { type PickOption, PickRows } from "./settings-form.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";

/** What the sheet names its rows and its bar's act. */
const CHOICE_WORDS = {
  MODEL: "Model",
  EFFORT: "Effort",
  DONE: "Done",
} as const;

/** A model the sheet offers: its catalog id, its short name as the panel names it, and the harness that runs it. */
export type ModelOption = PickOption & { readonly provider: ModelProvider };

/** The agent's permission mode, where its harness takes one: the modes with their hints, the one it runs on, and what a pick changes. */
export type ModeChoice = {
  readonly title: string;
  readonly options: readonly PickOption[];
  readonly picked: string | undefined;
  readonly onPick: (mode: string) => void;
  /** When a change reaches the agent; none for a new agent. */
  readonly footer?: string | undefined;
  /** Why the last change did not take, standing in the footer's place and told to VoiceOver; none while none failed. */
  readonly note?: string | undefined;
};

type ModelChoiceSheetProps = {
  readonly presented: boolean;
  /** Called as the sheet goes, by Done or a drag down; each pick has already been made as it was pressed. */
  readonly onDismiss: () => void;
  readonly models: readonly ModelOption[];
  readonly model: string | undefined;
  readonly onModel: (model: string) => void;
  /** The chosen model's efforts; Effort stands only where it lists more than one. */
  readonly efforts: readonly PickOption[];
  readonly effort: string | undefined;
  readonly onEffort: (effort: string) => void;
  /** Fast, where the chosen model has a fast version the agent may run; none otherwise. */
  readonly fast?: { readonly on: boolean; readonly onSwitch: (on: boolean) => void } | undefined;
  readonly mode?: ModeChoice | undefined;
  /** Why the last pick did not take, under the model's section; none while none failed. */
  readonly note?: string | undefined;
  /** More of the agent's options under them, such as its MCP servers, as sections of the sheet's form. */
  readonly children?: ReactNode;
};

/** The harnesses in the order the panel's menu stands them, each with the models it runs, the ones with none left out. */
function byHarness(models: readonly ModelOption[]) {
  return Object.values(MODEL_PROVIDER)
    .map((provider) => ({ provider, models: models.filter((each) => each.provider === provider) }))
    .filter((group) => group.models.length > 0);
}

/** The permission section's footer: why the last change did not take while it stands, told as a failure, else when a change reaches the agent. */
function modeFooter(mode: ModeChoice) {
  if (mode.note !== undefined)
    return <SectionFooter words={mode.note} tone={FOOTER_TONE.FAILURE} />;

  if (mode.footer === undefined) return undefined;

  return <SectionFooter words={mode.footer} tone={FOOTER_TONE.NOTE} />;
}

/**
 * A coding agent's model, effort, Fast and permission mode, as one sheet:
 * Model is the system's navigation-link picker, a row naming the model
 * chosen that pushes every model the account may run, grouped under each
 * harness by its name and led by its mark, the chosen one checked, as iOS
 * Settings pushes a long choice rather than drop a long menu; Effort stands
 * right under it as the segmented control, where the eye goes after a pick,
 * rather than at the top of a long list; then Fast as a switch, and the
 * permission mode with each mode's hint. A pick takes as it is pressed, as
 * the panel's menu takes it, so Done only closes the sheet. It stands on the
 * grouped ground in a host of its own beside its screen, as every ask does.
 */
export function ModelChoiceSheet(props: ModelChoiceSheetProps) {
  const { presented, onDismiss, models, model, onModel, efforts, effort, onEffort } = props;
  // Note that the sheet stands over the window, so in dark it draws on the lifted ground, as iOS lifts what it presents.
  const colors = useColors(true);
  const row = [listRowBackground(colors.RAISED)];

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(["medium", "large"]),
            presentationDragIndicator("visible"),
            presentationBackground(colors.GROUPED),
          ]}
        >
          <NavigationStack modifiers={[tint(colors.TEXT)]}>
            <Toolbar>
              <Form
                modifiers={[
                  scrollContentBackground("hidden"),
                  background(colors.GROUPED),
                  navigationTitle(CHOICE_WORDS.MODEL),
                  navigationBarTitleDisplayMode("inline"),
                ]}
              >
                <Section
                  footer={
                    props.note === undefined ? undefined : (
                      <SectionFooter words={props.note} tone={FOOTER_TONE.FAILURE} />
                    )
                  }
                >
                  <Picker<string | null>
                    label={CHOICE_WORDS.MODEL}
                    selection={model ?? null}
                    onSelectionChange={(id) => {
                      if (id !== null) onModel(id);
                    }}
                    modifiers={[pickerStyle("navigationLink"), ...row]}
                  >
                    {byHarness(models).map((group) => (
                      <Section key={group.provider} title={HARNESS_INFO[group.provider].name}>
                        {group.models.map((option) => (
                          <Label
                            key={option.id}
                            title={option.label}
                            icon={<HarnessMark provider={option.provider} size={MARK_SIZE.LEAD} />}
                            modifiers={[tag(option.id)]}
                          />
                        ))}
                      </Section>
                    ))}
                  </Picker>
                  {efforts.length <= 1 ? null : (
                    <Picker<string | null>
                      label={CHOICE_WORDS.EFFORT}
                      selection={effort ?? null}
                      onSelectionChange={(id) => {
                        if (id !== null) onEffort(id);
                      }}
                      modifiers={[pickerStyle("segmented"), ...row]}
                    >
                      {efforts.map((option) => (
                        <Text key={option.id} modifiers={[tag(option.id)]}>
                          {option.label}
                        </Text>
                      ))}
                    </Picker>
                  )}
                  {props.fast === undefined ? null : (
                    <SwitchRow
                      label={FAST_WORD}
                      on={props.fast.on}
                      onSwitch={props.fast.onSwitch}
                      testId="options-fast"
                    />
                  )}
                </Section>
                {props.mode === undefined ? null : (
                  <Section title={props.mode.title} footer={modeFooter(props.mode)}>
                    <PickRows
                      options={props.mode.options}
                      picked={props.mode.picked}
                      onPick={props.mode.onPick}
                    />
                  </Section>
                )}
                {props.children}
              </Form>
              <Toolbar.Content>
                <ToolbarItem placement="confirmationAction">
                  <SwiftUIButton label={CHOICE_WORDS.DONE} onPress={onDismiss} />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
