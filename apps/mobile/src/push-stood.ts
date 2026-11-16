// push-stood.ts -- whether a pushed screen has finished coming in, so a write that redraws the list it was pushed from waits for the push to end.

import { type NativeStackNavigationProp, useNavigation } from "expo-router";
import { useEffect, useState } from "react";

/**
 * Whether the screen this is drawn in has finished coming in: false while
 * its push's transition runs, and true once the stack says it ended, for
 * good. Note that the stack ends a transition on a screen it shows with no
 * animation too, such as a link's first page, so every screen comes to
 * stand. A write that moves the list under a push, such as the read an
 * opened task sends, waits for it, because the list redrawn while the push
 * ran left the iPhone's task page unpushed.
 */
export function usePushStood(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const [stood, setStood] = useState(false);

  useEffect(
    () =>
      navigation.addListener("transitionEnd", (event) => {
        if (!event.data.closing) setStood(true);
      }),
    [navigation],
  );

  return stood;
}
