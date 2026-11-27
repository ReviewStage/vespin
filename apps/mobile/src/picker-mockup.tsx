// picker-mockup.tsx -- THROWAWAY prototype, never merged: the proposed iOS face and section icon picker sheets, drawn from stock @expo/ui only over synthetic data, for simulator stills (`-pickerMockup face|index|section`).

import {
  BottomSheet,
  Button,
  Circle,
  Form,
  Group,
  Host,
  HStack,
  Image,
  Menu,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  listRowBackground,
  navigationBarTitleDisplayMode,
  navigationTitle,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  scrollContentBackground,
  searchable,
  sectionIndexLabel,
  strokeBorder,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { TASK_SECTION_ICON_KIND } from "@repo/features/task-section-wire";
import { GlyphImage, sectionGlyph, useColors } from "@repo/ui-native";
import { useEffect, useState } from "react";
import { releaseSplash } from "./splash.js";
import { Settings, useColorScheme, View } from "react-native";

/** Which mockup a launch asks for. */
export const PICKER_MOCKUP = { FACE: "face", INDEX: "index", SECTION: "section" } as const;

type PickerMockupKind = (typeof PICKER_MOCKUP)[keyof typeof PICKER_MOCKUP];

const CLEAR = "#00000000";
const CELL = 36;
const COLUMNS = 8;

/** The face fills, light and dark, gray first (`@repo/brand`'s MANAGER_FACE). */
const FACE_FILL = [
  ["gray", "#b6b6ba", "#cfcfd1"],
  ["red", "#f08f89", "#ffaba3"],
  ["orange", "#eab08a", "#ffcba3"],
  ["yellow", "#e7ce8d", "#ffe7a5"],
  ["green", "#8ac893", "#a7e3ad"],
  ["teal", "#8ecbd0", "#ace5ea"],
  ["blue", "#86b9e9", "#aad3ff"],
  ["purple", "#ce8fdc", "#e9abf5"],
  ["pink", "#ee8ea0", "#ffabbc"],
] as const;

/** The section inks, light (proposal F's darkened yellow, teal, orange) and dark. */
const SECTION_INK = [
  ["red", "#d52c36", "#ff6762"],
  ["orange", "#d07427", "#ffa359"],
  ["yellow", "#aa870d", "#ffd452"],
  ["green", "#199f43", "#5ecc71"],
  ["teal", "#169aa4", "#64d1db"],
  ["blue", "#1a85d4", "#69b1ff"],
  ["purple", "#a631be", "#d568ea"],
  ["pink", "#d32a61", "#ff678d"],
] as const;

const SMILEYS = [..."😀😃😄😁😆😅🤣😂🙂🙃🫠😉😊😇🥰😍🤩😘😗☺😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢"];
const TONE = "\u{1F3FD}";
const PEOPLE = [
  "👋", "🤚", "🖐", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌", "🤌", "🤏", "✌", "🤞", "🫰", "🤟",
  "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝", "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏",
  "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍", "💅",
].map((hand) => hand + TONE);
const ANIMALS = [..."🐵🐒🦍🦧🐶🐕🐩🐺🦊🦝🐱🐈🦁🐯🐅🐆🐴🫎🫏🐎🦄🦓🦌🦬"];
const FOOD = [..."🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🫒🥥🥑🍆🥔🥕🌽"];
const INDEX = ["🕘", "😀", "👋", "🐻", "🍔", "⚽", "🚗", "💡", "🔣", "🏳"];
const TONES = [
  ["default", "✋"],
  ["light", "✋🏻"],
  ["medium-light", "✋🏼"],
  ["medium", "✋🏽"],
  ["medium-dark", "✋🏾"],
  ["dark", "✋🏿"],
] as const;
const SUGGESTED = ["folder", "star", "bookmark", "flag", "rocket", "zap", "bug", "flask", "briefcase", "layers", "heart", "circle"];
const ALL_ICONS = ["a-arrow-down", "a-arrow-up", "a-large-small", "accessibility", "activity", "air-vent", "airplay", "alarm-clock", "alarm-clock-check", "alarm-clock-minus", "alarm-clock-off", "alarm-clock-plus", "alarm-smoke", "album", "align-center-horizontal", "align-center-vertical"];

/** The mockup a launch asks for, if any. */
export function pickerMockupKind(): PickerMockupKind | undefined {
  const named: unknown = Settings.get("pickerMockup");

  return Object.values(PICKER_MOCKUP).find((kind) => kind === named);
}

function rows<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / COLUMNS) }, (_, at) =>
    items.slice(at * COLUMNS, (at + 1) * COLUMNS),
  );
}

