// devtools-hook-polyfill.js -- MEASUREMENT ONLY: React DevTools' global hook, set before any module so the renderer injects into it; each commit's rendered components go to global.__perfCommits, which src/perf-probe.ts drains.
((global) => {
  var commits = [];
  global.__perfCommits = commits;

  function nameOf(fiber) {
    var type = fiber.type;
    if (type == null || typeof type === "string") return undefined;
    if (typeof type === "function") return type.displayName || type.name || "anon";
    if (typeof type === "object") {
      var inner = type.render || type.type;
      return type.displayName || (inner && (inner.displayName || inner.name)) || "obj";
    }
    return undefined;
  }

  // The components whose renders are explained: which props moved by identity, or which hooks (by their place in the component's list), or neither (a context).
  var EXPLAIN = { InboxRowView: true };

  function why(fiber, old, into) {
    var reasons = [];
    var a = old.memoizedProps || {};
    var b = fiber.memoizedProps || {};
    for (var key in b) if (a[key] !== b[key]) reasons.push("prop:" + key);
    var h0 = old.memoizedState;
    var h1 = fiber.memoizedState;
    var i = 0;
    while (h0 && h1 && typeof h1 === "object" && "next" in h1) {
      if (h0.memoizedState !== h1.memoizedState) reasons.push("hook:" + i);
      h0 = h0.next;
      h1 = h1.next;
      i += 1;
    }
    if (reasons.length === 0) reasons.push("context");
    for (var r = 0; r < reasons.length; r += 1) into[reasons[r]] = (into[reasons[r]] || 0) + 1;
  }

  // Note that a fiber rendered this commit where it mounted or its props or state are new, the heuristic React DevTools uses; a subtree React bailed out of keeps its child objects and is skipped.
  function walk(root) {
    var counts = {};
    var times = {};
    var whys = {};
    var rendered = 0,
      mounted = 0,
      hosts = 0,
      total = 0;
    // Each fiber carries the context menu slot it stands under (Trigger, Items, Preview), so a row's cost is split by slot.
    var SLOTS = { Trigger: true, Items: true, Preview: true };
    var slotted = {};
    var stack = [root.current];
    var slotOf = new Map();
    slotOf.set(root.current, "none");
    while (stack.length > 0) {
      var fiber = stack.pop();
      var here = slotOf.get(fiber) || "none";
      var ownName = nameOf(fiber);
      if (ownName !== undefined && SLOTS[ownName]) here = ownName;
      total += 1;
      var old = fiber.alternate;
      var did =
        old === null ||
        old.memoizedProps !== fiber.memoizedProps ||
        old.memoizedState !== fiber.memoizedState;
      // Note that a memo component (fiber tags 14 and 15) that bailed out still takes a new props object from its parent, and keeps the last render's selfBaseDuration, so it would read as rendered at its old cost; one whose child React left in place did not render.
      if (did && old !== null && (fiber.tag === 14 || fiber.tag === 15) && fiber.child === old.child)
        did = false;
      if (did) {
        if (old === null) mounted += 1;
        if (here !== "none") {
          var key = (old === null ? "mounted:" : "rendered:") + here;
          slotted[key] = (slotted[key] || 0) + 1;
        }
        var name = nameOf(fiber);
        if (name !== undefined) {
          rendered += 1;
          counts[name] = (counts[name] || 0) + 1;
          times[name] = (times[name] || 0) + (fiber.selfBaseDuration || 0);
          if (EXPLAIN[name] && old !== null) why(fiber, old, whys);
        } else if (typeof fiber.type === "string") hosts += 1;
      }
      if (fiber.sibling) {
        slotOf.set(fiber.sibling, slotOf.get(fiber) || "none");
        stack.push(fiber.sibling);
      }
      if (fiber.child && !(old !== null && old.child === fiber.child && !did)) {
        slotOf.set(fiber.child, here);
        stack.push(fiber.child);
      }
    }
    var top = Object.keys(counts).map((k) => [k, counts[k]]);
    top.sort((a, b) => b[1] - a[1]);
    var slow = Object.keys(times).map((k) => [k, Math.round(times[k] * 10) / 10]);
    slow.sort((a, b) => b[1] - a[1]);
    return {
      rendered: rendered,
      mounted: mounted,
      hostRendered: hosts,
      total: total,
      why: whys,
      slots: slotted,
      top: top.slice(0, 25),
      slow: slow.slice(0, 25),
      renderMs: Math.round((root.current.actualDuration || 0) * 10) / 10,
    };
  }

  var renderers = new Map();
  global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: renderers,
    supportsFiber: true,
    isDisabled: false,
    inject: (renderer) => {
      var id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberRoot: (_id, root) => {
      var started = global.performance ? global.performance.now() : 0;
      var seen = walk(root);
      seen.t = Date.now();
      seen.p = started;
      seen.kind = "commit";
      seen.walkMs = (global.performance ? global.performance.now() : 0) - started;
      if (commits.length < 200000) commits.push(seen);
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : this);
