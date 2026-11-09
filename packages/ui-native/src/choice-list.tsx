// choice-list.tsx -- the options of a decide ask, one row each, the recommended one badged.

import { Button, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  font,
  foregroundStyle,
  listRowBackground,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { ListSection } from "./row-list.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";

export type Choice = {
  /** The option's short label, which also names it. */
  readonly label: string;
  /** A line saying what picking it means. */
  readonly detail?: string | undefined;
};

type ChoiceListProps = {
  readonly choices: readonly Choice[];
  /** The labels of the options the agent recommends. */
  readonly recommended?: readonly string[] | undefined;
  /** The labels picked so far. */
  readonly picked: readonly string[];
  /** Whether a person may pick several, which draws squares rather than circles. */
  readonly multiple?: boolean | undefined;
  /** Called with the labels picked once a row is pressed. */
  readonly onChange: (picked: readonly string[]) => void;
  readonly title?: string | undefined;
};

const RECOMMENDED = "Recommended";

/** The mark leading an option: a ring or a square, filled once picked. */
function pickMark(picked: boolean, multiple: boolean) {
  if (multiple) return picked ? "checkmark.square.fill" : "square";
  return picked ? "checkmark.circle.fill" : "circle";
}

function RecommendedBadge({ colors }: { readonly colors: BrandColors }) {
  return (
    <Text
      modifiers={[
        font({ textStyle: "caption", weight: "semibold" }),
        foregroundStyle(colors.ON_ACCENT),
        padding({ horizontal: 8, vertical: 3 }),
        background(colors.ACCENT),
        clipShape("capsule"),
      ]}
    >
      {RECOMMENDED}
    </Text>
  );
}

/** What pressing `label` leaves picked: it alone for one choice, or it toggled among several. */
function nextPicked(
  picked: readonly string[],
  label: string,
  multiple: boolean,
): readonly string[] {
  if (!multiple) return [label];
  return picked.includes(label) ? picked.filter((each) => each !== label) : [...picked, label];
}

/** A decide ask's options as a section of rows, each pressed to pick it. */
export function ChoiceList(props: ChoiceListProps) {
  const { choices, recommended = [], picked, multiple = false, onChange, title } = props;
  const colors = useColors();
  return (
    <ListSection title={title}>
      {choices.map((choice) => {
        const isPicked = picked.includes(choice.label);
        return (
          <Button
            key={choice.label}
            onPress={() => onChange(nextPicked(picked, choice.label, multiple))}
            modifiers={[listRowBackground("clear")]}
          >
            <HStack spacing={SPACE.ROW}>
              <Image
                systemName={pickMark(isPicked, multiple)}
                size={MARK_SIZE.GLYPH + 5}
                color={isPicked ? colors.ACCENT : colors.TEXT_MUTED}
              />
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[foregroundStyle(colors.TEXT)]}>{choice.label}</Text>
                {choice.detail === undefined ? null : (
                  <Text
                    modifiers={[
                      font({ textStyle: "footnote" }),
                      foregroundStyle(colors.TEXT_MUTED),
                    ]}
                  >
                    {choice.detail}
                  </Text>
                )}
              </VStack>
              <Spacer />
              {recommended.includes(choice.label) ? <RecommendedBadge colors={colors} /> : null}
            </HStack>
          </Button>
        );
      })}
    </ListSection>
  );
}
