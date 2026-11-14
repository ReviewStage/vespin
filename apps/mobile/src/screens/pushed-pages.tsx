// pushed-pages.tsx -- each page a place pushes over its split view's detail, drawn by the same screen a compact window pushes over the window, in its column form.

import { PUSHED_PAGE, type PushedPage } from "../detail-stack.js";
import { AgentConversation, AgentPage } from "./agent-screens.js";
import { CommentThread, NewComment } from "./comment-screens.js";
import { History, Version } from "./history-screens.js";
import { TaskPage } from "./page-screens.js";
import { PullRequestPage } from "./pull-request-screens.js";
import { TaskColumnPage } from "./task-screens.js";

/** One page pushed over a split view's detail, as its kind draws it in a column. */
export function PushedPageView({ page }: { readonly page: PushedPage }) {
  switch (page.kind) {
    case PUSHED_PAGE.TASK:
      return <TaskColumnPage taskId={page.taskId} />;
    case PUSHED_PAGE.AGENT:
      return (
        <AgentConversation
          id={page.agentId}
          suggestedBy={page.suggestedBy}
          button={page.button}
          inColumn
        />
      );
    case PUSHED_PAGE.PULL_REQUEST:
      return <PullRequestPage agentId={page.agentId} number={page.number} inColumn />;
    case PUSHED_PAGE.AGENT_PAGE:
      return (
        <AgentPage
          agentId={page.agentId}
          pageId={page.pageId}
          version={page.version}
          title={page.title}
          inColumn
        />
      );
    case PUSHED_PAGE.TASK_PAGE:
      return (
        <TaskPage
          pageId={page.pageId}
          taskId={page.taskId}
          workspaceId={page.workspaceId}
          version={page.version}
          title={page.title}
          inColumn
        />
      );
    case PUSHED_PAGE.COMMENTS:
      return <CommentThread threadId={page.threadId} taskId={page.taskId} inColumn />;
    case PUSHED_PAGE.NEW_COMMENT:
      return (
        <NewComment
          taskId={page.taskId}
          from={page.from}
          to={page.to}
          quote={page.quote}
          inColumn
        />
      );
    case PUSHED_PAGE.HISTORY:
      return <History taskId={page.taskId} inColumn />;
    case PUSHED_PAGE.VERSION:
      return (
        <Version taskId={page.taskId} seq={page.seq} at={page.at} newest={page.newest} inColumn />
      );
  }
}