/** One cell: ringed in copper where it is the one chosen. */
function Cell({ ringed, label, children }: { ringed: boolean; label: string; children: React.ReactNode }) {
  const colors = useColors();

  return (
    <Button onPress={() => undefined} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
      <ZStack
        modifiers={[
          frame({ width: CELL + 6, height: CELL + 6 }),
          strokeBorder({ content: ringed ? colors.ACCENT : CLEAR, shape: "circle", style: { lineWidth: 2 } }),
        ]}
      >
        {children}
      </ZStack>
    </Button>
  );
}

function Grid({ cells }: { cells: readonly React.ReactNode[] }) {
  return (
    <VStack alignment="leading" spacing={4}>
      {rows(cells.map((cell, at) => ({ cell, at }))).map((row) => (
        <HStack key={row[0]?.at ?? 0} spacing={2}>
          {row.map(({ cell, at }) => (
            <Group key={at}>{cell}</Group>
          ))}
          <Spacer />
        </HStack>
      ))}
    </VStack>
  );
}

function EmojiCell({ emoji, ringed = false }: { emoji: string; ringed?: boolean }) {
  return (
    <Cell ringed={ringed} label={emoji}>
      <Text modifiers={[font({ size: 28 })]}>{emoji}</Text>
    </Cell>
  );
}

function Disc({ fill, emoji, side }: { fill: string; emoji: string; side: number }) {
  return (
    <ZStack modifiers={[frame({ width: side, height: side })]}>
      <Circle modifiers={[foregroundStyle(fill)]} />
      <Text modifiers={[font({ size: side * 0.58 })]}>{emoji}</Text>
    </ZStack>
  );
}

/** The palette row: the system's palette picker, each color a filled circle tinted its own color. */
function Palette({
  colors: swatches,
  chosen,
  onChoose,
  dark,
}: {
  colors: readonly (readonly [string, string, string])[];
  chosen: string;
  onChoose: (color: string) => void;
  dark: boolean;
}) {
  return (
    <Picker<string>
      label="Color"
      selection={chosen}
      onSelectionChange={onChoose}
      modifiers={[pickerStyle("palette"), labelsHidden()]}
    >
      {swatches.map(([name, light, darkFill]) => (
        <Image
          key={name}
          systemName="circle.fill"
          color={dark ? darkFill : light}
          modifiers={[tint(dark ? darkFill : light), tag(name), accessibilityLabel(name)]}
        />
      ))}
    </Picker>
  );
}

/** The sheet around a page: medium and large detents, opened large. */
function Sheet({ children }: { children: React.ReactNode }) {
  const colors = useColors(true);

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented onIsPresentedChange={() => undefined}>
        <Group
          modifiers={[
            presentationDetents(["large"]),
            presentationDragIndicator("visible"),
            presentationBackground(colors.GROUPED),
          ]}
        >
          {children}
        </Group>
      </BottomSheet>
    </Host>
  );
}

