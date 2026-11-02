import { durationFramesForMs as framesForMilliseconds } from "../../../video-spec.mjs";

export const CALLOUT_RENDER_POLICY = Object.freeze({
    paddingBlock: 16,
    paddingInline: 16,
    subtitleGap: 24,
    collisionPadding: 32,
    groupGap: 28,
    identityFrame: Object.freeze({
      thickness: 5,
      inset: 10,
      topCapLength: 104,
      bottomCapLength: 160
    }),
    kinds: Object.freeze({
      "historical-quote": Object.freeze({
        revealDurationMs: 900,
        preferredLeadMs: 450,
        holdDurationMs: 4000,
        exitDurationMs: 900,
        textRevealSpread: 0.42,
        textBlurPx: 7,
        backdropDimOpacity: 0.34,
        maxCharacters: 32,
        maxCharactersPerLine: 16,
        maxLines: 2,
        headingTypography: Object.freeze({
          fontSize: 64,
          lineHeight: 1.25,
          letterSpacing: 2
        }),
        citation: Object.freeze({
          delayMs: 300,
          maxCharacters: 28,
          gap: 16,
          opacity: 0.94,
          typography: Object.freeze({
            fontSize: 50,
            lineHeight: 1.2,
            letterSpacing: 0
          })
        })
      }),
      "person-intro": Object.freeze({
        revealDurationMs: 1000,
        preferredLeadMs: 400,
        holdDurationMs: 3000,
        additionalPersonHoldMs: 1200,
        exitDurationMs: 1000,
        textRevealSpread: 0.42,
        textBlurPx: 7,
        backdropDimOpacity: 0,
        paddingBlock: 24,
        paddingInline: 34,
        minimumWidth: 600,
        maxBodyCharacters: 30,
        maxBodyCharactersPerLine: 15,
        maxBodyLines: 2,
        blockGap: 16,
        dividerThickness: 2,
        headingTypography: Object.freeze({
          fontSize: 74,
          lineHeight: 1.05,
          letterSpacing: 3
        }),
        bodyTypography: Object.freeze({
          fontSize: 38,
          lineHeight: 1.22,
          letterSpacing: 1
        })
      }),
      "term-gloss": Object.freeze({
        revealDurationMs: 1000,
        preferredLeadMs: 400,
        holdDurationMs: 3000,
        exitDurationMs: 1000,
        textRevealSpread: 0.42,
        textBlurPx: 7,
        backdropDimOpacity: 0,
        paddingBlock: 24,
        paddingInline: 34,
        minimumWidth: 600,
        maxBodyCharacters: 30,
        maxBodyCharactersPerLine: 15,
        maxBodyLines: 2,
        blockGap: 14,
        dividerThickness: 0,
        headingTypography: Object.freeze({
          fontSize: 64,
          lineHeight: 1.08,
          letterSpacing: 2
        }),
        bodyTypography: Object.freeze({
          fontSize: 38,
          lineHeight: 1.22,
          letterSpacing: 1
        })
      })
    })
  });

export const CALLOUT_EASING = Object.freeze({
  calloutEnter: Object.freeze({ x1: 0.16, y1: 1, x2: 0.3, y2: 1 })
});

const finiteBetween = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;
const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} 必须为正整数`);
};
const assertPositiveNumber = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须为正数`);
};
const assertFiniteNumber = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须为有限数值`);
};
const CALLOUT_KINDS = ["historical-quote", "person-intro", "term-gloss"];

const typographyWithFont = ({ typography, fontFamilies, fontWeight, label }) => {
  if (!Array.isArray(fontFamilies) || fontFamilies.length < 1) {
    throw new Error(`${label} 缺少视觉包字体家族`);
  }
  const resolved = { ...typography, fontFamily: fontFamilies.join(", "), fontWeight: Number(fontWeight) };
  for (const key of ["fontSize", "fontWeight", "lineHeight"]) {
    assertPositiveNumber(resolved[key], `${label}.${key}`);
  }
  assertFiniteNumber(resolved.letterSpacing, `${label}.letterSpacing`);
  return resolved;
};

const assertCalloutEntryEasing = () => {
  const value = CALLOUT_EASING.calloutEnter;
  const label = "P4 全画幅 easing.calloutEnter";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是 cubic-bezier 参数对象`);
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["x1", "x2", "y1", "y2"])) {
    throw new Error(`${label} 必须且只能声明 x1 / y1 / x2 / y2`);
  }
  for (const key of keys) {
    assertFiniteNumber(value[key], `${label}.${key}`);
  }
  if (value.x1 < 0 || value.x1 > 1 || value.x2 < 0 || value.x2 > 1) {
    throw new Error(`${label} 的 x1 / x2 必须在 0 到 1 之间`);
  }
};

