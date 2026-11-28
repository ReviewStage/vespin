// share-page-screen.tsx -- the share page's scratch page, which a launch opens on (`-sharePage true`) so a flow shoots the page on synthetic places and a synthetic share.

import { useState } from "react";
import { SharePage } from "../share/share-page.js";
import {
  FIXTURE_DESTINATIONS,
  FIXTURE_SHARED_PICTURES,
  FIXTURE_SHARED_WORDS,
} from "../share/share-page-fixture.js";
import { usePillField } from "../use-pill-field.js";

/** The share page over the fixture's places, its field laid in with the fixture's shared link and screenshot; its Send and ✕ go nowhere. */
export function SharePageScreen() {
  const [words, setWords] = useState(FIXTURE_SHARED_WORDS);
  const [attached, setAttached] = useState(FIXTURE_SHARED_PICTURES);

  const field = usePillField(words, setWords, {
    attached,
    detach: (id) => setAttached((now) => now.filter((each) => each.id !== id)),
  });

  return (
    <SharePage
      destinations={FIXTURE_DESTINATIONS}
      words={words}
      onWords={setWords}
      pills={field.pills}
      holdsPictures={attached.length > 0}
      onSend={() => false}
      onCancel={() => undefined}
    />
  );
}
