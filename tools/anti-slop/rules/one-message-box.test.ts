import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { BOX_BUILDERS } from "../shared/message-box-guard.ts";
import { oneMessageBoxRule } from "./one-message-box.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PAGE_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example-box.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example-box.test.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");
const BUILDER_FILE = path.join(REPOSITORY_ROOT, Object.keys(BOX_BUILDERS)[0] ?? "");

const FIELD = 'import { ComposerField } from "./composer-field.js";\n';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function page(code: string): { code: string; filename: string } {
  return { code, filename: PAGE_FILE };
}

tester.run("one-message-box", oneMessageBoxRule, {
  valid: [
    // A box drawn on the message box.
    page('import { MessageBox, useMessageBox } from "./message-box.js";'),
    // The message box itself, the design system that defines the parts, and a test build with them.
    { code: FIELD, filename: BUILDER_FILE },
    {
      code: 'import { ComposerFoot } from "../composer-frame/composer-foot.js";',
      filename: UI_FILE,
    },
    { code: FIELD, filename: TEST_FILE },
    // A name the parts share from another module is no part: the landing page's own field.
    page('import { ComposerField } from "./landing-field.js";'),
    // The card's placeholder, which a skeleton draws, is no part.
    page('import { PromptInputCard } from "../ai-elements/prompt-input.js";'),
  ],
  invalid: [
    { ...page(FIELD), errors: [{ messageId: "partOutsideBox", data: { part: "ComposerField" } }] },
    {
      ...page('import { ComposerFoot as Foot, Button } from "@repo/ui";'),
      errors: [{ messageId: "partOutsideBox", data: { part: "ComposerFoot" } }],
    },
    {
      ...page('import { useComposerPickers } from "../tasks/composer-pickers.js";'),
      errors: [{ messageId: "partOutsideBox", data: { part: "useComposerPickers" } }],
    },
    // A namespace is no way around it.
    {
      ...page('import * as ui from "@repo/ui";\nfunction A() { return <ui.ComposerBody />; }'),
      errors: [{ messageId: "partOutsideBox", data: { part: "ComposerBody" } }],
    },
    {
      ...page(
        'import * as card from "../ai-elements/prompt-input.js";\nconst P = card.PromptInput;',
      ),
      errors: [{ messageId: "partOutsideBox", data: { part: "PromptInput" } }],
    },
  ],
});
