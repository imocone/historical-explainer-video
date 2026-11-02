import { calloutLifecyclePolicyFor } from "./timing.mjs";

export const resolveCalloutEntrySampleFrame = ({
  frame,
  revealStartFrame,
  revealDurationFrames,
  exitStartFrame,
  endFrame,
  label = "全画幅解说框"
}) => {
  for (const [name, value] of Object.entries({
    frame,
    revealStartFrame,
    revealDurationFrames,
    exitStartFrame,
    endFrame
  })) {
    if (!Number.isFinite(value)) throw new Error(`${label} ${name} 必须是有限数值`);
  }
  if (revealDurationFrames <= 0 || endFrame <= exitStartFrame) {
    throw new Error(`${label} 缺少合法进退场时间窗`);
  }
  if (frame < exitStartFrame) return frame;
  return revealStartFrame
    + (endFrame - frame) * revealDurationFrames / (endFrame - exitStartFrame);
};

export const deriveCalloutTextLayout = ({ callout, policy, label = "全画幅解说框" }) => {
  const kindPolicy = calloutLifecyclePolicyFor({
    callout,
    policy: policy.callout,
    fps: policy.fps,
    label
  });
  const paddingBlock = kindPolicy.paddingBlock;
  const paddingInline = kindPolicy.paddingInline;
  const availableHeight = policy.height
    - policy.safeMarginY
    - policy.subtitleSafeAreaHeight
    - policy.callout.subtitleGap;
  const assertFits = ({ width, height }) => {
    if (height > availableHeight) throw new Error(`${label} 派生高度与字幕安全区冲突`);
    if (width + policy.safeMarginX * 2 >= policy.width) throw new Error(`${label} 派生宽度超出画布安全区`);
  };
  const textWidthFor = (text, typography) => [...text].length
    * (typography.fontSize + Math.max(0, typography.letterSpacing));

  if (callout.kind === "historical-quote") {
    if (typeof callout.text !== "string" || !callout.text.trim()) throw new Error(`${label} 文献原文不能为空`);
    const normalizedText = callout.text.replace(/\r\n?/gu, "\n");
    const normalizedCitation = typeof callout.citation === "string" ? callout.citation.trim() : "";
    if (!normalizedCitation) throw new Error(`${label} 文献原文出处不能为空`);
    const characterCount = [...normalizedText].filter((character) => character !== "\n").length;
    if (characterCount > kindPolicy.maxCharacters) throw new Error(`${label} 文字超过全画幅模板容量`);
    if ([...normalizedCitation].length > kindPolicy.citation.maxCharacters) throw new Error(`${label} 出处超过全画幅模板容量`);
    const lines = [];
    for (const paragraph of normalizedText.split("\n")) {
      const graphemes = [...paragraph];
      if (!graphemes.length) {
        lines.push("");
        continue;
      }
      const lineCount = Math.ceil(graphemes.length / kindPolicy.maxCharactersPerLine);
      const baseLength = Math.floor(graphemes.length / lineCount);
      const longerLineCount = graphemes.length % lineCount;
      let offset = 0;
      for (let index = 0; index < lineCount; index += 1) {
        const length = baseLength + (index < longerLineCount ? 1 : 0);
        lines.push(graphemes.slice(offset, offset + length).join(""));
        offset += length;
      }
    }
    if (lines.length > kindPolicy.maxLines) throw new Error(`${label} 文献原文超过两行容量`);
    const typography = kindPolicy.headingTypography;
    const lineHeightPx = typography.fontSize * typography.lineHeight;
    const citationTypography = kindPolicy.citation.typography;
    const citationDisplayText = `——${normalizedCitation}`;
    const citationLineHeightPx = citationTypography.fontSize * citationTypography.lineHeight;
    const textWidth = Math.max(...lines.map((line) => textWidthFor(line, typography)), 1);
    const citationWidthPx = textWidthFor(citationDisplayText, citationTypography);
    const width = Math.ceil(Math.max(textWidth, citationWidthPx) + paddingInline * 2);
    const height = Math.ceil(
      lineHeightPx * lines.length
      + kindPolicy.citation.gap
      + citationLineHeightPx
      + paddingBlock * 2
    );
    assertFits({ width, height });
    return {
      kind: callout.kind,
      style: "quote",
      hasCitation: true,
      lines,
      characterCount,
      citationDisplayText,
      citationLineHeightPx,
      citationGap: kindPolicy.citation.gap,
      width,
      height,
      lineHeightPx,
      paddingBlock,
      paddingInline,
      typography,
      citationTypography
    };
  }

  const sourceBlocks = callout.kind === "person-intro"
    ? (callout.people ?? []).map((person) => ({ heading: person.name, body: person.brief }))
    : callout.kind === "term-gloss"
      ? [{ heading: callout.term, body: callout.gloss }]
      : null;
  if (!sourceBlocks || sourceBlocks.length < 1 || sourceBlocks.length > 2) throw new Error(`${label} 类型或信息块无效`);
  if (sourceBlocks.some((block) => typeof block.heading !== "string" || !block.heading.trim()
    || typeof block.body !== "string" || !block.body.trim())) {
    throw new Error(`${label} 姓名／词头与简介／释义不能为空`);
  }
  const blocks = sourceBlocks.map((block) => {
    const characters = [...block.body.trim()];
    if (characters.length > kindPolicy.maxBodyCharacters) {
      throw new Error(`${label} 简介／释义超过${kindPolicy.maxBodyCharacters}字容量`);
    }
    const bodyLines = [];
    for (let offset = 0; offset < characters.length; offset += kindPolicy.maxBodyCharactersPerLine) {
      bodyLines.push(characters.slice(offset, offset + kindPolicy.maxBodyCharactersPerLine).join(""));
    }
    if (bodyLines.length > kindPolicy.maxBodyLines) {
      throw new Error(`${label} 简介／释义超过${kindPolicy.maxBodyLines}行容量`);
    }
    return {
      ...block,
      bodyLines,
      bodyMaxLineWidthPx: Math.max(...bodyLines.map((line) => (
        textWidthFor(line, kindPolicy.bodyTypography)
      )))
    };
  });
  const headingTypography = kindPolicy.headingTypography;
  const bodyTypography = kindPolicy.bodyTypography;
  const headingLineHeightPx = headingTypography.fontSize * headingTypography.lineHeight;
  const bodyLineHeightPx = bodyTypography.fontSize * bodyTypography.lineHeight;
  const dividerHeight = blocks.length > 1 ? kindPolicy.dividerThickness : 0;
  const contentHeight = blocks.reduce((height, block) => (
    height + headingLineHeightPx + kindPolicy.blockGap + bodyLineHeightPx * block.bodyLines.length
  ), 0)
    + (blocks.length - 1) * (kindPolicy.blockGap * 2 + dividerHeight);
  const contentWidth = Math.max(...blocks.flatMap((block) => [
    textWidthFor(block.heading, headingTypography),
    ...block.bodyLines.map((line) => textWidthFor(line, bodyTypography))
  ]));
  const width = Math.ceil(Math.max(kindPolicy.minimumWidth, contentWidth + paddingInline * 2));
  const height = Math.ceil(contentHeight + paddingBlock * 2);
  assertFits({ width, height });
  return {
    kind: callout.kind,
    style: "identity",
    hasCitation: false,
    blocks,
    bodyMaxLineWidthPx: Math.max(...blocks.map((block) => block.bodyMaxLineWidthPx)),
    width,
    height,
    paddingBlock,
    paddingInline,
    headingLineHeightPx,
    bodyLineHeightPx,
    blockGap: kindPolicy.blockGap,
    dividerThickness: kindPolicy.dividerThickness,
    headingTypography,
    bodyTypography
  };
};

