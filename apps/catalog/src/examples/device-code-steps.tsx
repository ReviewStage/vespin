import {
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  COPY_FIELD_WIDTH,
  CopyField,
  ErrorLine,
  GAP,
  Inline,
  STEP_STATE,
  Stack,
  Step,
  Steps,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WaitingLine,
} from "@repo/ui";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * device-code-steps.tsx -- a code entered on another site, said as the
 * steps a pasted key's are said in (a hint, then a code to copy over a page
 * to open) and the wait on the other site under them, as a ChatGPT plan
 * connects under its row; and the same ended in a failure with Try again.
 * The catalog's copy act is the browser's own clipboard, and its presses go
 * nowhere.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const VERIFICATION_URL = "https://example.com/device";

/** The refusal an ended login says. */
const EXPIRED = {
  words: "The code expired before it was entered. Try again.",
  failure: CATALOG_FAILURE,
};

/** The two steps, and the wait under them. */
function CodeSteps(): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      <Steps>
        <Step
          number={1}
          title="Turn on device codes in your account's security settings"
          state={STEP_STATE.CURRENT}
        >
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            If you don't see this option, ask your workspace admin to turn it on
          </Text>
        </Step>
        <Step number={2} title="Sign in and enter the code:" state={STEP_STATE.CURRENT}>
          <CopyField
            label="Code"
            value="225Q-1343X"
            what="code"
            copy={copyToClipboard}
            width={COPY_FIELD_WIDTH.HUG}
          />
          <Inline>
            <ButtonLink href={VERIFICATION_URL} variant={BUTTON_VARIANT.OUTLINE} external>
              Verification page
            </ButtonLink>
          </Inline>
        </Step>
      </Steps>
      <WaitingLine>Waiting for the other site</WaitingLine>
    </Stack>
  );
}

function DeviceCodeSteps(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="device-code-waiting" title="The steps, and the wait under them">
        <CodeSteps />
      </CatalogSection>
      <CatalogSection id="device-code-failed" title="Ended, with Try again">
        <Stack gap={GAP.CONTROL}>
          <ErrorLine error={EXPIRED} />
          <Inline>
            <Button variant={BUTTON_VARIANT.PRIMARY}>Try again</Button>
          </Inline>
        </Stack>
      </CatalogSection>
    </>
  );
}

export const DEVICE_CODE_STEPS_EXAMPLE: Example = {
  id: "device-code-steps",
  title: "Device code steps",
  Render: DeviceCodeSteps,
};
