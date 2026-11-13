/**
 * probe.ts -- PROBE (temporary, reverted before merge): a page on the Preview that holds one voice call for the live tests.
 *
 * Same-origin, so the signed-in session's cookie opens the call. The
 * microphone is a synthesized spoken request fetched from the PR's assets.
 * It answers only on a Preview, and only to a signed-in admin; everyone else
 * is refused as not found.
 */

import { readAccountAccess } from "@repo/database/models/account-store";
import { isAdminRole } from "@repo/service/admin/admin-access";
import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { Effect, Option } from "effect";
import { routeFromWebServices } from "../../route-effect.js";

const AUDIO_URL = "https://raw.githubusercontent.com/ReviewStage/vespin/pr-assets/pr-8906/ask.wav";

const PAGE = `<!doctype html><meta charset="utf-8"><title>voice probe</title>
<style>body{font:14px monospace;background:#111;color:#eee;padding:16px}button,input{font:inherit;margin:4px}</style>
<p><input id="agent" size="40" placeholder="agent id">
<button id="start">Start call</button><button id="speak">Speak</button>
<button id="close">Close session</button><button id="drop">Drop peer</button></p>
<pre id="log"></pre>
<script>
const $ = (id) => document.getElementById(id);
const log = (...parts) => { const line = new Date().toISOString().slice(11, 23) + " " + parts.join(" "); $("log").textContent += line + "\\n"; console.log(line); };
$("agent").value = new URLSearchParams(location.search).get("agent") || "";
let pc, dc, ctx, dest, buffer, startedAt;
$("start").onclick = async () => {
  ctx = new AudioContext();
  dest = ctx.createMediaStreamDestination();
  buffer = await ctx.decodeAudioData(await (await fetch(${JSON.stringify(AUDIO_URL)})).arrayBuffer());
  pc = new RTCPeerConnection();
  pc.ontrack = (event) => { const audio = new Audio(); audio.srcObject = event.streams[0]; audio.play().catch(() => {}); log("remote track"); };
  pc.onconnectionstatechange = () => log("peer", pc.connectionState);
  for (const track of dest.stream.getTracks()) pc.addTrack(track, dest.stream);
  dc = pc.createDataChannel("oai-events");
  dc.onopen = () => log("datachannel open");
  dc.onclose = () => log("datachannel closed");
  dc.onmessage = (message) => {
    const event = JSON.parse(message.data);
    const extra = event.type === "session.closed" ? JSON.stringify({ reason: event.reason, usage: event.usage })
      : event.type === "session.started" ? JSON.stringify({ keys: Object.keys(event.session || {}), expires_at: event.session && event.session.expires_at })
      : "";
    log("event", event.type, extra);
  };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((done) => { if (pc.iceGatheringState === "complete") return done(); pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done(); setTimeout(done, 3000); });
  const response = await fetch("/api/voice/session", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: $("agent").value.trim(), voice: "marin", sdp: pc.localDescription.sdp }) });
  const body = await response.json();
  log("open", response.status, body.callId || JSON.stringify(body));
  if (!response.ok) return;
  await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  startedAt = Date.now();
};
$("speak").onclick = () => { const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(dest); source.start(); log("spoke"); };
$("close").onclick = () => { dc.send(JSON.stringify({ type: "session.close" })); log("sent session.close"); };
$("drop").onclick = () => { pc.close(); log("peer dropped"); };
setInterval(() => { if (startedAt) document.title = "call " + Math.round((Date.now() - startedAt) / 1000) + "s"; }, 1000);
</script>`;

const NOT_FOUND = 404;

/** Whether the request is a signed-in admin's, on a Preview. */
const admitted = (request: Request) =>
  Effect.gen(function* () {
    if (process.env.VERCEL_ENV !== "preview") return false;
    const userId = yield* resolveHostedUserId(request);

    if (Option.isNone(userId)) return false;
    const access = yield* readAccountAccess(userId.value);

    return isAdminRole(access.role);
  }).pipe(Effect.orElseSucceed(() => false));

export default routeFromWebServices((services) => async (request) => {
  const admits = await Effect.runPromiseWith(services)(admitted(request));

  if (!admits) return new Response(null, { status: NOT_FOUND });

  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
});
