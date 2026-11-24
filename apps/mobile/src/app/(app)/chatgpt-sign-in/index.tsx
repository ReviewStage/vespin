// index.tsx -- a Codex plan connected through ChatGPT's sign-in, as a sheet over Settings › Agents or setup's Connect an agent.

import { ChatGptSignIn } from "../../../agent-keys/chatgpt-sign-in.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function ChatGptSignInRoute() {
  return <ChatGptSignIn />;
}
