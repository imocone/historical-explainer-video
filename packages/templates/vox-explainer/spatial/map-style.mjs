// The approved map palette belongs to this template, independently of object colours.
export const MAP_PALETTE = Object.freeze({water: '#bed2df', land: '#eee6d2',
  foothill: '#e0d4b9', hill: '#cfc1a6', mountain: '#bbae97', high: '#e9dfc9',
  shade: '#8f897c', light: '#fff8e6'});
export const MAP_WORKER_FILES = [
  'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
  'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs',
  'node_modules/maplibre-gl/LICENSE.txt'
];
export function mapStyle(data) {
  const sources = Object.fromEntries(['land', 'terrain', 'lakes', 'rivers', 'regions'].map(name =>
    [name, {type: 'geojson', data: data[name] ?? {type: 'FeatureCollection', features: []}, maxzoom: 14}]));
  sources.regions.promoteId = '__voxRegionId';
  const layers = [
    {id: 'water', type: 'background', paint: {'background-color': MAP_PALETTE.water}},
    {id: 'coast-wash', type: 'line', source: 'land', paint: {'line-color': '#7999ad', 'line-width': 18, 'line-opacity': .20}},
    {id: 'coast-light', type: 'line', source: 'land', paint: {'line-color': '#e1e8e6', 'line-width': 7}},
    {id: 'land', type: 'fill', source: 'land', paint: {'fill-color': MAP_PALETTE.land}}
  ];
  for (const kind of ['foothill', 'hill', 'mountain', 'high', 'shade', 'light']) layers.push({
    id: kind, type: 'fill', source: 'terrain', filter: ['==', ['get', 'kind'], kind],
    paint: {'fill-color': MAP_PALETTE[kind], 'fill-opacity': kind === 'shade' ? .18 : kind === 'light' ? .38 : .65}
  });
  // Authored meaning lives in the scene. Region colour does not replace physical geography.
  const state = (name, fallback) => ['coalesce', ['feature-state', name], fallback];
  const opacity = name => ['*', state('opacity', 1), state(name, name === 'fillOpacity' ? .35 : .8)];
  layers.push({id: 'region-fill', type: 'fill', source: 'regions', paint: {
    'fill-color': state('fill', '#af806a'), 'fill-opacity': opacity('fillOpacity')
  }});
  for (const dashed of [false, true]) layers.push({
    id: dashed ? 'region-dash' : 'region-edge', type: 'line', source: 'regions',
    filter: dashed ? ['==', ['get', 'dashed'], true] : ['!=', ['get', 'dashed'], true],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': state('stroke', '#6b6557'), 'line-opacity': opacity('strokeOpacity'),
      'line-width': state('strokeWidth', 1.5), ...(dashed ? {'line-dasharray': [3, 2]} : {})}
  });
  layers.push(
    {id: 'lakes', type: 'fill', source: 'lakes', paint: {'fill-color': MAP_PALETTE.water}},
    {id: 'rivers', type: 'line', source: 'rivers', paint: {'line-color': '#7999ad', 'line-width': 1.5}},
    {id: 'shore', type: 'line', source: 'land', layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': '#52564f', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.35, 10, 2.4]}}
  );
  return {version: 8, transition: {duration: 0}, sources, layers};
}