export const prepareCalloutRenderPolicy = ({ callout, visualStyle, fps }) => {
  assertCalloutEntryEasing();
  for (const key of ["paddingBlock", "paddingInline", "subtitleGap", "collisionPadding", "groupGap"]) {
    assertPositiveNumber(callout?.[key], `P4 全画幅 callout.${key}`);
  }
  for (const key of ["thickness", "inset", "topCapLength", "bottomCapLength"]) {
    assertPositiveNumber(callout?.identityFrame?.[key], `P4 全画幅 callout.identityFrame.${key}`);
  }
  if (JSON.stringify(Object.keys(callout?.kinds ?? {}).sort()) !== JSON.stringify([...CALLOUT_KINDS].sort())) {
    throw new Error("P4 全画幅解说框必须且只能声明文献、人物和专名三类渲染策略");
  }
  const titleFontFamilies = visualStyle?.shared?.fontFamilies?.title;
  const bodyFontFamilies = visualStyle?.shared?.fontFamilies?.sans;
  const mastheadFontFamilies = visualStyle?.shared?.fontFamilies?.masthead;
  const fonts = visualStyle?.shared?.fonts;
  const preparedKinds = {};
  for (const kind of CALLOUT_KINDS) {
    const kindPolicy = callout.kinds[kind];
    for (const key of ["revealDurationMs", "preferredLeadMs", "holdDurationMs", "exitDurationMs", "textBlurPx"]) {
      assertPositiveNumber(kindPolicy?.[key], `P4 全画幅 ${kind}.${key}`);
    }
    if (kindPolicy.exitDurationMs !== kindPolicy.revealDurationMs) {
      throw new Error(`P4 全画幅 ${kind} 退场必须与进场等时`);
    }
    if (!finiteBetween(kindPolicy.textRevealSpread, 0, 1) || kindPolicy.textRevealSpread === 0 || kindPolicy.textRevealSpread === 1) {
      throw new Error(`P4 全画幅 ${kind} 墨化扩散比例必须大于0且小于1`);
    }
    if (kind !== "historical-quote" && kindPolicy.revealDurationMs + kindPolicy.holdDurationMs < 4000) {
      throw new Error(`P4 全画幅 ${kind} 必须在开始出现满4秒后才能离场`);
    }
    if (kind === "historical-quote" && kindPolicy.holdDurationMs < 4000) {
      throw new Error("P4 文献原文清晰停留不得少于4秒");
    }
    if (!finiteBetween(kindPolicy.backdropDimOpacity, 0, 1)) {
      throw new Error(`P4 全画幅 ${kind}.backdropDimOpacity 必须在0到1之间`);
    }
    const prepared = {
      ...kindPolicy,
      revealDurationFrames: framesForMilliseconds({ milliseconds: kindPolicy.revealDurationMs, fps, label: `${kind} 进场时长` }),
      preferredLeadFrames: framesForMilliseconds({ milliseconds: kindPolicy.preferredLeadMs, fps, label: `${kind} 卡点提前量` }),
      holdDurationFrames: framesForMilliseconds({ milliseconds: kindPolicy.holdDurationMs, fps, label: `${kind} 清晰停留` }),
      exitDurationFrames: framesForMilliseconds({ milliseconds: kindPolicy.exitDurationMs, fps, label: `${kind} 退场时长` }),
      headingTypography: typographyWithFont({
        typography: kindPolicy.headingTypography,
        fontFamilies: kind === "person-intro" ? mastheadFontFamilies : titleFontFamilies,
        fontWeight: kind === "person-intro" ? fonts?.masthead?.weight : fonts?.title?.weight,
        label: `P4 ${kind} 标题字体`
      })
    };
    if (kind === "historical-quote") {
      assertPositiveInteger(kindPolicy.maxCharacters, "P4 文献原文最大字数");
      assertPositiveInteger(kindPolicy.maxCharactersPerLine, "P4 文献原文每行字数");
      assertPositiveInteger(kindPolicy.maxLines, "P4 文献原文行数");
      for (const key of ["delayMs", "gap"]) assertPositiveNumber(kindPolicy.citation?.[key], `P4 文献出处.${key}`);
      assertPositiveInteger(kindPolicy.citation?.maxCharacters, "P4 文献出处最大字数");
      if (!finiteBetween(kindPolicy.citation?.opacity, 0, 1) || kindPolicy.citation.opacity === 0) {
        throw new Error("P4 文献出处透明度必须大于0且不超过1");
      }
      prepared.citation = {
        ...kindPolicy.citation,
        delayFrames: framesForMilliseconds({ milliseconds: kindPolicy.citation.delayMs, fps, label: "P4 文献出处延迟" }),
        typography: typographyWithFont({
          typography: kindPolicy.citation.typography,
          fontFamilies: mastheadFontFamilies,
          fontWeight: fonts?.masthead?.weight,
          label: "P4 文献出处字体"
        })
      };
    } else {
      for (const key of [
        "blockGap",
        "minimumWidth",
        "paddingBlock",
        "paddingInline",
        "maxBodyCharacters",
        "maxBodyCharactersPerLine",
        "maxBodyLines"
      ]) {
        assertPositiveNumber(kindPolicy?.[key], `P4 ${kind}.${key}`);
      }
      if (!Number.isFinite(kindPolicy.dividerThickness) || kindPolicy.dividerThickness < 0) {
        throw new Error(`P4 ${kind}.dividerThickness 必须是非负数`);
      }
      prepared.bodyTypography = typographyWithFont({
        typography: kindPolicy.bodyTypography,
        fontFamilies: bodyFontFamilies,
        fontWeight: fonts?.body?.weight,
        label: `P4 ${kind} 正文字体`
      });
      if (kind === "person-intro") {
        assertPositiveNumber(kindPolicy.additionalPersonHoldMs, "P4 双人卡额外停留");
        prepared.additionalPersonHoldFrames = framesForMilliseconds({
          milliseconds: kindPolicy.additionalPersonHoldMs,
          fps,
          label: "P4 双人卡额外停留"
        });
      }
    }
    preparedKinds[kind] = prepared;
  }
  return { ...callout, kinds: preparedKinds };
};
