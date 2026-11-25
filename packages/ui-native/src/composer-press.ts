// composer-press.ts -- what a press of a composer's Send does with its field: takes the words out of the field itself, hands them to the holder once, and lays back any the holder did not take.

/**
 * What a press that sends does with the words it took out of the field: it
 * sends exactly these, never a copy of the field it holds itself, and
 * answers whether it took them, as a send that goes, or one it holds to
 * send once a question is answered, does. Words it did not take, as a send
 * refused before it went, go back in the field ahead of anything typed
 * since; words a send that went hands back later, refused, are its own to
 * lay back.
 */
export type ComposerSend = (words: string) => boolean;

/**
 * Words a send took out of the field, its holder already told the field
 * stands empty: the Markdown, and `giveBack`, which lays them back where the
 * send did not take them, ahead of anything typed since. Note that the
 * holder is told the words are back in the same turn it was told the field
 * emptied, so no render ever stands between with a held file's marker gone,
 * which would let go of its file.
 */
export interface TakenWords {
  readonly words: string;
  readonly giveBack: () => void;
}

/** A field a press takes its words out of, in one step where every key lands, so a second take finds it empty. */
export interface TakingField {
  readonly take: () => Promise<TakenWords>;
}

/**
 * A press that sends the field's words: it takes them out of the field
 * itself, never from the copy the render it was pressed in holds
 * (`drawnWords`), which lags the field by every key typed while JavaScript
 * was busy, and hands them to `act`; words `act` did not take go back in
 * the field. Note that the field empties as it answers, so a second press
 * that reaches JavaScript with the first, before any render, takes nothing;
 * and a press made on Send drawn over words that finds the field empty does
 * nothing, since what it pressed for already went, where its holder would
 * read an empty field as an empty one pressed for its own sake, as Got it or
 * a Save that gives an edit up. A press drawn over an empty field still acts
 * on it.
 */
export async function pressSend(
  field: TakingField,
  drawnWords: string,
  act: ComposerSend,
): Promise<void> {
  const pressedOverWords = drawnWords.trim() !== "";
  const taken = await field.take();

  if (taken.words === "" && pressedOverWords) return;

  if (!act(taken.words)) taken.giveBack();
}
