// button.tsx -- the app's buttons and chips: the system's own, in the brand's accent.

import { Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  frame,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";

/** How a button stands: filled for the one act a screen is for, outlined beside it, words alone, or Liquid Glass over content. */
export const BUTTON_LOOK = {
  PROMINENT: "borderedProminent",
  BORDERED: "bordered",
  PLAIN: "borderless",
  GLASS: "glass",
  GLASS_PROMINENT: "glassProminent",
} as const;

export type ButtonLook = (typeof BUTTON_LOOK)[keyof typeof BUTTON_LOOK];

/** How big a button is drawn: a row's, or a screen's own act. */
export const BUTTON_SIZE = {
  REGULAR: "regular",
  LARGE: "large",
} as const;

export type ButtonSize = (typeof BUTTON_SIZE)[keyof typeof BUTTON_SIZE];

/** How wide a button stands: around its words, or across its column, as a sign-in page's ways in do. */
export const BUTTON_WIDTH = {
  FIT: "fit",
  FILL: "fill",
} as const;

export type ButtonWidth = (typeof BUTTON_WIDTH)[keyof typeof BUTTON_WIDTH];

type ButtonProps = {
  readonly label: string;
  readonly symbol?: SfSymbol | undefined;
  readonly look?: ButtonLook | undefined;
  readonly size?: ButtonSize | undefined;
  readonly width?: ButtonWidth | undefined;
  /** Whether the act deletes or undoes something, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/**
 * A button, filled in the accent unless it says otherwise. Note that a
 * button across its column widens its words rather than itself, because a
 * bordered button's shape is drawn around its label, so the label is a
 * `Text` framed to the column's width and the symbol is left out.
 */
export function Button(props: ButtonProps) {
  const { label, symbol, look = BUTTON_LOOK.PROMINENT, size = BUTTON_SIZE.REGULAR } = props;
  const colors = useColors();
  const content =
    props.width === BUTTON_WIDTH.FILL
      ? {
          children: (
            <Text modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}>{label}</Text>
          ),
        }
      : { label, ...(symbol === undefined ? {} : { systemImage: symbol }) };
  return (
    <SwiftUIButton
      {...content}
      role={props.destructive === true ? "destructive" : "default"}
      onPress={props.onPress}
      modifiers={[
        buttonStyle(look),
        controlSize(size),
        ...(props.destructive === true ? [] : [tint(colors.ACCENT)]),
        disabledModifier(props.disabled === true),
      ]}
    />
  );
}

type ChipProps = {
  readonly label: string;
  readonly symbol?: SfSymbol | undefined;
  /** Whether the chip stands chosen, which fills it in the accent. */
  readonly selected?: boolean | undefined;
  readonly onPress: () => void;
};

/** A small capsule a person picks among others, such as a filter or a model. */
export function Chip({ label, symbol, selected = false, onPress }: ChipProps) {
  const colors = useColors();
  return (
    <SwiftUIButton
      label={label}
      {...(symbol === undefined ? {} : { systemImage: symbol })}
      onPress={onPress}
      modifiers={[
        buttonStyle(selected ? BUTTON_LOOK.PROMINENT : BUTTON_LOOK.BORDERED),
        buttonBorderShape("capsule"),
        controlSize("small"),
        tint(selected ? colors.ACCENT : colors.TEXT_MUTED),
      ]}
    />
  );
}
