/**
 * prototype-face-switcher.tsx -- PROTOTYPE: a small card floating at the window's foot that switches the Manager faces' design direction and shows every face at work.
 *
 * Throwaway, never merged.
 */

import { createPortal } from "react-dom";
import { CHOICE_BAR_LOOK, ChoiceBar } from "../choice-bar/choice-bar.js";
import { Switch } from "../switch/switch.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import {
  FACE_DIRECTION,
  FACE_DIRECTION_NAME,
  type FaceDirection,
  setFaceDirection,
  setFacesWorking,
  useFaceDirection,
} from "./prototype-face-direction.js";

/** The floating switcher; see the module's head. */
export function FaceDirectionSwitcher(): React.JSX.Element {
  const { direction, working } = useFaceDirection();

  return createPortal(
    <div className="fixed top-ui-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-control-gap rounded-menu border border-border-strong bg-popover p-card-inset-snug text-popover-foreground shadow-menu">
      <Text variant={TEXT_VARIANT.GROUP}>Faces</Text>
      <ChoiceBar<FaceDirection>
        label="Design direction"
        items={Object.values(FACE_DIRECTION).map((value) => ({
          value,
          label: FACE_DIRECTION_NAME[value],
        }))}
        value={direction}
        onChange={setFaceDirection}
        look={CHOICE_BAR_LOOK.SEGMENTED}
      />
      <Text variant={TEXT_VARIANT.GROUP}>Working</Text>
      <Switch
        checked={working}
        onChange={(next) => setFacesWorking(next)}
        label="Show every face at work"
      />
    </div>,
    document.body,
  );
}
