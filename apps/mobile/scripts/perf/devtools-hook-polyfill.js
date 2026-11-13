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

  // Note that a fiber rendered this commit where it mounted or its props or state are new, the heuristic React DevTools uses; a subtree React bailed out of keeps its child objects and is skipped.
  function walk(root) {
    var counts = {};
    var times = {};
    var rendered = 0,
      mounted = 0,
      hosts = 0,
      total = 0;
    var stack = [root.current];
    while (stack.length > 0) {
      var fiber = stack.pop();
      total += 1;
      var old = fiber.alternate;
      var did =
        old === null ||
        old.memoizedProps !== fiber.memoizedProps ||
        old.memoizedState !== fiber.memoizedState;
      if (did) {
        if (old === null) mounted += 1;
        var name = nameOf(fiber);
        if (name !== undefined) {
          rendered += 1;
          counts[name] = (counts[name] || 0) + 1;
          times[name] = (times[name] || 0) + (fiber.selfBaseDuration || 0);
        } else if (typeof fiber.type === "string") hosts += 1;
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child && !(old !== null && old.child === fiber.child && !did))
        stack.push(fiber.child);
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
