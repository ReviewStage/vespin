// offer-tree.ts -- what an `@` offers as the plain tree the pill field's native list draws (`PillFieldModule.swift`'s offer list), and the presses it sends back: each row's words and mark, each group's header, a narrowed list's way back, and the inks, the tree naming the words it answers, so the field stands it on the keystroke and never acts on a row older than its words.

import { useMemo } from "react";
import { PixelRatio, useColorScheme } from "react-native";
import { useScaledSize } from "./accessibility.js";
import type { MentionCrumb, MentionSuggestionGroup } from "./composer-head.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { type PreviewLook, type PreviewNode, suggestionMark } from "./row-preview-model.js";
import { toneColor, useColors } from "./tokens/colors.js";

/** What an `@` offers for the words after it, as the composer hands it to the field: those words, its groups, what stands where nothing is offered, and a narrowed list's way back. */
export interface OfferSource {
  readonly query: string;
  readonly groups: readonly MentionSuggestionGroup[];
  readonly empty: string | undefined;
  readonly crumb: MentionCrumb | undefined;
}

/** A glyph by its catalog's name or the system's. */
interface OfferGlyph {
  readonly asset?: string | undefined;
  readonly system?: string | undefined;
}

/** One row of the native list: its words, its mark, and whether a press narrows the list rather than naming it, which its chevron says. */
interface OfferRow {
  readonly id: string;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly opens: boolean;
  readonly mark: PreviewNode;
}

/** What the pill field's native list draws for an `@` word, as one JSON string: the words it answers, its groups, its way back, and its inks. */
export interface OfferTree {
  readonly query: string;
  readonly groups: readonly {
    readonly title?: string | undefined;
    readonly rows: readonly OfferRow[];
  }[];
  /** A narrowed list's way back: its words, the kind's mark, and what VoiceOver hears it as. */
  readonly crumb?: { readonly title: string; readonly mark: PreviewNode } | undefined;
  readonly empty?: string | undefined;
  /** The glyphs its rows end and its way back leads with. */
  readonly chevron: OfferGlyph;
  readonly back: OfferGlyph;
  readonly inks: {
    readonly text: string;
    readonly muted: string;
    readonly selected: string;
  };
}

/** What the native list sends back: a row pressed, by its group's place and its id, or the way back, each with the words its tree answered. */
export const OFFER_PRESS = { PICK: "pick", BACK: "back" } as const;

export type OfferPress =
  | {
      readonly kind: typeof OFFER_PRESS.PICK;
      readonly query: string;
      readonly group: number;
      readonly id: string;
    }
  | { readonly kind: typeof OFFER_PRESS.BACK; readonly query: string };

/** What a field of pills is handed to offer an `@`'s list natively: the trees, and where its presses go. */
export interface FieldOffer {
  readonly trees: OfferTrees;
  readonly onPress: (press: OfferPress) => void;
}

/** A press as the native field sends it, read; none where it names no press this side knows. */
export function offerPressOf(told: {
  readonly kind: string;
  readonly query: string;
  readonly group?: number | undefined;
  readonly id?: string | undefined;
}): OfferPress | undefined {
  if (told.kind === OFFER_PRESS.BACK) return { kind: OFFER_PRESS.BACK, query: told.query };

  if (told.kind !== OFFER_PRESS.PICK || told.group === undefined || told.id === undefined) {
    return undefined;
  }

  return { kind: OFFER_PRESS.PICK, query: told.query, group: told.group, id: told.id };
}

/** A glyph as the native list reads it. */
function offerGlyph(glyph: Parameters<typeof glyphImage>[0]): OfferGlyph {
  const image = glyphImage(glyph);

  return "assetName" in image ? { asset: image.assetName } : { system: image.systemName };
}

/** What `source` offers as the native list's tree, its marks drawn in `look`. Note that a narrowed list's one group stands with no header, since its way back names it. */
export function offerTree(source: OfferSource, look: PreviewLook, selected: string): OfferTree {
  const { crumb } = source;

  return {
    query: source.query,
    groups: source.groups.map((group) => ({
      title: crumb === undefined ? group.title : undefined,
      rows: group.rows.map((row) => ({
        id: row.id,
        title: row.name,
        detail: row.detail === "" ? undefined : row.detail,
        opens: row.opens === true,
        mark: suggestionMark(row.glyph, row.mark, look),
      })),
    })),
    crumb:
      crumb === undefined
        ? undefined
        : { title: crumb.name, mark: suggestionMark(crumb.glyph, undefined, look) },
    empty: source.empty,
    chevron: offerGlyph(GLYPH.DISCLOSURE),
    back: offerGlyph(GLYPH.BACK),
    inks: { text: look.colors.TEXT, muted: look.colors.TEXT_MUTED, selected },
  };
}

/** The trees the native field takes, as JSON: what the `@` word offers, and what a bare `@` offers; none where nothing is. */
export interface OfferTrees {
  readonly offer: string | undefined;
  readonly bare: string | undefined;
}

/** The trees of what the `@` word offers and of what a bare `@` offers, as the JSON the native field takes. */
export function useOfferTrees(
  current: OfferSource | undefined,
  bare: OfferSource | undefined,
): OfferTrees {
  const colors = useColors();
  const scale = useScaledSize(1);
  const dark = useColorScheme() === "dark";

  const look = useMemo(
    (): PreviewLook => ({
      colors,
      tone: (tone) => toneColor(colors, tone),
      scale,
      dark,
      pixelRatio: PixelRatio.get(),
      now: Date.now(),
    }),
    [colors, scale, dark],
  );

  const offer = useMemo(
    () =>
      current === undefined ? undefined : JSON.stringify(offerTree(current, look, colors.SELECTED)),
    [current, look, colors.SELECTED],
  );

  const held = useMemo(
    () => (bare === undefined ? undefined : JSON.stringify(offerTree(bare, look, colors.SELECTED))),
    [bare, look, colors.SELECTED],
  );

  return { offer, bare: held };
}

/**
 * Acts on a press the native list sent back, against what was offered for
 * the same words: a row's pick by its group and id, or the way back. Note
 * that a press whose words no longer match what is offered is let go, since
 * the native list holds a press until a tree answering its words lands.
 */
export function offerPressed(
  press: OfferPress,
  offered: (OfferSource & { readonly pick: (group: string, id: string) => void }) | undefined,
): void {
  if (offered === undefined || offered.query !== press.query) return;

  if (press.kind === OFFER_PRESS.BACK) {
    offered.crumb?.onBack();
  } else {
    const group = offered.groups[press.group];

    if (group !== undefined) offered.pick(group.title, press.id);
  }
}
