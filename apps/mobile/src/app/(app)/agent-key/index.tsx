// index.tsx -- a Claude token or an API key pasted, as a sheet over Settings › Agents or setup's Connect an agent, by the provider and kind its route names.

import { HARNESSES } from "@repo/features/agent-credentials-model";
import { Redirect, useLocalSearchParams } from "expo-router";
import { AgentKeyPaste } from "../../../agent-keys/agent-key-paste.js";
import { PASTE_KIND } from "../../../agent-keys/agent-keys.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function AgentKeyRoute() {
  const { provider = "", kind = "" } = useLocalSearchParams<{ provider: string; kind: string }>();
  const harness = HARNESSES.find((one) => one === provider);
  const paste = Object.values(PASTE_KIND).find((one) => one === kind);

  // Note that a route naming no harness the phone draws, as a stale link might, goes back to the app rather than drawing a sheet for nothing.
  if (harness === undefined || paste === undefined) return <Redirect href="/" />;

  return <AgentKeyPaste provider={harness} kind={paste} />;
}
