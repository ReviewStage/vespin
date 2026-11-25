#!/usr/bin/env bash
# pr-chip-scroll.sh -- a rig check, never in the screenshot run: a drag that starts on a pull request's chip inside a message still scrolls the thread. Usage: pr-chip-scroll.sh <output dir>, with the app installed on the booted simulator.
#
# Note that the chip stands in its line's words, where it is no element of
# its own, so no flow can start a swipe on it by name: the script reads the
# line's bounds from the screen's tree, starts the drag 6% in from the line's
# leading edge at its middle (where `pr-chip-preview.yaml` holds the chip),
# and reads the line's place again after it, printing how far it moved.
set -euo pipefail
out="${1:?output dir}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"
line_bounds() {
  maestro hierarchy 2>/dev/null | python3 -I -c '
import json, re, sys
tree = json.load(sys.stdin)
def walk(node):
    attributes = node.get("attributes", {})
    words = " ".join(str(attributes.get(key, "")) for key in ("text", "accessibilityText", "hintText"))
    if "is ready for review" in words and attributes.get("bounds"):
        found = [int(n) for n in re.findall(r"-?\d+", attributes["bounds"])]
        print(*found)
        sys.exit(0)
    for child in node.get("children", []):
        walk(child)
walk(tree)
sys.exit("the chip line is not on screen")
'
}
maestro test --test-output-dir "$out" "$here/pr-chip-scroll-start.yaml"
read -r x1 y1 x2 y2 < <(line_bounds)
x=$(( x1 + (x2 - x1) * 6 / 100 ))
y=$(( (y1 + y2) / 2 ))
end_y=$(( y - 300 ))
echo "chip line before: [$x1,$y1][$x2,$y2]; drag from $x,$y to $x,$end_y"
maestro test --test-output-dir "$out" -e START="$x, $y" -e END="$x, $end_y" "$here/pr-chip-scroll-drag.yaml"
if after=$(line_bounds); then
  read -r _ a1 _ a2 <<<"$after"
  echo "chip line after: y $a1..$a2, moved $(( (a1 + a2) / 2 - y )) pt"
else
  echo "chip line after: scrolled out of the window"
fi