function FacePage({ withIndex }: { withIndex: boolean }) {
  const colors = useColors(true);
  const dark = useColorScheme() === "dark";
  const query = useNativeState("");
  const [color, setColor] = useState("teal");
  const [tone, setTone] = useState("medium");
  const fill = (name: string) => {
    const row = FACE_FILL.find(([each]) => each === name) ?? FACE_FILL[0];
    return dark ? row[2] : row[1];
  };
  const recent = [
    <Cell key="fox" ringed label="Fox"><Disc fill={fill(color)} emoji="🦊" side={CELL} /></Cell>,
    <Cell key="cat" ringed={false} label="Purple cat">
      <Image assetName="ManagerFaces/cat-rest-purple" modifiers={[resizable(), frame({ width: CELL, height: CELL })]} />
    </Cell>,
    <Cell key="robot" ringed={false} label="Robot"><Disc fill={fill("blue")} emoji="🤖" side={CELL} /></Cell>,
    <Cell key="ghost" ringed={false} label="Yellow ghost">
      <Image assetName="ManagerFaces/ghost-rest-yellow" modifiers={[resizable(), frame({ width: CELL, height: CELL })]} />
    </Cell>,
    <Cell key="owl" ringed={false} label="Owl"><Disc fill={fill("yellow")} emoji="🦉" side={CELL} /></Cell>,
    <Cell key="rocket" ringed={false} label="Rocket"><Disc fill={fill("orange")} emoji="🚀" side={CELL} /></Cell>,
    <Cell key="planet" ringed={false} label="Green planet">
      <Image assetName="ManagerFaces/planet-rest-green" modifiers={[resizable(), frame({ width: CELL, height: CELL })]} />
    </Cell>,
    <Cell key="octopus" ringed={false} label="Octopus"><Disc fill={fill("pink")} emoji="🐙" side={CELL} /></Cell>,
  ];
  const groups: [string, string, readonly string[]][] = withIndex
    ? [
        ["People & Body", INDEX[2] ?? "", PEOPLE],
        ["Animals & Nature", INDEX[3] ?? "", ANIMALS],
        ["Food & Drink", INDEX[4] ?? "", FOOD],
      ]
    : [["Smileys & Emotion", INDEX[1] ?? "", SMILEYS]];
  const applyTone = (emoji: string) => (tone === "medium" ? emoji : emoji.replace(TONE, ""));

  return (
    <NavigationStack modifiers={[tint(colors.TEXT)]}>
      <Toolbar>
        <Form
          modifiers={[
            scrollContentBackground("hidden"),
            background(colors.GROUPED),
            navigationTitle("Manager face"),
            navigationBarTitleDisplayMode("inline"),
            searchable(query, { placement: "navigationBarDrawer", prompt: "Search faces" }),
          ]}
        >
          {withIndex ? null : (
            <Section modifiers={[listRowBackground(CLEAR)]}>
              <VStack spacing={8}>
                <Disc fill={fill(color)} emoji="🦊" side={96} />
                <Text modifiers={[font({ size: 15, weight: "semibold" })]}>Release manager</Text>
              </VStack>
            </Section>
          )}
          {withIndex ? null : (
            <Section>
              <Palette colors={FACE_FILL} chosen={color} onChoose={setColor} dark={dark} />
            </Section>
          )}
          {withIndex ? null : (
            <Section modifiers={[sectionIndexLabel(INDEX[0] ?? "")]} title="Recent">
              <Grid cells={recent} />
            </Section>
          )}
          {groups.map(([name, label, emojis]) => (
            <Section key={name} title={name} modifiers={[sectionIndexLabel(label)]}>
              <Grid cells={emojis.map((emoji) => <EmojiCell key={emoji} emoji={applyTone(emoji)} />)} />
            </Section>
          ))}
          {withIndex
            ? INDEX.slice(5).map((label) => (
                <Section key={label} title=" " modifiers={[sectionIndexLabel(label)]}>
                  <Text> </Text>
                </Section>
              ))
            : null}
        </Form>
        <Toolbar.Content>
          {withIndex ? (
            <ToolbarItem placement="topBarTrailing">
              <Menu label="Skin tone" systemImage="hand.raised">
                <Picker<string>
                  label="Skin tone"
                  selection={tone}
                  onSelectionChange={setTone}
                  modifiers={[pickerStyle("palette")]}
                >
                  {TONES.map(([key, hand]) => (
                    <Text key={key} modifiers={[tag(key), accessibilityLabel(key)]}>
                      {hand}
                    </Text>
                  ))}
                </Picker>
              </Menu>
            </ToolbarItem>
          ) : null}
          <ToolbarItem placement="confirmationAction">
            <Button label="Done" onPress={() => undefined} />
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </NavigationStack>
  );
}

