import {
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  CopyField,
  OutsideLink,
  OutsideSteps,
  PasteSteps,
  STEP_STATE,
  Step,
  Steps,
} from "@repo/ui";
import { inputProblem } from "@repo/ui/reported-failure";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * steps.tsx -- a setup told as numbered steps: one to do now beside one still
 * to come, and the first done, its number turned to the check, the second
 * the one to do now; steps done outside the app with the wait under them;
 * and a key got elsewhere and pasted, its link to the page outside.
 */

/** The catalog opens no pages: the link's press goes nowhere. */
const openNowhere = (): void => undefined;

/** A key's two steps, the paste held here and refused unless it starts as a key does. */
function PasteExample(): React.JSX.Element {
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState(false);
  return (
    <PasteSteps
      first={{
        title: "Create an API key",
        body: (done) => (
          <OutsideLink href="https://example.com/keys" open={openNowhere} onOpened={done}>
            Open the console
          </OutsideLink>
        ),
      }}
      label="Paste the key"
      placeholder="sk-…"
      error={refused ? inputProblem("That isn't a key. Check it and try again.") : undefined}
      value={value}
      onChange={(next) => {
        setValue(next);
        setRefused(false);
      }}
      onSave={(pasted) => setRefused(!pasted.startsWith("sk-"))}
    />
  );
}

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

function StepsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="steps-start" title="The first to do now">
        <Steps>
          <Step number={1} title="Run this in a terminal" state={STEP_STATE.CURRENT}>
            <CopyField
              label="Setup-token command"
              value="claude setup-token"
              what="command"
              copy={copyToClipboard}
              width={COPY_FIELD_WIDTH.FULL}
              prompt={COPY_FIELD_PROMPT.SHELL}
            />
          </Step>
          <Step number={2} title="Paste the token it prints" state={STEP_STATE.TO_DO} />
        </Steps>
      </CatalogSection>
      <CatalogSection id="steps-done" title="The first done">
        <Steps>
          <Step number={1} title="Run this in a terminal" state={STEP_STATE.DONE} />
          <Step number={2} title="Paste the token it prints" state={STEP_STATE.CURRENT} />
        </Steps>
      </CatalogSection>
      <CatalogSection id="steps-outside" title="Done outside the app, and the wait">
        <OutsideSteps waiting="Waiting for a host to join">
          <Step number={1} title="Run this on a Mac or Linux server" state={STEP_STATE.CURRENT}>
            <CopyField
              label="Install command"
              value="curl -fsSL https://example.com/install.sh | sh"
              what="command"
              copy={copyToClipboard}
              width={COPY_FIELD_WIDTH.FULL}
              prompt={COPY_FIELD_PROMPT.SHELL}
            />
          </Step>
          <Step
            number={2}
            title="Open the link it prints, and approve its code"
            state={STEP_STATE.CURRENT}
          />
        </OutsideSteps>
      </CatalogSection>
      <CatalogSection id="steps-paste" title="A key got elsewhere and pasted">
        <PasteExample />
      </CatalogSection>
    </>
  );
}

export const STEPS_EXAMPLE: Example = {
  id: "steps",
  title: "Steps",
  Render: StepsExample,
};
