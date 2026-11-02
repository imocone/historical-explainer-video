// Chapter wording belongs to P1; only positions and final timestamps are computed here.
const normalize = value => String(value ?? "").normalize("NFKC").replace(/[\p{P}\s]/gu, "");

export function chapterPositionsFor(chapters, text) {
  if (!chapters?.length) return [];
  if (chapters.length < 3) throw new Error("YouTube时间章节至少需要三章；请由P1作者调整章节");
  const body = normalize(text);
  let previous = -1;
  return chapters.map(({ title, startText }, index) => {
    if (typeof title !== "string" || !title.trim() || title !== title.trim() || /[\r\n]/u.test(title)) {
      throw new Error("YouTube章名须为一行完整文字；返回P1作者修正");
    }
    const anchor = normalize(startText);
    const position = anchor ? body.indexOf(anchor) : -1;
    if (position < 0 || body.indexOf(anchor, position + 1) >= 0) {
      throw new Error(`YouTube章节“${title}”的正文定位缺失或不唯一；返回P1作者修正startText`);
    }
    if (position <= previous || (index === 0 && position !== 0)) {
      throw new Error("YouTube章节须从正文开头起，按正文顺序排列；返回P1作者修正");
    }
    previous = position;
    return position;
  });
}

const timestamp = seconds => seconds >= 3600
  ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export function youtubeDescriptionFor({ youtube, timing, durationMs }) {
  if (!youtube.chapters?.length) return youtube.description;
  const captions = timing?.captions;
  if (!Array.isArray(captions) || !captions.length || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("YouTube章节缺少当前成片的字幕计时交付；保留成片，不猜时间或自动重渲染");
  }
  let offset = 0;
  let previousEnd = -1;
  const spans = captions.map(caption => {
    if (typeof caption.text !== "string" || !Number.isFinite(caption.startMs)
      || !Number.isFinite(caption.endMs) || caption.startMs < 0 || caption.startMs < previousEnd
      || caption.endMs <= caption.startMs || caption.endMs > durationMs) {
      throw new Error("YouTube章节的成片字幕计时不可读取；返回成片计时责任方");
    }
    previousEnd = caption.endMs;
    const text = normalize(caption.text);
    const from = offset;
    offset += text.length;
    return { from, to: offset, startMs: caption.startMs, text };
  });
  const positions = chapterPositionsFor(youtube.chapters, spans.map(span => span.text).join(""));
  const seconds = positions.map((position, index) => index === 0 ? 0
    : Math.floor(spans.find(span => position >= span.from && position < span.to).startMs / 1000));
  for (let index = 0; index < seconds.length; index++) {
    const end = seconds[index + 1] ?? Math.floor(durationMs / 1000);
    if (end - seconds[index] < 10) {
      throw new Error(`YouTube章节“${youtube.chapters[index].title}”不足10秒；由P1作者合并或调整章节，不改成片`);
    }
  }
  const block = ["时间章节", ...youtube.chapters.map((chapter, index) => `${timestamp(seconds[index])} ${chapter.title}`)].join("\n");
  const split = /\r?\n[\t ]*\r?\n/u.exec(youtube.description);
  const description = split
    ? `${youtube.description.slice(0, split.index)}\n\n${block}${youtube.description.slice(split.index)}`
    : `${youtube.description}\n\n${block}`;
  if ([...description].length > 5000) throw new Error("YouTube完整简介含章节超过5000字符；返回P1作者精简，不截断出处");
  return description;
}
