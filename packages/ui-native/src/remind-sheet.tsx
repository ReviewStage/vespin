// remind-sheet.tsx -- the sheet Remind me's "Pick a date and time…" opens on an Inbox thread: the system's calendar and clock under the sheet's title, with Cancel and Done in its bar, as Mail's Remind Me Later… stands.

import {
  BottomSheet,
  DatePicker,
  Form,
  Group,
  Host,
  NavigationStack,
  Button as SwiftUIButton,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import {
  background,
  datePickerStyle,
  listRowBackground,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { REMIND_WORDS } from "@repo/features/inbox-remind-times";
import { useEffect, useState } from "react";
import { useColors } from "./tokens/colors.js";

/** What closes the sheet without setting a time, and what sets the one picked. */
const PICK_WORDS = { CANCEL: "Cancel", DONE: "Done" } as const;

type RemindPickSheetProps = {
  readonly presented: boolean;
  /** The moment the picker opens on, tomorrow at 9 AM, and the earliest it lets the reader pick, now. */
  readonly pick: { readonly opensAt: number; readonly earliest: number };
  /** Sets the reminder for the instant picked, as Done is pressed. */
  readonly onPick: (at: number) => void;
  /** Called as the sheet goes, by Done, Cancel, or a drag down. */
  readonly onDismiss: () => void;
};

/**
 * A day and time of the reader's own for Remind me, as a sheet: titled as
 * the menu that opened it, the system's calendar and clock from now on,
 * Cancel at its leading edge and Done at its trailing edge, which alone sets
 * the time, as the panel's picker sets it only from its own act. The menu's
 * times set themselves where they stand (`useRemind`), so the sheet is only
 * ever this one face. It stands on the sidebar's ground with the picker on
 * the surface, as Settings' form does, and in a host of its own, the size
 * of nothing, beside its screen rather than inside it, as every ask does.
 */
export function RemindPickSheet({ presented, pick, onPick, onDismiss }: RemindPickSheetProps) {
  const colors = useColors();
  const [picked, setPicked] = useState(() => new Date(pick.opensAt));

  // Note that each opening starts again from its own opening moment, so an earlier pick that was canceled doesn't stand.
  useEffect(() => {
    if (presented) setPicked(new Date(pick.opensAt));
  }, [presented, pick.opensAt]);

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
            presentationDetents(["large"]),
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
                  navigationTitle(REMIND_WORDS.REMIND_ME),
                  navigationBarTitleDisplayMode("inline"),
                ]}
              >
                <DatePicker
                  selection={picked}
                  range={{ start: new Date(pick.earliest) }}
                  displayedComponents={["date", "hourAndMinute"]}
                  onDateChange={setPicked}
                  modifiers={[
                    datePickerStyle("graphical"),
                    tint(colors.ACCENT),
                    listRowBackground(colors.RAISED),
                  ]}
                />
              </Form>
              <Toolbar.Content>
                <ToolbarItem placement="cancellationAction">
                  <SwiftUIButton label={PICK_WORDS.CANCEL} onPress={onDismiss} />
                </ToolbarItem>
                <ToolbarItem placement="confirmationAction">
                  <SwiftUIButton label={PICK_WORDS.DONE} onPress={() => onPick(picked.getTime())} />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
