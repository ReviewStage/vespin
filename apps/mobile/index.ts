// index.ts -- the app's entry: crash reports started first, then the background push task defined before expo-router loads the screens, since a background launch runs the bundle for the task alone.

import "./src/perf-probe.js";
// What Hermes lacks is filled in before the crash reports' imports load, since they name the host's.
import "./src/host/polyfills.js";
import "./src/crash-reports.js";
import "./src/notification-task.js";
import "expo-router/entry";
