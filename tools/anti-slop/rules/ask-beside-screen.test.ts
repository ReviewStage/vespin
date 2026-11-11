import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { askBesideScreenRule } from "./ask-beside-screen.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MOBILE_FILE = path.join(REPOSITORY_ROOT, "apps/mobile/src/screens/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function mobile(code: string): { code: string; filename: string } {
  return { code, filename: MOBILE_FILE };
}

tester.run("ask-beside-screen", askBesideScreenRule, {
  valid: [
    // An ask and a sheet stand beside the screen's host, in the fragment it returns.
    mobile(
      "function A() { return <><Screen><RowList /></Screen><StatusQuestionAsk question={q} />{remind.sheet}</>; }",
    ),
    // What the screen draws inside is its content, whatever it reads off a hook, a task's rows among it.
    mobile(
      "function A() { return <Screen>{page.body}<Rows task={task} onAsk={() => openAsk(sheet)} /></Screen>; }",
    ),
    // A scalar of an ask, such as whether one stands open, draws no ask.
    mobile("function A() { return <Screen><Rows disabled={Boolean(remind.sheet)} /></Screen>; }"),
  ],
  invalid: [
    {
      code: "function A() { return <Screen><RowList /><StatusQuestionAsk question={q} /></Screen>; }",
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: "StatusQuestionAsk" } }],
    },
    {
      code: "function A() { return <Screen>{open ? <Rows /> : <Empty />}{remind.sheet}</Screen>; }",
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: ".sheet" } }],
    },
    {
      code: "function A() { return <Screen><SplitView />{asking && <ConfirmAsk presented />}</Screen>; }",
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: "ConfirmAsk" } }],
    },
    {
      code: "function A() { return <Screen><SplitView detail={<ConfirmAsk presented />} /></Screen>; }",
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: "ConfirmAsk" } }],
    },
    {
      code: 'function A() { return <Screen>{[<ConfirmAsk key="confirm" presented />]}</Screen>; }',
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: "ConfirmAsk" } }],
    },
    {
      code: "function A() { return <Screen><SplitView {...sidebar.columns({ view: <>{archive.ask}</> })} /></Screen>; }",
      filename: MOBILE_FILE,
      errors: [{ messageId: "insideScreen", data: { name: ".ask" } }],
    },
    {
      code: "function A() { return <Screen>{remind?.sheet}{statusAsk as ReactNode}</Screen>; }",
      filename: MOBILE_FILE,
      errors: [
        { messageId: "insideScreen", data: { name: ".sheet" } },
        { messageId: "insideScreen", data: { name: "statusAsk" } },
      ],
    },
  ],
});
