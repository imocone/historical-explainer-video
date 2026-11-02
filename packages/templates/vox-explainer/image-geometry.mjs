// Imported bounds and anchors use original-image coordinates; element anchors
// fall back to coordinates within the fitted visible bounds.
export const imagePlacement = (element, asset) => {
  const content = asset.explainerPlacement?.contentBounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const scale = Math.min(element.width / (asset.width * content.width), element.height / (asset.height * content.height));
  const width = asset.width * scale, height = asset.height * scale;
  const bounds = { x: element.x + (element.width - width * content.width) / 2,
    y: element.y + (element.height - height * content.height) / 2,
    width: width * content.width, height: height * content.height };
  const image = { x: bounds.x - width * content.x, y: bounds.y - height * content.y, width, height };
  const anchors = Object.fromEntries(Object.entries(element.anchors ?? {}).map(([name, intended]) => {
    const actual = asset.explainerPlacement?.anchors?.[name];
    return [name, actual ? { x: image.x + actual.x * width, y: image.y + actual.y * height }
      : { x: bounds.x + intended.x * bounds.width, y: bounds.y + intended.y * bounds.height }];
  }));
  return { image, bounds, anchors };
};

export const validateExplainerPlacement = placement => {
  if (!placement || typeof placement !== 'object' || Array.isArray(placement)) throw new Error('图片校准须为对象');
  if (Object.keys(placement).some(key => !['contentBounds', 'anchors'].includes(key))) throw new Error('图片校准含未知字段');
  const b = placement.contentBounds;
  if (!b || Object.keys(b).sort().join() !== 'height,width,x,y' || ![b.x,b.y,b.width,b.height].every(Number.isFinite)
    || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > 1.000001 || b.y + b.height > 1.000001)
    throw new Error('图片可见范围须为原图内的归一化矩形');
  for (const [name, point] of Object.entries(placement.anchors ?? {})) {
    if (!/^[A-Za-z][\w-]*$/.test(name) || !point || Object.keys(point).sort().join() !== 'x,y'
      || ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
      throw new Error(`图片锚点 ${name} 须位于原图内`);
  }
  return placement;
};
