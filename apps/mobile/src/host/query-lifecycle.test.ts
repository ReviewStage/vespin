// query-lifecycle.test.ts -- native foreground and connectivity drive active queries.

import { focusManager, onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AppStateStatus } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { followQueryLifecycle } from "./query-lifecycle.js";

const appListeners = new Set<(status: AppStateStatus) => void>();
const networkListeners = new Set<(online: boolean) => void>();
let stop: () => void;
let client: QueryClient;
let unsubscribe: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.mount();
  stop = followQueryLifecycle(
    {
      addEventListener: (_event, listener) => {
        appListeners.add(listener);

        return {
          remove: () => {
            appListeners.delete(listener);
          },
        };
      },
    },
    (listener) => {
      networkListeners.add(listener);

      return () => {
        networkListeners.delete(listener);
      };
    },
  );
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  client.unmount();
  client.clear();
  stop();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

it("refetches an active stale query after background then active", async () => {
  let serverValue = "before background";

  const observer = new QueryObserver(client, {
    queryKey: ["foreground"],
    queryFn: async () => serverValue,
  });

  unsubscribe = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(1);
  expect(observer.getCurrentResult().data).toBe("before background");

  for (const listener of appListeners) listener("background");
  serverValue = "after foreground";

  for (const listener of appListeners) listener("active");
  await vi.advanceTimersByTimeAsync(1);

  expect(observer.getCurrentResult().data).toBe("after foreground");
});

it("pauses a query offline and resumes it when the network reconnects", async () => {
  for (const listener of networkListeners) listener(false);

  const observer = new QueryObserver(client, {
    queryKey: ["connectivity"],
    queryFn: async () => "reconnected",
  });

  unsubscribe = observer.subscribe(() => {});
  expect(observer.getCurrentResult().fetchStatus).toBe("paused");

  for (const listener of networkListeners) listener(true);
  await vi.advanceTimersByTimeAsync(1);

  expect(observer.getCurrentResult().data).toBe("reconnected");
  expect(observer.getCurrentResult().fetchStatus).toBe("idle");
});
