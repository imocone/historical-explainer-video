import {readFile} from 'node:fs/promises';
import {bboxClip} from '@turf/turf';
import {geographicFrame, geographicPath} from './geometry.mjs';

// Author-side clipping keeps polar and unrelated world geometry out of the
// selected region. Only clipped data or SVG belongs in the treatment.
export async function geographicData({bounds, layers = ['land', 'lakes', 'rivers']}) {
  const box = [...bounds[0], ...bounds[1]];
  const shifts = [0, ...(box[0] < -180 ? [-360] : []), ...(box[2] > 180 ? [360] : [])];
  const shifted = (coordinates, offset) => typeof coordinates[0] === 'number'
    ? [coordinates[0] + offset, coordinates[1]] : coordinates.map(child => shifted(child, offset));
  const result = {};
  for (const layer of layers) {
    if (!['land', 'lakes', 'rivers'].includes(layer)) throw new Error(`未知地理资源：${layer}`);
    const data = JSON.parse(await readFile(new URL(`./geography/${layer}.json`, import.meta.url), 'utf8'));
    result[layer] = {type: 'FeatureCollection', features: data.features.flatMap(feature => shifts.flatMap(offset => {
      const source = offset ? {...feature, geometry: {...feature.geometry,
        coordinates: shifted(feature.geometry.coordinates, offset)}} : feature;
      const geometry = bboxClip(source, box).geometry;
      if (geometry.type === 'MultiPolygon') geometry.coordinates = geometry.coordinates
        .map(polygon => polygon.filter(ring => ring.length >= 4)).filter(polygon => polygon.length);
      if (geometry.type === 'Polygon') geometry.coordinates = geometry.coordinates.filter(ring => ring.length >= 4);
      if (geometry.type === 'MultiLineString') geometry.coordinates = geometry.coordinates.filter(line => line.length >= 2);
      return geometry.coordinates.length ? [{type: 'Feature', properties: {}, geometry}] : [];
    }))};
  }
  return result;
}

export async function geographicLayers({bounds, viewport, layers}) {
  const project = geographicFrame(bounds, viewport);
  const data = await geographicData({bounds, layers});
  return Object.fromEntries(Object.entries(data).map(([name, collection]) =>
    [name, collection.features.map(feature => geographicPath(feature.geometry, project)).filter(Boolean)]));
}
