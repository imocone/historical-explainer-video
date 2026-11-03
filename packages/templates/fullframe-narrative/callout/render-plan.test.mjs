import assert from "node:assert/strict";
import test from "node:test";
import { placeCalloutOverlays } from "./render-plan.mjs";
import { deriveMotionCameras } from "../camera/index.mjs";
import { FULLFRAME_RENDER_POLICY } from "../render-policy.mjs";

const policy = {
  width: 1920, height: 1080, safeMarginX: 96, safeMarginY: 64,
  subtitleSafeAreaHeight: 260, callout: { subtitleGap: 24, collisionPadding: 32, groupGap: 28 }
};
const segments = () => {
  const motion = {
    type: "push-in", speedRatio: 1,
    startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
    semanticEndViewport: { x: 1 / 6, y: 1 / 6, width: 2 / 3, height: 2 / 3 },
    safeEndViewport: { x: 1 / 6, y: 1 / 6, width: 2 / 3, height: 2 / 3 },
    startFrame: 0, endFrame: 599, runtimeEndFrame: 599
  };
  return [{ id: "B012", startFrame: 0, renderData: { fullframe: [{ requestId: "AR001",
    motion: { ...motion, ...deriveMotionCameras({ motion, fps: 60, motionPolicy: FULLFRAME_RENDER_POLICY.motion }) }
  }] } }];
};
const overlay = (id, startFrame, duration, layouts) => ({
  id, templateId: "fullframe-narrative", overlayLayer: "annotation",
  startFrame, endFrame: startFrame + duration,
  renderData: { calloutOverlayGroup: { callouts: layouts.map(layout => ({
    sourceSegmentId: "B012", sourceRequestId: "AR001", endFrame: duration, layout
  })) } }
});
const rectangles = overlays => overlays.flatMap(item => item.renderData.calloutOverlayGroup.callouts.map(callout => callout.screenRectangle));
const overlaps = (a, b) => !(a.x + a.width + 28 <= b.x || b.x + b.width + 28 <= a.x
  || a.y + a.height + 28 <= b.y || b.y + b.height + 28 <= a.y);

test("重叠术语和宽引文在显示前共同选位，保留原时窗与独立固定位置", () => {
  const input = [overlay("B012.AR001.callout-group.0", 0, 300, [{ width: 728, height: 224 }]),
    overlay("B012.AR001.callout-group.1", 100, 348, [{ width: 1232, height: 268 }])];
  const before = structuredClone(input);
  placeCalloutOverlays({ overlays: input, segments: segments(), policy });
  const [term, quote] = rectangles(input);
  assert.equal(overlaps(term, quote), false);
  assert.equal(term.y, 572, "术语预先使用下角，给宽引文留出上角");
  assert.equal(quote.y, 64);
  for (const [index, item] of input.entries()) {
    assert.equal(item.startFrame, before[index].startFrame);
    assert.equal(item.endFrame, before[index].endFrame);
    const callout = item.renderData.calloutOverlayGroup.callouts[0];
    assert.equal(callout.endFrame, before[index].renderData.calloutOverlayGroup.callouts[0].endFrame);
    assert.deepEqual(Object.keys(callout.screenRectangle).sort(), ["height", "width", "x", "y"]);
  }
  const again = structuredClone(before);
  placeCalloutOverlays({ overlays: again, segments: segments(), policy });
  assert.deepEqual(rectangles(again), rectangles(input));
});

test("仍可行的稳定首选及双框远距安排保持原结果", () => {
  const single = [overlay("B012.AR001.callout-group.0", 0, 100, [{ width: 728, height: 224 }])];
  placeCalloutOverlays({ overlays: single, segments: segments(), policy });
  assert.deepEqual(rectangles(single), [{ x: 96, y: 64, width: 728, height: 224 }]);
  const pair = [overlay("pair", 0, 100, [{ width: 600, height: 224 }, { width: 600, height: 224 }])];
  placeCalloutOverlays({ overlays: pair, segments: segments(), policy });
  assert.deepEqual(rectangles(pair), [{ x: 96, y: 64, width: 600, height: 224 },
    { x: 1224, y: 572, width: 600, height: 224 }]);
});

test("真正无四角组合时仍失败，不交付部分排位或删除框", () => {
  const input = Array.from({ length: 5 }, (_, index) => overlay(`crowded-${index}`, 0, 100,
    [{ width: 600, height: 224 }]));
  const before = structuredClone(input);
  assert.throws(() => placeCalloutOverlays({ overlays: input, segments: segments(), policy }), /四角.*冲突/);
  assert.deepEqual(input, before);
});

test("历史引文按稳定位置覆盖观看区域，人物和术语仍避让观看几何", () => {
  const covered = segments();
  const motion = {
    ...covered[0].renderData.fullframe[0].motion,
    semanticEndViewport: { x: 1 / 6, y: 0, width: 2 / 3, height: 2 / 3 },
    safeEndViewport: { x: 1 / 6, y: 0, width: 2 / 3, height: 2 / 3 }
  };
  covered[0].renderData.fullframe[0].motion = {
    ...motion,
    ...deriveMotionCameras({ motion, fps: 60, motionPolicy: FULLFRAME_RENDER_POLICY.motion })
  };
  const inputFor = kind => {
    const input = [overlay("quote", 0, 100, [{ kind, width: 1232, height: 268 }])];
    input[0].renderData.calloutOverlayGroup.callouts[0].kind = kind;
    return input;
  };
  const quote = inputFor("historical-quote");
  placeCalloutOverlays({ overlays: quote, segments: covered, policy });
  const original = inputFor("historical-quote");
  placeCalloutOverlays({ overlays: original, segments: segments(), policy });
  assert.deepEqual(rectangles(quote), rectangles(original), "相机观看区域不改变引文的稳定选位");
  for (const kind of ["person-intro", "term-gloss"]) {
    assert.throws(() => placeCalloutOverlays({ overlays: inputFor(kind), segments: covered, policy }), /四角.*冲突/);
  }
});
