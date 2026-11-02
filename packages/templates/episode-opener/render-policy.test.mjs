import test from "node:test";
import assert from "node:assert/strict";
import { OPENER_RENDER_POLICY, openerStripChoreography, openerTimelineForTreatment } from "./render-policy.mjs";
import { openerAudioTracksForTreatment } from "./audio-policy.mjs";

const treatment = (endMs) => ({
  flashbackShots: [{ id: "O01" }, { id: "O02" }, { id: "O03" }],
  narration: { durationMs: endMs + 116,
    sentenceCues: [{ target: "flashbackLine", startMs: 120, endMs }] }
});

test("三横带随口播长度安排冲刺、急刹、停顿与弹开，并与音效及正片转场对齐", () => {
  for (const endMs of [3000, 5120, 6000, 6760]) {
    const input = treatment(endMs);
    const timeline = openerTimelineForTreatment(input);
    const clock = openerStripChoreography(timeline);
    const tracks = openerAudioTracksForTreatment({ treatment: input });
    const byId = Object.fromEntries(tracks.map(track => [track.id, track]));
    assert.ok(timeline.durationFrames <= 540);
    assert.ok(clock.brake > clock.enter && clock.stop > clock.brake);
    assert.ok(clock.release - clock.stop >= 18);
    assert.equal(clock.end - clock.release, 46);
    assert.equal(timeline.durationFrames - clock.release, OPENER_RENDER_POLICY.exitTransition.durationInFrames);
    assert.equal(byId["opener-strips-pass"].startFrame, clock.enter);
    assert.equal(byId["opener-brake-hit"].startFrame, clock.brake - 4);
    assert.equal(byId["opener-strips-impact"].startFrame, clock.stop - 5);
    assert.equal(byId["opener-exit-reveal"].startFrame, clock.release);
    assert.equal(byId["opener-exit-reveal"].endFrame, clock.end);
    for (const track of tracks) assert.ok(track.startFrame >= 0 && track.endFrame <= timeline.durationFrames);
  }
  const clock = openerStripChoreography(openerTimelineForTreatment(treatment(5120)));
  assert.deepEqual(clock, { enter: 311, brake: 388, stop: 420, release: 444, end: 490 });
});
