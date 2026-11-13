import { eslintCompatPlugin } from "@oxlint/plugins";

import { agentBoxReadsAgentRule } from "./rules/agent-box-reads-agent.ts";
import { archiveThroughAgentChangeRule } from "./rules/archive-through-agent-change.ts";
import { askBesideScreenRule } from "./rules/ask-beside-screen.ts";
import { asyncPressNeedsBusyRule } from "./rules/async-press-needs-busy.ts";
import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noBrowserFormValidationRule } from "./rules/no-browser-form-validation.ts";
import { noDirectViewStorageRule } from "./rules/no-direct-view-storage.ts";
import { noDocumentPressListenerRule } from "./rules/no-document-press-listener.ts";
import { noFocusedOrSkippedTestRule } from "./rules/no-focused-or-skipped-test.ts";
import { noFollowOutsideHostReadRule } from "./rules/no-follow-outside-host-read.ts";
import { noHandWrittenArrowKeysRule } from "./rules/no-hand-written-arrow-keys.ts";
import { noHandWrittenLiveRegionRule } from "./rules/no-hand-written-live-region.ts";
import { noLucideOutsideDoorRule } from "./rules/no-lucide-outside-door.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noOpenPageFromButtonRule } from "./rules/no-open-page-from-button.ts";
import { noPlaceholderEllipsisRule } from "./rules/no-placeholder-ellipsis.ts";
import { noProductNameRule } from "./rules/no-product-name.ts";
import { noRawHeadingOutsideUiRule } from "./rules/no-raw-heading-outside-ui.ts";
import { noRawPressOutsideUiRule } from "./rules/no-raw-press-outside-ui.ts";
import { noRawPressOutsideUiNativeRule } from "./rules/no-raw-press-outside-ui-native.ts";
import { noReducedMotionQueryRule } from "./rules/no-reduced-motion-query.ts";
import { noShadcnFocusRingRule } from "./rules/no-shadcn-focus-ring.ts";
import { noShortcutFlagRule } from "./rules/no-shortcut-flag.ts";
import { noSourceReadInTestRule } from "./rules/no-source-read-in-test.ts";
import { oneMessageBoxRule } from "./rules/one-message-box.ts";
import { retiredRule } from "./rules/retired.ts";
import { rowBehaviorInRowRule } from "./rules/row-behavior-in-row.ts";
import { sandboxDeleteInOnePlaceRule } from "./rules/sandbox-delete-in-one-place.ts";
import { settingsRowEndRule } from "./rules/settings-row-end.ts";
import { settingsSectionDeclaredRule } from "./rules/settings-section-declared.ts";
import { skeletonThroughComponentsRule } from "./rules/skeleton-through-components.ts";

/**
 * Oxlint rules that catch code or tests that silently do nothing or wipe data,
 * and the design system's guards against controls and headings built outside `@repo/ui`, and the iOS app's against controls built outside `@repo/ui-native` and an ask drawn inside a screen's host,
 * forms the browser checks with its own bubble, loading skeletons that copy the surface they stand for, buttons that wait on a press without saying so, buttons that open a page, placeholders that end in an ellipsis,
 * popovers that close on a press through a listener of their own, view choices stored by hand rather than through `useKept`, a follow
 * opened beside the live reads' queries, a vendored
 * shadcn component hiding the keyboard's ring, a script asking the OS whether to move rather than the motion tokens, a settings row's ⋯ or chevron standing among the controls that drop below its words, a box writing to a started agent reading that agent outside `useAgentBox`, a page handing a shared row the menu, rename, selection or state its row component builds, a menu item's key printed by a flag of its caller's rather than the shortcut target, an agent archived or brought back outside `agents/agent-change.ts`, an agent's sandbox deleted anywhere but the one place that owns deleting it, and the classes, glyphs and patterns phase 2 retired coming back; and the testing policy's
 * guards against a test that mocks a module of this repository, runs less than it declares, or reads source text.
 */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "vespin" },
  rules: {
    "agent-box-reads-agent": agentBoxReadsAgentRule,
    "archive-through-agent-change": archiveThroughAgentChangeRule,
    "ask-beside-screen": askBesideScreenRule,
    "async-press-needs-busy": asyncPressNeedsBusyRule,
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-browser-form-validation": noBrowserFormValidationRule,
    "no-direct-view-storage": noDirectViewStorageRule,
    "no-document-press-listener": noDocumentPressListenerRule,
    "no-focused-or-skipped-test": noFocusedOrSkippedTestRule,
    "no-follow-outside-host-read": noFollowOutsideHostReadRule,
    "no-hand-written-arrow-keys": noHandWrittenArrowKeysRule,
    "no-hand-written-live-region": noHandWrittenLiveRegionRule,
    "no-lucide-outside-door": noLucideOutsideDoorRule,
    "no-node-test": noNodeTestRule,
    "no-open-page-from-button": noOpenPageFromButtonRule,
    "no-placeholder-ellipsis": noPlaceholderEllipsisRule,
    "no-product-name": noProductNameRule,
    "no-raw-heading-outside-ui": noRawHeadingOutsideUiRule,
    "no-raw-press-outside-ui": noRawPressOutsideUiRule,
    "no-raw-press-outside-ui-native": noRawPressOutsideUiNativeRule,
    "no-reduced-motion-query": noReducedMotionQueryRule,
    "no-shadcn-focus-ring": noShadcnFocusRingRule,
    "no-shortcut-flag": noShortcutFlagRule,
    "no-source-read-in-test": noSourceReadInTestRule,
    "one-message-box": oneMessageBoxRule,
    retired: retiredRule,
    "row-behavior-in-row": rowBehaviorInRowRule,
    "sandbox-delete-in-one-place": sandboxDeleteInOnePlaceRule,
    "settings-row-end": settingsRowEndRule,
    "settings-section-declared": settingsSectionDeclaredRule,
    "skeleton-through-components": skeletonThroughComponentsRule,
  },
});

export default antiSlopPlugin;