const rectangleContains = ({ rectangle, point, padding }) => (
  point.x >= rectangle.x - padding
  && point.x <= rectangle.x + rectangle.width + padding
  && point.y >= rectangle.y - padding
  && point.y <= rectangle.y + rectangle.height + padding
);

const rectanglesOverlap = ({ left, right, padding = 0 }) => !(
  left.x + left.width + padding <= right.x
  || right.x + right.width + padding <= left.x
  || left.y + left.height + padding <= right.y
  || right.y + right.height + padding <= left.y
);

const rectangleCenterDistanceSquared = (left, right) => {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return (leftX - rightX) ** 2 + (leftY - rightY) ** 2;
};

const stablePlacementIndex = ({ placementKey, candidateCount, label }) => {
  if (typeof placementKey !== "string" || !placementKey) {
    throw new Error(`${label} 缺少稳定随机选位键`);
  }
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new Error(`${label} 没有可供稳定随机选择的位置`);
  }
  let hash = 2166136261;
  for (let index = 0; index < placementKey.length; index += 1) {
    hash ^= placementKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return Math.floor((hash >>> 0) / 0x100000000 * candidateCount);
};

export const calloutPlacementCandidates = ({
  policy,
  layout,
  viewingPoints,
  placementKey,
  excludedRectangles = [],
  preferFarFrom = null,
  preferredCorner = null,
  label = "全画幅解说框"
}) => {
  if (!layout || !Number.isFinite(layout.width) || layout.width <= 0 || !Number.isFinite(layout.height) || layout.height <= 0) {
    throw new Error(`${label} 缺少由视觉参数派生的文字布局`);
  }
  if (!Array.isArray(viewingPoints) || viewingPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error(`${label} 缺少合法屏幕观看几何`);
  }
  if (!Array.isArray(excludedRectangles)) throw new Error(`${label} 排除矩形必须是数组`);
  const subtitleTop = policy.height - policy.subtitleSafeAreaHeight;
  const topY = policy.safeMarginY;
  const bottomY = subtitleTop - policy.callout.subtitleGap - layout.height;
  if (bottomY < topY) {
    throw new Error(`${label} 派生框高超出字幕外安全画面`);
  }
  const rectangleFor = (side, vertical) => ({
    x: side === "left"
      ? policy.safeMarginX
      : policy.width - policy.safeMarginX - layout.width,
    y: vertical === "top" ? topY : bottomY,
    width: layout.width,
    height: layout.height
  });
  const candidates = [
    ["left", "top"],
    ["right", "top"],
    ["left", "bottom"],
    ["right", "bottom"]
  ];
  const safeCandidates = candidates
    .map(([side, vertical]) => rectangleFor(side, vertical))
    .filter((rectangle) => !viewingPoints.some((point) => rectangleContains({
      rectangle,
      point,
      padding: policy.callout.collisionPadding
    })))
    .filter((rectangle) => !excludedRectangles.some((excluded) => rectanglesOverlap({
      left: rectangle,
      right: excluded,
      padding: policy.callout.groupGap
    })));
  const ordered = [];
  if (preferredCorner) {
    const preferredRectangle = rectangleFor(preferredCorner.side, preferredCorner.vertical);
    const safePreferred = safeCandidates.find((candidate) => (
      candidate.x === preferredRectangle.x && candidate.y === preferredRectangle.y
    ));
    if (safePreferred) ordered.push(safePreferred);
  }
  let remaining = safeCandidates.filter((candidate) => !ordered.includes(candidate));
  while (remaining.length) {
    const maximumDistance = preferFarFrom
      ? Math.max(...remaining.map((candidate) => rectangleCenterDistanceSquared(candidate, preferFarFrom)))
      : null;
    const preferred = preferFarFrom
      ? remaining.filter((candidate) => rectangleCenterDistanceSquared(candidate, preferFarFrom) === maximumDistance)
      : remaining;
    const first = stablePlacementIndex({ placementKey, candidateCount: preferred.length, label });
    ordered.push(...preferred.slice(first), ...preferred.slice(0, first));
    remaining = remaining.filter((candidate) => !preferred.includes(candidate));
  }
  return ordered;
};
