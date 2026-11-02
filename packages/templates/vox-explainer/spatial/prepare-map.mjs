import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {contours} from 'd3-contour';
import {bboxClip, simplify} from '@turf/turf';
import {geographicData} from './geography.mjs';

const empty = () => ({type: 'FeatureCollection', features: []});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pixel = ([lon, lat], z) => [(lon + 180) / 360 * 256 * 2 ** z,
  (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 256 * 2 ** z];
const geo = ([x, y], z) => [x / (256 * 2 ** z) * 360 - 180,
  Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (256 * 2 ** z)))) * 180 / Math.PI];
function blur(values, width, height, sigma) {
  const radius = Math.ceil(sigma * 3), kernel = Array.from({length: radius * 2 + 1}, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
  const total = kernel.reduce((a, b) => a + b, 0), temp = new Float32Array(values.length), out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let k = -radius; k <= radius; k++) temp[y * width + x] += values[y * width + clamp(x + k, 0, width - 1)] * kernel[k + radius] / total;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let k = -radius; k <= radius; k++) out[y * width + x] += temp[clamp(y + k, 0, height - 1) * width + x] * kernel[k + radius] / total;
  }
  return out;
}
const area = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const smoothRing = ring => {
  let points = ring.slice(0, -1);
  for (let pass = 0; pass < 2; pass++) points = points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length];
    return [[.75 * p[0] + .25 * q[0], .75 * p[1] + .25 * q[1]], [.25 * p[0] + .75 * q[0], .25 * p[1] + .75 * q[1]]];
  });
  return [...points, points[0]];
};

// Author-time preparation only. Cache failures never become flat/fabricated terrain.
// Bounds are a continuous longitude interval, including antimeridian regions.
export async function prepareMapData({bounds, cacheDirectory, relief = true, zoom, maxTiles = 32, terrainAttribution,
  geography, terrain}) {
  const [[west, south], [east, north]] = bounds;
  if (![west, south, east, north].every(Number.isFinite) || west >= east || east - west > 360 || south >= north || south < -85 || north > 85)
    throw new Error('地图范围须为连续经度区间、有效墨卡托纬度');
  const layers = geography ?? await geographicData({bounds});
  const result = {bounds, ...layers, terrain: terrain ?? empty(), attribution: ['地理：Natural Earth']};
  if (geography) result.attribution = [];
  if (terrain) { if (terrainAttribution) result.attribution.push(terrainAttribution); return result; }
  if (!relief) return result;
  if (!cacheDirectory || !terrainAttribution) throw new Error('DEM准备需要缓存目录及按当前区域核对的地形署名');
  const extent = z => {
    const a = pixel([west, north], z), b = pixel([east, south], z), n = 2 ** z;
    return {x0: Math.floor(a[0] / 256), x1: Math.floor((b[0] - 1e-7) / 256),
      y0: clamp(Math.floor(a[1] / 256), 0, n - 1), y1: clamp(Math.floor((b[1] - 1e-7) / 256), 0, n - 1)};
  };
  let z = zoom ?? 10, tiles = extent(z);
  if (!Number.isInteger(z) || z < 0 || z > 14) throw new Error('DEM zoom须为0—14整数');
  const count = () => (tiles.x1 - tiles.x0 + 1) * (tiles.y1 - tiles.y0 + 1);
  if (zoom == null) while (count() > maxTiles && z > 0) tiles = extent(--z);
  if (count() > maxTiles) throw new Error('DEM范围超出本次maxTiles，请缩小范围或降低zoom');
  const width = (tiles.x1 - tiles.x0 + 1) * 256, height = (tiles.y1 - tiles.y0 + 1) * 256;
  const values = new Float32Array(width * height);
  for (let y = tiles.y0; y <= tiles.y1; y++) for (let x = tiles.x0; x <= tiles.x1; x++) {
    const wrappedX = ((x % 2 ** z) + 2 ** z) % 2 ** z;
    const file = path.join(cacheDirectory, String(z), String(wrappedX), `${y}.png`);
    let bytes;
    try { bytes = await readFile(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${wrappedX}/${y}.png`;
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`DEM ${response.status}: ${url}`);
      bytes = Buffer.from(await response.arrayBuffer());
      PNG.sync.read(bytes); // Validate before preserving a successful cache entry.
      await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, bytes);
    }
    const png = PNG.sync.read(bytes);
    if (png.width !== 256 || png.height !== 256) throw new Error(`DEM瓦片尺寸错误：${file}`);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const i = (py * 256 + px) * 4;
      values[((y - tiles.y0) * 256 + py) * width + (x - tiles.x0) * 256 + px] = Math.max(0,
        png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768);
    }
  }
  const elevation = blur(values, width, height, 3.6), broad = blur(values, width, height, 5.5);
  const shade = new Float32Array(values.length), light = new Float32Array(values.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, dx = (broad[i + 1] - broad[i - 1]) / 2, dy = (broad[i + width] - broad[i - width]) / 2;
    const slope = Math.hypot(dx, dy), aspect = (dx - dy) / Math.max(.1, slope);
    shade[i] = elevation[i] > 140 && aspect > .24 && slope > 3.4 ? 1 : 0;
    light[i] = elevation[i] > 180 && aspect < -.65 && slope > 5 ? 1 : 0;
  }
  const bands = [['foothill', elevation, 110], ['hill', elevation, 300], ['mountain', elevation, 650], ['high', elevation, 1050],
    ['shade', blur(shade, width, height, 1.2), .5], ['light', blur(light, width, height, 1.2), .5]];
  const box = [west, south, east, north], tolerance = 360 / (256 * 2 ** z) * 1.35;
  for (const [kind, grid, level] of bands) {
    const shape = contours().size([width, height]).thresholds([level])(grid)[0];
    for (const polygon of shape.coordinates.filter(p => area(p[0]) > 75)) {
      const rings = polygon.filter((ring, i) => i === 0 || area(ring) > 60).map(ring => ring.map(([x, y]) => geo([x + tiles.x0 * 256, y + tiles.y0 * 256], z)));
      const simple = simplify({type: 'Feature', properties: {kind}, geometry: {type: 'Polygon', coordinates: rings}}, {tolerance, highQuality: true});
      simple.geometry.coordinates = simple.geometry.coordinates.map(smoothRing);
      const clipped = bboxClip(simple, box);
      if (clipped.geometry.coordinates.length) result.terrain.features.push(clipped);
    }
  }
  result.attribution.push(terrainAttribution);
  result.dem = {provider: 'Mapzen Terrain Tiles', zoom: z, url: 'https://registry.opendata.aws/terrain-tiles/', bounds};
  return result;
}
