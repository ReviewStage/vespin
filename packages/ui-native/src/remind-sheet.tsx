// remind-sheet.tsx -- the sheet Remind me opens on an Inbox thread: the panel's times, each with when it comes due, a day and time of the reader's own in the system's date picker, and Clear reminder on a thread that holds one.

import {
  BottomSheet,
  DatePicker,
  Form,
  Group,
  Host,
  HStack,
  Section,
  Spacer,
  Button as SwiftUIButton,
  Text,
} from "@expo/ui/swift-ui";
import {
  background,
  datePickerStyle,
  font,
  foregroundStyle,
  listRowBackground,
  monospacedDigit,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { REMIND_WORDS } from "@repo/features/inbox-remind-times";
import { useState } from "react";
import { GLYPH } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** Which of its two faces the sheet shows: the times, or the picker for a time of the reader's own. */
const REMIND_STAGE = { TIMES: "times", PICK: "pick" } as const;

type RemindStage = (typeof REMIND_STAGE)[keyof typeof REMIND_STAGE];

/** One time the sheet offers: its words, when it comes due in a date chip's words, and what sets it. */
type RemindChoice = {
  readonly label: string;
  readonly detail: string;
  readonly onPress: () => void;
};

type RemindSheetProps = {
  readonly presented: boolean;
  /** The panel's times, in its order: In 1 hour, Tomorrow, Next week. */
  readonly times: readonly RemindChoice[];
  /** The moment the picker opens on, tomorrow at 9 AM, and the earliest it lets the reader pick, now. */
  readonly pick: { readonly opensAt: number; readonly earliest: number };
  /** Sets the reminder for the instant the picker confirmed. */
  readonly onPick: (at: number) => void;
  /** Clears the thread's reminder; none where it holds none, which leaves Clear reminder out. */
  readonly onClear?: (() => void) | undefined;
  /** Called as the sheet goes, by a choice or by a drag down. */
  readonly onDismiss: () => void;
};

/** A time's row: its words, and at its end when it comes due in the muted ink, the whole row pressed. */
function TimeRow({ time }: { readonly time: RemindChoice }) {
  const colors = useColors();

  return (
    <SwiftUIButton onPress={time.onPress} modifiers={[listRowBackground(colors.SURFACE)]}>
      <HStack>
        <Text modifiers={[foregroundStyle(colors.TEXT)]}>{time.label}</Text>
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {time.detail}
        </Text>
      </HStack>
    </SwiftUIButton>
  );
}

/** The picker's face: the system's calendar and clock, from now on, and Remind me, which alone sets the time picked. */
function PickFace({
  pick,
  onPick,
}: {
  readonly pick: RemindSheetProps["pick"];
  readonly onPick: (at: number) => void;
}) {
  const colors = useColors();
  const [picked, setPicked] = useState(() => new Date(pick.opensAt));

  return (
    <Section title={REMIND_WORDS.PICK}>
      <DatePicker
        selection={picked}
        range={{ start: new Date(pick.earliest) }}
        displayedComponents={["date", "hourAndMinute"]}
        onDateChange={setPicked}
        modifiers={[
          datePickerStyle("graphical"),
          tint(colors.ACCENT),
          listRowBackground(colors.SURFACE),
        ]}
      />
      <SwiftUIButton
        {...actContent(REMIND_WORDS.REMIND_ME, GLYPH.TIME)}
        onPress={() => onPick(picked.getTime())}
        modifiers={[tint(colors.ACCENT), listRowBackground(colors.SURFACE)]}
      />
    </Section>
  );
}

/**
 * Remind me as a sheet from the screen's foot, as Mail's Remind Me opens
 * from a swipe or a menu: the panel's times, each saying when it comes due,
 * then Pick a date and time…, which turns the sheet to the system's
 * calendar and clock, and Clear reminder on a thread that holds one. Each
 * choice closes it. It stands on the sidebar's ground with its rows on the
 * surface, as Settings' form does. Note that it stands in a host of its
 * own, the size of nothing, as `ConfirmAsk` does, so a screen draws it
 * beside whatever it shows, beside its `Screen` rather than inside it, and
 * opens it from a swipe, a long press, or a bar's menu.
 */
export function RemindSheet({
  presented,
  times,
  pick,
  onPick,
  onClear,
  onDismiss,
}: RemindSheetProps) {
  const colors = useColors();
  const [stage, setStage] = useState<RemindStage>(REMIND_STAGE.TIMES);

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
        onDismiss={() => setStage(REMIND_STAGE.TIMES)}
      >
        <Group
          modifiers={[
            presentationDetents(stage === REMIND_STAGE.PICK ? ["large"] : ["medium", "large"]),
            presentationDragIndicator("visible"),
          ]}
        >
          <Form
            modifiers={[
              scrollContentBackground("hidden"),
              background(colors.SIDEBAR),
              tint(colors.TEXT),
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
            ]}
          >
            {stage === REMIND_STAGE.PICK ? (
              <PickFace pick={pick} onPick={onPick} />
            ) : (
              <>
                <Section title={REMIND_WORDS.REMIND_ME}>
                  {times.map((time) => (
                    <TimeRow key={time.label} time={time} />
                  ))}
                  <SwiftUIButton
                    {...actContent(REMIND_WORDS.PICK, GLYPH.TIME)}
                    onPress={() => setStage(REMIND_STAGE.PICK)}
                    modifiers={[listRowBackground(colors.SURFACE)]}
                  />
                </Section>
                {onClear === undefined ? null : (
                  <Section>
                    <SwiftUIButton
                      {...actContent(REMIND_WORDS.CLEAR, GLYPH.INBOX)}
                      onPress={onClear}
                      modifiers={[listRowBackground(colors.SURFACE)]}
                    />
                  </Section>
                )}
              </>
            )}
          </Form>
        </Group>
      </BottomSheet>
    </Host>
  );
}
