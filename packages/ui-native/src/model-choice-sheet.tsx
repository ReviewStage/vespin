// model-choice-sheet.tsx -- where a coding agent's model is chosen, as the panel's model menu holds it: Effort and Fast first, as labeled rows, then every model under its harness's name, each led by its mark, the chosen one checked, and Permissions where the agent's harness takes a mode; a sheet with Done in its bar in a compact window, and a popover from the model chip in a regular one.

import {
  BottomSheet,
  Form,
  Group,
  Host,
  NavigationStack,
  Popover,
  Section,
  Button as SwiftUIButton,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import {
  background,
  frame,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { HARNESS_INFO } from "@repo/features/agent-credentials-model";
import { FAST_WORD } from "@repo/features/model-effort";
import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import type { ReactNode } from "react";
import { useScaledSize } from "./accessibility.js";
import { MenuPickRow } from "./form-rows.js";
import { HarnessMark } from "./marks.js";
import { FOOTER_TONE, SectionFooter } from "./row-list.js";
import { type PickOption, PickRows, ToggleRow } from "./settings-form.js";
import { ElevatedGround, useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";

/** How large a popover of the choices stands at most, in points: a phone's width, and tall enough for the efforts, a harness's models and the permission modes before it scrolls; the system shrinks it to the room the window leaves. */
const POPOVER_SIZE = { WIDTH: 375, HEIGHT: 600 } as const;

/** What the sheet names its rows and its bar's act. */
const CHOICE_WORDS = {
  MODEL: "Model",
  EFFORT: "Effort",
  DONE: "Done",
  JOINED: " · ",
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

type ModelChoiceSheetProps = ModelChoices & {
  readonly presented: boolean;
  /** Called as the sheet goes, by Done or a drag down; each pick has already been made as it was pressed. */
  readonly onDismiss: () => void;
};

/** The model chip a popover of the choices stands from, and whether it is open. */
type ModelChoicePopoverProps = ModelChoices & {
  /** The chip it is anchored to, a `MenuChip` whose press opens it. */
  readonly chip: ReactNode;
  readonly presented: boolean;
  /** Called as the popover goes, by a tap outside it; each pick has already been made as it was pressed. */
  readonly onDismiss: () => void;
};

/** What the choices hold: the models, efforts, Fast and permission mode, and what a pick changes. */
export type ModelChoices = {
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

/** What the chosen model's row says under its name, as the panel's menu says it beside its check: the effort it runs at, and Fast where it runs fast. */
function chosenHint(
  efforts: readonly PickOption[],
  effort: string | undefined,
  fast: boolean,
): string | undefined {
  const words = [
    efforts.length > 1 ? efforts.find((option) => option.id === effort)?.label : undefined,
    fast ? FAST_WORD : undefined,
  ].filter((word): word is string => word !== undefined);

  return words.length === 0 ? undefined : words.join(CHOICE_WORDS.JOINED);
}

/** The sheet's models under one harness, each a row led by its mark at a glyph's size, scaled with the reader's text, the chosen one checked and saying its effort. */
function HarnessModels({
  models,
  model,
  hint,
  onModel,
}: {
  readonly models: readonly ModelOption[];
  readonly model: string | undefined;
  readonly hint: string | undefined;
  readonly onModel: (model: string) => void;
}) {
  const size = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <PickRows
      options={models.map((option) => ({
        id: option.id,
        label: option.label,
        hint: option.id === model ? hint : undefined,
        mark: <HarnessMark provider={option.provider} size={size} />,
      }))}
      picked={model}
      onPick={(id) => {
        if (id !== model) onModel(id);
      }}
    />
  );
}

/**
 * A coding agent's model, effort, Fast and permission mode, as one sheet,
 * holding what the panel's model menu holds: Effort, a row naming the
 * effort chosen whose press opens the efforts the model lists, and Fast,
 * a switch, lead it as labeled rows, so they stand in sight at half height
 * rather than past a long list; then every model the account may run, in
 * place rather than a page further, under its harness's name, each led by
 * its mark and the chosen one checked in copper, saying its effort under
 * its name, as the panel's menu says it beside its check; then the
 * permission mode with each mode's hint. A pick takes as it is pressed, as
 * the panel's menu takes it, so Done only closes the sheet. Every row
 * stands on the lifted ground (`ElevatedGround`), the rows its pieces draw
 * as much as its own, so in dark none stands a shade apart; and it stands
 * on the grouped ground in a host of its own beside its screen, as every
 * ask does.
 */
export function ModelChoiceSheet(props: ModelChoiceSheetProps) {
  return (
    <ElevatedGround>
      <ModelChoiceForm {...props} />
    </ElevatedGround>
  );
}

/** The sheet itself, under its lifted ground. */
function ModelChoiceForm(props: ModelChoiceSheetProps) {
  const { presented, onDismiss } = props;
  const colors = useColors();

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
          <ModelChoiceList {...props} onDone={onDismiss} />
        </Group>
      </BottomSheet>
    </Host>
  );
}

/**
 * The choices themselves, under their title: Effort and Fast, then the
 * models under each harness's name, then the permission mode, with Done in
 * the bar where it stands in a sheet, which a popover, let go by a tap
 * outside it, has no need of.
 */
function ModelChoiceList(props: ModelChoices & { readonly onDone?: (() => void) | undefined }) {
  const { models, model, onModel, efforts, effort, onEffort, onDone } = props;
  const colors = useColors();
  const choosesEffort = efforts.length > 1;
  const hint = chosenHint(efforts, effort, props.fast?.on === true);

  return (
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
          {!choosesEffort && props.fast === undefined && props.note === undefined ? null : (
            <Section
              footer={
                props.note === undefined ? undefined : (
                  <SectionFooter words={props.note} tone={FOOTER_TONE.FAILURE} />
                )
              }
            >
              {choosesEffort ? (
                <MenuPickRow
                  label={CHOICE_WORDS.EFFORT}
                  options={efforts}
                  picked={effort}
                  onPick={onEffort}
                />
              ) : null}
              {props.fast === undefined ? null : (
                <ToggleRow
                  label={FAST_WORD}
                  on={props.fast.on}
                  onChange={props.fast.onSwitch}
                  testId="options-fast"
                />
              )}
            </Section>
          )}
          {byHarness(models).map((group) => (
            <Section key={group.provider} title={HARNESS_INFO[group.provider].name}>
              <HarnessModels models={group.models} model={model} hint={hint} onModel={onModel} />
            </Section>
          ))}
          {props.mode === undefined ? null : (
            <Section title={props.mode.title} footer={modeFooter(props.mode)}>
              <PickRows
                options={props.mode.options}
                picked={props.mode.picked}
                onPick={props.mode.onPick}
              />
            </Section>
          )}
        </Form>
        {onDone === undefined ? null : (
          <Toolbar.Content>
            <ToolbarItem placement="confirmationAction">
              <SwiftUIButton label={CHOICE_WORDS.DONE} onPress={onDone} />
            </ToolbarItem>
          </Toolbar.Content>
        )}
      </Toolbar>
    </NavigationStack>
  );
}

/**
 * The same choices as a popover from the model chip, as a regular window's
 * pickers pop over from the control that opens them rather than rising as a
 * sheet, which on an iPad stood short in the middle of the window and cut
 * its own list. It stands as tall as its choices up to `POPOVER_SIZE`, on
 * the lifted ground, and goes on a tap outside it; a pick takes as it is
 * pressed, as the sheet's does. Note that it wraps the chip itself, which
 * stands where its caller puts it, so the popover's arrow points at it.
 */
export function ModelChoicePopover(props: ModelChoicePopoverProps) {
  const { chip, presented, onDismiss } = props;

  return (
    <Popover
      isPresented={presented}
      onIsPresentedChange={(shown) => {
        if (!shown) onDismiss();
      }}
    >
      <Popover.Trigger>{chip}</Popover.Trigger>
      <Popover.Content>
        <ElevatedGround>
          <PopoverChoices {...props} />
        </ElevatedGround>
      </Popover.Content>
    </Popover>
  );
}

/** A popover's choices, sized and grounded under its lifted ground. */
function PopoverChoices(props: ModelChoices) {
  const colors = useColors();

  return (
    <Group
      modifiers={[
        frame({ idealWidth: POPOVER_SIZE.WIDTH, idealHeight: POPOVER_SIZE.HEIGHT }),
        presentationBackground(colors.GROUPED),
      ]}
    >
      <ModelChoiceList {...props} />
    </Group>
  );
}
