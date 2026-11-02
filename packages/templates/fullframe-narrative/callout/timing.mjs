import { durationFramesForMs } from "../../../video-spec.mjs";

const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} 必须为正整数`);
};

export const isPersonTermCalloutPair = (left, right) => {
  const pair = [left, right];
  const person = pair.find((item) => item?.kind === "person-intro");
  const term = pair.find((item) => item?.kind === "term-gloss");
  return Boolean(person && term && person.people?.length === 1);
};

export const calloutLifecyclePolicyFor = ({ callout, policy, fps, label = "全画幅解说框" }) => {
  const kindPolicy = policy?.kinds?.[callout?.kind];
  if (!kindPolicy) throw new Error(`${label} 类型无效`);
  const frameValue = (frameKey, millisecondKey) => Number.isInteger(kindPolicy[frameKey])
    ? kindPolicy[frameKey]
    : durationFramesForMs({
        milliseconds: kindPolicy[millisecondKey],
        fps,
        label: `${label} ${millisecondKey}`
      });
  const additionalHoldFrames = callout.kind === "person-intro" && callout.people?.length === 2
    ? frameValue("additionalPersonHoldFrames", "additionalPersonHoldMs")
    : 0;
  return {
    ...policy,
    ...kindPolicy,
    revealDurationFrames: frameValue("revealDurationFrames", "revealDurationMs"),
    preferredLeadFrames: frameValue("preferredLeadFrames", "preferredLeadMs"),
    holdDurationFrames: frameValue("holdDurationFrames", "holdDurationMs") + additionalHoldFrames,
    exitDurationFrames: frameValue("exitDurationFrames", "exitDurationMs")
  };
};

export const resolveCalloutLifecycleTiming = ({
  cueFrame,
  visibleStartFrame,
  calloutPolicy,
  label = "全画幅解说框"
}) => {
  for (const [name, value] of Object.entries({ cueFrame, visibleStartFrame })) {
    if (!Number.isInteger(value)) throw new Error(`${label} ${name} 必须是整数帧`);
  }
  for (const key of ["revealDurationFrames", "preferredLeadFrames", "holdDurationFrames", "exitDurationFrames"]) {
    assertPositiveInteger(calloutPolicy?.[key], `${label} ${key}`);
  }
  if (cueFrame < visibleStartFrame) {
    throw new Error(`${label} 不得绑定在所属画面真正可见之前`);
  }
  const preferredStartFrame = cueFrame - calloutPolicy.preferredLeadFrames;
  const revealStartFrame = Math.max(visibleStartFrame, preferredStartFrame);
  const holdStartFrame = revealStartFrame + calloutPolicy.revealDurationFrames;
  const exitStartFrame = holdStartFrame + calloutPolicy.holdDurationFrames;
  const endFrame = exitStartFrame + calloutPolicy.exitDurationFrames;
  return {
    revealStartFrame,
    preferredStartFrame,
    holdStartFrame,
    exitStartFrame,
    endFrame,
    durationInFrames: endFrame - revealStartFrame
  };
};
