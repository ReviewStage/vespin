// thread-panel.test.ts -- an iPad's open thread handed from the inspector to a pushed page as its split view collapses, and back as it expands, its draft kept.

import {
  collapseThreadPanel,
  expandThreadPanel,
  openPanelThread,
  threadPanelStart,
} from "@repo/ui-native/thread-panel-model";
import { describe, expect, it } from "vitest";
import { keepDraft, keptDraft } from "./agents/composer-drafts.js";

const THREAD = { agentId: "manager-1", root: "message-7", tab: "tasks" } as const;

describe("thread panel", () => {
  it("pushes the open thread as the split view collapses and hands it back as it expands, its draft kept", () => {
    keepDraft(THREAD.agentId, THREAD.root, { words: "Half a reply", laidFor: undefined });

    const opened = openPanelThread(threadPanelStart(false), THREAD);
    expect(opened.push).toBeUndefined();
    expect(opened.state.open).toEqual(THREAD);

    const collapsed = collapseThreadPanel(opened.state);
    expect(collapsed.state.open).toBeUndefined();
    expect(collapsed.push).toEqual({
      pathname: "/(tasks)/tasks/agent/[id]/thread/[root]",
      params: { id: "manager-1", root: "message-7" },
    });
    expect(keptDraft(collapsed.push?.params.id ?? "", collapsed.push?.params.root)?.words).toBe(
      "Half a reply",
    );

    // The pushed page stands at its own address, as the router names it once pushed.
    const expanded = expandThreadPanel(collapsed.state, {
      pathname: "/tasks/agent/manager-1/thread/message-7",
      tab: "tasks",
    });

    expect(expanded.pop).toBe(true);
    expect(expanded.state.open).toEqual(THREAD);
    expect(keptDraft(expanded.state.open?.agentId ?? "", expanded.state.open?.root)?.words).toBe(
      "Half a reply",
    );
  });

  it("leaves a page that is no thread where it stands as the split view expands", () => {
    const expanded = expandThreadPanel(threadPanelStart(true), {
      pathname: "/tasks/agent/manager-1/page",
      tab: "tasks",
    });

    expect(expanded.pop).toBe(false);
    expect(expanded.state).toEqual({ open: undefined, collapsed: false });
  });
});
