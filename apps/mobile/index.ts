// index.ts -- the app's entry: the background push task defined before expo-router loads the screens, since a background launch runs the bundle for the task alone.

import "./src/notification-task.js";
import "expo-router/entry";