function SectionPage() {
  const colors = useColors(true);
  const dark = useColorScheme() === "dark";
  const query = useNativeState("");
  const [color, setColor] = useState("blue");
  const inkRows: (readonly [string, string, string])[] = [["ink", colors.TEXT, colors.TEXT], ...SECTION_INK];
  const ink = (name: string) => {
    const row = inkRows.find(([each]) => each === name) ?? inkRows[0];
    return row === undefined ? colors.TEXT : dark ? row[2] : row[1];
  };
  const glyphCell = (glyph: string, inColor: string, ringed = false) => (
    <Cell key={glyph} ringed={ringed} label={glyph}>
      <GlyphImage glyph={sectionGlyph({ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph })} color={ink(inColor)} textStyle="body" />
    </Cell>
  );
  const recent = [
    glyphCell("rocket", color, true),
    <EmojiCell key="🧪" emoji="🧪" />,
    glyphCell("bug", "red"),
    glyphCell("star", "yellow"),
    <EmojiCell key="🛠" emoji="🛠️" />,
    glyphCell("flag", "green"),
    <EmojiCell key="📦" emoji="📦" />,
    glyphCell("sparkles", "purple"),
  ];

  return (
    <NavigationStack modifiers={[tint(colors.TEXT)]}>
      <Toolbar>
        <Form
          modifiers={[
            scrollContentBackground("hidden"),
            background(colors.GROUPED),
            navigationTitle("Section icon"),
            navigationBarTitleDisplayMode("inline"),
            searchable(query, { placement: "navigationBarDrawer", prompt: "Search icons and emoji" }),
          ]}
        >
          <Section modifiers={[listRowBackground(CLEAR)]}>
            <HStack spacing={12}>
              <Spacer />
              <GlyphImage glyph={sectionGlyph({ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "rocket" })} color={ink(color)} textStyle="body" />
              <Text modifiers={[font({ size: 22, weight: "bold" })]}>Experiments</Text>
              <Spacer />
            </HStack>
          </Section>
          <Section>
            <Palette colors={inkRows} chosen={color} onChoose={setColor} dark={dark} />
          </Section>
          <Section title="Recent">
            <Grid cells={recent} />
          </Section>
          <Section title="Suggested">
            <Grid cells={SUGGESTED.map((glyph) => glyphCell(glyph, color, glyph === "rocket"))} />
          </Section>
          <Section title="All icons">
            <Grid cells={ALL_ICONS.map((glyph) => glyphCell(glyph, color))} />
          </Section>
        </Form>
        <Toolbar.Content>
          <ToolbarItem placement="topBarTrailing">
            <Button systemImage="trash" label="Remove icon" onPress={() => undefined} />
          </ToolbarItem>
          <ToolbarItem placement="confirmationAction">
            <Button label="Done" onPress={() => undefined} />
          </ToolbarItem>
        </Toolbar.Content>
      </Toolbar>
    </NavigationStack>
  );
}

/** The mockup a launch asked for, alone on the brand's ground. */
export function PickerMockup({ kind }: { kind: PickerMockupKind }) {
  const colors = useColors();
  useEffect(() => releaseSplash(), []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.GROUND }}>
      <Sheet>
        {kind === PICKER_MOCKUP.SECTION ? <SectionPage /> : <FacePage withIndex={kind === PICKER_MOCKUP.INDEX} />}
      </Sheet>
    </View>
  );
}
