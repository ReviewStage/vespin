// ShareGate.swift -- the share extension's measure of itself, logged for the memory and launch gate the React Native sheet must pass: its peak physical footprint and its cold start, from the process's launch to the page's first frame.
//
// iOS ends a share extension that outgrows its memory limit, so the sheet
// samples its own footprint (`TASK_VM_INFO`'s `phys_footprint`, the number
// the limit is held to) every quarter second while it stands, keeping the
// peak, and logs it as the sheet ends and three seconds after its first
// frame, the moment the rig's own measure stops. The cold start is counted
// from the process's start, which the system's share sheet launches it at on
// a tap, to the first frame the page tells it it drew. Both go to the unified
// log under the subsystem `dev.vespin.ios.share` as public numbers and
// nothing else, so the log carries nothing of what was shared or who shared
// it, and never a token.

import Darwin
import Foundation
import os

final class ShareGate {
  private let logger = Logger(subsystem: "dev.vespin.ios.share", category: "gate")
  /// How often the footprint is sampled, and how long after the first frame its peak is logged.
  private static let interval: TimeInterval = 0.25
  private static let settle: TimeInterval = 3
  private var timer: Timer?
  private var peak: UInt64 = 0
  private var drawnOnce = false
  private var ended = false

  /// Starts sampling the footprint.
  func start() {
    sample()
    let timer = Timer(timeInterval: Self.interval, repeats: true) { [weak self] _ in self?.sample() }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
  }

  /// Logs the cold start once, at the page's first frame, and the peak so far three seconds on.
  func drawn() {
    guard !drawnOnce else { return }
    drawnOnce = true
    if let started = Self.processStart() {
      let milliseconds = Int((Date().timeIntervalSince1970 - started) * 1000)
      logger.log("cold start \(milliseconds, privacy: .public) ms")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle) { [weak self] in
      self?.logPeak(at: "settled")
    }
  }

  /// Stops sampling and logs the peak the sheet reached.
  func end() {
    guard !ended else { return }
    ended = true
    timer?.invalidate()
    timer = nil
    sample()
    logPeak(at: "end")
  }

  private func logPeak(at moment: String) {
    let megabytes = Double(peak) / 1_048_576
    logger.log(
      "peak footprint \(megabytes, format: .fixed(precision: 1), privacy: .public) MB at \(moment, privacy: .public)"
    )
  }

  private func sample() {
    guard let now = Self.footprint() else { return }
    peak = max(peak, now.current, now.peak)
  }

  /// The process's physical footprint now, and the kernel's own peak of it, in bytes.
  private static func footprint() -> (current: UInt64, peak: UInt64)? {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard result == KERN_SUCCESS else { return nil }
    return (info.phys_footprint, UInt64(max(0, info.ledger_phys_footprint_peak)))
  }

  /// When the process started, in seconds since 1970, as the kernel keeps it.
  private static func processStart() -> TimeInterval? {
    var process = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&name, u_int(name.count), &process, &size, nil, 0) == 0 else { return nil }
    let started = process.kp_proc.p_un.__p_starttime
    return TimeInterval(started.tv_sec) + TimeInterval(started.tv_usec) / 1_000_000
  }
}
