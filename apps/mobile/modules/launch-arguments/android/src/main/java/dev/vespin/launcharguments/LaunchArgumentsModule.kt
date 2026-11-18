// LaunchArgumentsModule.kt -- the launch intent's extras as JavaScript reads them, which is how Maestro's `launchApp` arguments and `adb shell am start -e` reach the Android app.
//
// iOS registers a launch's `-key value` arguments in the app's defaults,
// which React Native's `Settings` reads; Android has no such domain, so a
// flow's arguments arrive as extras on the intent that started the activity
// (`src/host/launch-arguments.ts`). Each extra is answered as the type it was
// put as, a text, a truth value, or a number, and any other kind is left out.

package dev.vespin.launcharguments

import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LaunchArgumentsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LaunchArguments")

    // The extras of the intent the activity was started with; none before an activity stands.
    Function("read") {
      val extras = appContext.currentActivity?.intent?.extras ?: return@Function emptyMap<String, Any>()

      extras.keySet().mapNotNull { key -> readable(extras, key)?.let { key to it } }.toMap()
    }
  }

  // An extra as JavaScript can take it; none for a kind it cannot.
  @Suppress("DEPRECATION")
  private fun readable(extras: Bundle, key: String): Any? =
    when (val value = extras.get(key)) {
      is String, is Boolean, is Int, is Long, is Double -> value
      is Float -> value.toDouble()
      else -> null
    }
}
