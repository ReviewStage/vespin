## ipad27-light-accessibility
- failed step: `{"tapOnElement": {"selector": {"idRegex": "settings-workspace", "optional": false}, "retryIfNoChange": false, "waitUntilVisible": false, "longPress": false, "optional": false}}`
- selector text: `settings-workspace` at accessibility.yaml:210, accessibility.yaml:217
- error: Element not found: Id matching regex: settings-workspace
- step 177 of 2026-11-25_133036/accessibility/commands.json, after 17329 ms

## ipad27-light-agent
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Waiting for approval", "optional": false}}, "optional": false}}`
- selector text: `Waiting for approval` at agent.yaml:52
- error: Assertion is false: "Waiting for approval" is visible
- step 10 of 2026-11-25_133745/.kbd-agent/commands.json, after 18004 ms

## ipad27-light-automations
- failed step: `{"tapOnElement": {"selector": {"textRegex": "Order by", "optional": false}, "retryIfNoChange": false, "waitUntilVisible": false, "longPress": false, "optional": false}}`
- selector text: `Order by` at automations.yaml:1, automations.yaml:34
- error: Element not found: Text matching regex: Order by
- step 27 of 2026-11-25_134257/automations/commands.json, after 17613 ms

## ipad27-light-compose
- failed step: `{"scrollUntilVisible": {"selector": {"textRegex": "Full access.*", "optional": false}, "direction": "DOWN", "scrollDuration": "40", "visibilityPercentage": 100, "timeout": "20000", "centerElement": false, "originalSpeedValue": "40", "optional": false, "visibilityPercentageNormalized": 1.0}}`
- selector text: `Full access.*` at compose.yaml:95
- error: No visible element found: "Full access.*"
- step 45 of 2026-11-25_134412/.kbd-compose/commands.json, after 21287 ms

## ipad27-light-computer-use
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Input", "optional": false}}, "optional": false}}`
- selector text: `Input` at computer-use.yaml:58
- error: Assertion is false: "Input" is visible
- step 20 of 2026-11-25_134622/computer-use/commands.json, after 17805 ms

## ipad27-light-description-comment
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Created by .*", "optional": false}}, "optional": false}}`
- selector text: `Created by .*` at description-comment.yaml:23
- error: Assertion is false: "Created by .*" is visible
- step 23 of 2026-11-25_134743/.kbd-description-comment/commands.json, after 17460 ms

## ipad27-light-description-edit
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Created by .*", "optional": false}}, "optional": false}}`
- selector text: `Created by .*` at description-edit.yaml:26
- error: Assertion is false: "Created by .*" is visible
- step 24 of 2026-11-25_134848/.kbd-description-edit/commands.json, after 17421 ms

## ipad27-light-failure-notice
- failed step: `{"scrollUntilVisible": {"selector": {"textRegex": "${ITEM}", "optional": false}, "direction": "DOWN", "scrollDuration": "40", "visibilityPercentage": 100, "timeout": "20000", "centerElement": false, "originalSpeedValue": "40", "optional": false, "visibilityPercentageNormalized": 1.0}}`
- selector text: `${ITEM}` at subflows/row-menu.yaml:19
- error: No visible element found: "Unpin"
- step 38 of 2026-11-25_135145/.kbd-failure-notice/commands.json, after 21137 ms

## ipad27-light-following
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"idRegex": "following-chip", "optional": false}}, "optional": false}}`
- selector text: `following-chip` at following.yaml:30, following.yaml:32, following.yaml:34, following.yaml:48
- error: Assertion is false: id: following-chip is visible
- step 25 of 2026-11-25_135445/following/commands.json, after 18071 ms

## ipad27-light-github-line
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Close, but an invite to an address.*", "optional": false}}, "timeout": "5000", "optional": false}}`
- selector text: `Close, but an invite to an address.*` at github-line.yaml:39, github-line.yaml:46, github-line.yaml:55
- error: Assertion is false: "Close, but an invite to an address.*" is visible
- step 26 of 2026-11-25_135555/github-line/commands.json, after 6351 ms

## ipad27-light-inbox
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Recorded the invite flow", "optional": false}}, "timeout": "30000", "optional": false}}`
- selector text: `Recorded the invite flow` at inbox.yaml:17, inbox.yaml:48, inbox.yaml:205, inbox.yaml:218
- error: Assertion is false: "Recorded the invite flow" is visible
- step 4 of 2026-11-25_135824/.kbd-inbox/commands.json, after 30323 ms

## ipad27-light-inbox-off
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": ".*withdrawing one deletes it.*", "optional": false}}, "timeout": "15000", "optional": false}}`
- selector text: `.*withdrawing one deletes it.*` at inbox-off.yaml:48
- error: Assertion is false: ".*withdrawing one deletes it.*" is visible
- step 18 of 2026-11-25_135725/.kbd-inbox-off/commands.json, after 15275 ms

## ipad27-light-keep
- failed step: `{"assertConditionCommand": {"condition": {"visible": {"textRegex": "Recorded the invite flow", "optional": false}}, "timeout": "30000", "optional": false}}`
- selector text: `Recorded the invite flow` at keep.yaml:16, keep.yaml:18
- error: Assertion is false: "Recorded the invite flow" is visible
- step 3 of 2026-11-25_135923/keep/commands.json, after 30345 ms
