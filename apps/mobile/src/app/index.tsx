// index.tsx -- the app's root URL, which opens on the Inbox tab, or on the agent a launch names (`-agent <id>`).

import { Redirect } from "expo-router";
import { launchAgent } from "../host/launch-arguments.js";

export default function RootIndex() {
  const agent = launchAgent();
  return (
    <Redirect href={agent === undefined ? "/inbox" : `/tasks/agent/${encodeURIComponent(agent)}`} />
  );
}
