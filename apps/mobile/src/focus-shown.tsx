// focus-shown.tsx -- whether a screen stands in front of its stack, heard through focus events and kept by the small piece that reads it, so a change of focus never draws the whole screen again.

import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useState } from "react";

/**
 * Whether the screen the caller stands in is the one in front of its stack.
 * Note that it hears focus through `useFocusEffect` and keeps it in the
 * component that calls it, rather than the screen reading `useIsFocused`,
 * which draws the whole screen again on every change of focus, a measured
 * cause of slow taps (#9516). So only a small piece calls it, such as a dock
 * or a composer, and only that piece draws again.
 */
export function useFocusShown(): boolean {
  const navigation = useNavigation();
  const [shown, setShown] = useState(() => navigation.isFocused());

  useFocusEffect(
    useCallback(() => {
      setShown(true);

      return () => setShown(false);
    }, []),
  );

  return shown;
}
