// index.tsx -- the app's root URL, which opens on the Inbox tab.

import { Redirect } from "expo-router";

export default function RootIndex() {
  return <Redirect href="/inbox" />;
}
