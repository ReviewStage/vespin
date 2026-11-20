# maestro-audit -- recordings for the native-feel audit (STAG-3729); not run by CI or simulator-screenshots.sh.

Each flow records one short MP4 (`startRecording`) of a motion a still
cannot show: a push and the back swipe, a row's swipes and long press, a
sheet's drag, the keyboard in a composer, pull to refresh, a large title and
the tab bar collapsing, Search, Settings, and the agent page. Run each with
`maestro --udid <udid> test --env FLOATING_TABS=<true on an iPad> <flow>` from
this directory, in the light appearance and the dark. Every tap past the
launch is optional, so a recording runs to its end on any window.
