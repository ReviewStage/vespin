// WorkingMark.swift -- the mark an agent at work wears, drawn and stepped by SwiftUI on the system's own clock, and the bob a working Manager's face rises and falls on in the same time, so no JavaScript timer or render keeps either moving.
//
// `@repo/ui-native`'s `WorkingMark` hands `WorkingMarkView` the mark's look,
// sized by `mark-look.ts`, and whether the reader reduces motion; the long
// press preview draws the same grid from its data (`RowMenu.swift`). Each
// mark reads its step off the date, so every mark on screen steps together,
// as the panel's marks share one beat, and a mark scrolled out of sight
// stops, as `TimelineView` does. `ManagerFace` hands its picture
// `WorkingBobModifier` the same way, half the mark's lap up and half down.

import ExpoModulesCore
import ExpoUI
import SwiftUI

/// How long a step of the working beat lasts: the panel's 200 ms.
private let workingBeat: TimeInterval = 0.2

/// One pixel that moves: a chaser or the fainter tail one cell behind it, with the track cell it rests on when still and steps on from.
struct WorkingGridDot {
  let restsOn: Int
  let tail: Bool
}

/// How faint the track's cells, a chaser's tail, and a chaser stand.
struct WorkingGridShades {
  let track: Double
  let tail: Double
  let lead: Double
}

/// The panel's working mark: two pixels chasing round the edge of a 3×3 grid, each tailed by a fainter one, over the faint track, stepping a cell each beat; held on its resting frame where it stands still.
struct WorkingGrid: View {
  let ink: Color
  let side: CGFloat
  let cell: CGFloat
  let pitch: CGFloat
  let inset: CGFloat
  let track: [[Int]]
  let dots: [WorkingGridDot]
  let shades: WorkingGridShades
  let still: Bool

  var body: some View {
    if still {
      grid(beat: 0)
    } else {
      TimelineView(.periodic(from: .now, by: workingBeat)) { context in
        grid(beat: Int(context.date.timeIntervalSinceReferenceDate / workingBeat))
      }
    }
  }

  private func grid(beat: Int) -> some View {
    ZStack(alignment: .topLeading) {
      ForEach(Array(track.indices), id: \.self) { index in
        square(index, shade: shades.track)
      }
      ForEach(Array(dots.enumerated()), id: \.offset) { _, dot in
        square(dot.restsOn + beat, shade: dot.tail ? shades.tail : shades.lead)
      }
    }
    .frame(width: side, height: side, alignment: .topLeading)
  }

  private func square(_ index: Int, shade: Double) -> some View {
    let at = track.isEmpty ? [0, 0] : track[index % track.count]
    return RoundedRectangle(cornerRadius: cell / 4)
      .frame(width: cell, height: cell)
      .foregroundStyle(ink)
      .opacity(shade)
      .offset(x: inset + CGFloat(at[0]) * pitch, y: inset + CGFloat(at[1]) * pitch)
  }
}

/// A moving pixel as JavaScript hands it.
struct WorkingDotRecord: Record {
  @Field var restsOn: Int = 0
  @Field var tail: Bool = false
}

/// The shades as JavaScript hands them.
struct WorkingShadesRecord: Record {
  @Field var track: Double = 0
  @Field var tail: Double = 0
  @Field var lead: Double = 0
}

/// The mark's look as `mark-look.ts` sizes it, its ink as the brand's table writes it, and whether it stands still, as where the reader reduces motion.
final class WorkingMarkViewProps: UIBaseViewProps {
  @Field var ink: String = ""
  @Field var side: CGFloat = 0
  @Field var cell: CGFloat = 0
  @Field var pitch: CGFloat = 0
  @Field var inset: CGFloat = 0
  @Field var track: [[Int]] = []
  @Field var dots: [WorkingDotRecord] = []
  @Field var shades: WorkingShadesRecord = WorkingShadesRecord()
  @Field var still: Bool = false
}

/// The working mark as `@repo/ui-native`'s `WorkingMark` draws it, standing inside @expo/ui's views as one of its own, its modifiers applied as theirs are.
struct WorkingMarkView: ExpoSwiftUI.View {
  @ObservedObject var props: WorkingMarkViewProps

  init(props: WorkingMarkViewProps) {
    self.props = props
  }

  var body: some View {
    WorkingGrid(
      ink: Color(vespinHex: props.ink),
      side: props.side,
      cell: props.cell,
      pitch: props.pitch,
      inset: props.inset,
      track: props.track,
      dots: props.dots.map { WorkingGridDot(restsOn: $0.restsOn, tail: $0.tail) },
      shades: WorkingGridShades(track: props.shades.track, tail: props.shades.tail, lead: props.shades.lead),
      still: props.still
    )
  }
}

/// A working Manager's face rising by `height` and falling back, each in `seconds` and eased by SwiftUI, read off the date so it keeps time with the marks beside it.
internal struct WorkingBobModifier: ViewModifier, Record {
  @Field var height: CGFloat = 0
  @Field var seconds: Double = 0.8

  func body(content: Content) -> some View {
    // Note that a period too short to read is held at a frame's length, so the date is never divided by nothing.
    let period = max(seconds, 1.0 / 60)
    TimelineView(.periodic(from: .now, by: period)) { context in
      let risen = Int(context.date.timeIntervalSinceReferenceDate / period) % 2 == 0
      content
        .offset(y: risen ? -height : 0)
        .animation(.easeInOut(duration: period), value: risen)
    }
  }
}
