import { point, lineString, polygon, distance, pointToLineDistance, pointToPolygonDistance } from '@turf/turf';
import maplibregl from 'maplibre-gl';

const LAYER_COLORS = [
  "#c4c8f8", "#d0f8c0", "#e8c4cc", "#f0e8aa", "#e0b4d8", "#b0e8c2",
  "#a2e0ff", "#a6e0ce", "#8cd4ff", "#d8b4e8", "#f2d4aa", "#6aa6ff", 
  "#92d0e6", "#7eb8ff", "#baf0b6", "#9cd8da"
];

const TEXT_FONT = ["Noto Sans Regular"];
const TEXT_HALO_COLOR = "#000b16";
const TEXT_HALO_WIDTH = 1;
const TEXT_HALO_BLUR = 0;
const TEXT_SIZE_POINT = 9;
const TEXT_SIZE_LINE = 8;
const TEXT_SIZE_POLYGON = 10;

function getLayerColor(index) {
  return LAYER_COLORS[index % LAYER_COLORS.length];
}

function getDistanceToFeature(feature, { lng, lat }) {
  const cursor = point([ lng, lat ]);
  const { geometry } = feature;

  switch (geometry.type) {
    case "Point":
      return distance(cursor, geometry);
    case "MultiPoint":
      return Math.min(geometry.coordinates.map(coord => distance(cursor, coord)));
    case "LineString":
      return pointToLineDistance(cursor, geometry);
    case "MultiLineString":
      return Math.min(geometry.coordinates.map(ls => pointToLineDistance(cursor, lineString(ls))));
    case "Polygon":
    case "MultiPolygon":
      return pointToPolygonDistance(cursor, geometry);
    default:
      return Infinity;
  }
}

// Helper to create DOM elements with attributes
function createElement(tag, attributes = {}, textContent = null) {
  const element = document.createElement(tag);
  Object.assign(element, attributes);
  if (textContent) element.textContent = textContent;
  return element;
}

function selectFeaturesByType(features) {
  const points = features.filter(f => ["Point", "MultiPoint"].includes(f.geometry.type));
  const lines = features.filter(f => ["LineString", "MultiLineString"].includes(f.geometry.type));
  const polygons = features.filter(f => ["Polygon", "MultiPolygon"].includes(f.geometry.type));
  
  // prioritize selecting element types that have smaller click targets
  if (points.length > 0) return points;
  else if (lines.length > 0) return lines;
  else return polygons;
}

class LegendControl {
  constructor() {
    this.vectorLayers = [];
    this.sourceId = '';
    this.map = null;
  }

  onAdd() {
    this.container = createElement('div', { className: 'maplibregl-ctrl legend-control legend' });
    this.container.innerHTML = '<h6>Layers</h6><ul id="legend-items"></ul>';
    return this.container;
  }

  onRemove() {
    this.container?.remove();
  }

  setLayers(vectorLayers, sourceId, map) {
    this.vectorLayers = vectorLayers;
    this.sourceId = sourceId;
    this.map = map;
    this.createLegendContent();
  }

  createLegendContent() {
    const legendItems = this.container.querySelector("#legend-items");
    if (!legendItems || !this.vectorLayers.length) return;

    legendItems.innerHTML = '';
    
    const allCheckbox = this.createAllCheckbox();
    const layerCheckboxes = this.createLayerCheckboxes();
    
    this.setupAllCheckboxLogic(allCheckbox, layerCheckboxes);
  }

  createAllCheckbox() {
    const allItem = createElement('li');
    const allLabel = createElement('label');
    const allCheckbox = createElement('input', {
      type: 'checkbox',
      checked: true,
      id: 'legend-all'
    });
    allCheckbox.style.accentColor = '#888';
    
    const allText = createElement('span', { style: 'font-weight: bold' }, 'All');
    
    allLabel.append(allCheckbox, allText);
    allItem.appendChild(allLabel);
    this.container.querySelector("#legend-items").appendChild(allItem);
    
    return allCheckbox;
  }

  createLayerCheckboxes() {
    const layerCheckboxes = [];
    let lastClickedIndex = -1;

    for (const [i, layerName] of this.vectorLayers.entries()) {
      const color = getLayerColor(i);
      const legendItem = createElement('li');
      const label = createElement('label');
      const checkbox = createElement('input', { type: 'checkbox', checked: true });
      checkbox.dataset.layer = layerName;
      checkbox.style.accentColor = color;
      
      const labelText = createElement('span', {}, layerName);
      
      label.append(checkbox, labelText);
      legendItem.appendChild(label);
      this.container.querySelector("#legend-items").appendChild(legendItem);
      
      layerCheckboxes.push(checkbox);
      
      // Handle shift-click for range selection
      const handleChange = (e) => {
        if (e.shiftKey && lastClickedIndex >= 0) {
          const start = Math.min(lastClickedIndex, i);
          const end = Math.max(lastClickedIndex, i);
          for (let j = start; j <= end; j++) {
            layerCheckboxes[j].checked = checkbox.checked;
            this.toggleLayerVisibility(this.vectorLayers[j], checkbox.checked);
          }
        } else {
          this.toggleLayerVisibility(layerName, checkbox.checked);
        }
        lastClickedIndex = i;
      };
      
      checkbox.addEventListener('change', handleChange);
    }

    return layerCheckboxes;
  }

  setupAllCheckboxLogic(allCheckbox, layerCheckboxes) {
    const updateAllCheckboxState = () => {
      const checkedCount = layerCheckboxes.filter(cb => cb.checked).length;
      const totalCount = layerCheckboxes.length;
      
      allCheckbox.checked = checkedCount === totalCount;
      allCheckbox.indeterminate = checkedCount > 0 && checkedCount < totalCount;
    };

    allCheckbox.addEventListener('change', () => {
      for (const [i, checkbox] of layerCheckboxes.entries()) {
        checkbox.checked = allCheckbox.checked;
        this.toggleLayerVisibility(this.vectorLayers[i], allCheckbox.checked);
      }
    });

    for (const checkbox of layerCheckboxes) {
      checkbox.addEventListener('change', updateAllCheckboxState);
    }
    updateAllCheckboxState();
  }

  toggleLayerVisibility(layerName, visible) {
    const visibility = visible ? "visible" : "none";
    const layerIds = [
      `${this.sourceId}_${layerName}_polygons`,
      `${this.sourceId}_${layerName}_linestrings`,
      `${this.sourceId}_${layerName}_points`,
      `${this.sourceId}_${layerName}_point_labels`,
      `${this.sourceId}_${layerName}_linestring_labels`,
      `${this.sourceId}_${layerName}_polygon_labels`
    ];

    for (const layerId of layerIds) {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, "visibility", visibility);
      }
    }
  }
}

class FeatureInfoControl {
  onAdd() {
    this.container = createElement('div', {
      className: 'maplibregl-ctrl feature-info-control feature-info',
      id: 'feature-info'
    });
    return this.container;
  }

  onRemove() {
    this.container?.remove();
  }
}

class ZoomControl {
  onAdd(map) {
    this.container = createElement('div', { className: 'maplibregl-ctrl maplibregl-ctrl-group' });
    Object.assign(this.container.style, {
      color: 'black',
      backgroundColor: 'white',
      padding: '3px 8px',
      fontSize: '11px',
      fontFamily: 'monospace',
      borderRadius: '4px'
    });

    const update = () => {
      this.container.innerHTML = `Z = ${map.getZoom().toFixed(2)}`;
    };

    update();
    map.on('zoom', update);
    return this.container;
  }

  onRemove() {
    this.container?.remove();
  }
}

function setupHoverInteraction(map, vectorLayers, sourceId, containerId) {
  let hoveredFeatures = [];
  let pinnedFeatures = [];
  let isPinned = false;
  const featureInfoPanel = document.getElementById("feature-info");

  if (!featureInfoPanel) return;

  const getQueryLayers = () => vectorLayers
    .flatMap(layer => [`${sourceId}_${layer}_polygons`, `${sourceId}_${layer}_linestrings`, `${sourceId}_${layer}_points`])
    .filter(layerId => map.getLayer(layerId));

  function clearFeatureStates(features) {
    for (const feature of features) {
      if (feature.id !== undefined) {
        map.setFeatureState(feature, { hover: false });
      }
    }
  }

  function setFeatureStates(features, state) {
    for (const feature of features) {
      if (feature.id !== undefined) {
        map.setFeatureState(feature, state);
      }
    }
  }

  function formatOsmInfo(rawId) {
    if (rawId === undefined || rawId === null) return "No ID";
    
    const lastDigit = rawId % 10;
    const osmId = Math.floor(rawId / 10);
    const typeMap = { 1: "node", 2: "way", 3: "relation" };
    const osmType = typeMap[lastDigit] || "unknown";
    
    return osmType !== "unknown" 
      ? `<a href="https://www.openstreetmap.org/${osmType}/${osmId}" target="_blank" style="color: #74c7ec; text-decoration: none;">${osmType}/${osmId}</a>`
      : `${rawId} (unknown type)`;
  }

  function displayFeatures(features, showCloseButton = false) {
    if (!features.length) {
      featureInfoPanel.style.display = "none";
      return;
    }

    let html = showCloseButton 
      ? '<button id="close-feature-info" class="feature-info-close" title="Close">×</button>' 
      : '';

    for (const [index, feature] of features.entries()) {
      if (index > 0) {
        html += '<div style="margin: 4px 0; border-top: 1px solid rgba(255,255,255,0.2);"></div>';
      }

      const layerIndex = vectorLayers.indexOf(feature.sourceLayer);
      const layerColor = layerIndex >= 0 ? getLayerColor(layerIndex) : "#ccc";
      const osmInfo = formatOsmInfo(feature.id);

      html += `
        <div class="feature-header">
          <div style="width: 10px; height: 10px; background-color: ${layerColor}; border-radius: 2px; margin-right: 6px; flex-shrink: 0;"></div>
          <strong>${feature.sourceLayer}</strong>
        </div>
        <div>${osmInfo} · ${feature.geometry.type}</div>
      `;

      if (feature.properties && Object.keys(feature.properties).length > 0) {
        html += '<table>';
        for (const key of Object.keys(feature.properties).sort()) {
          html += `<tr><td>${key}</td><td> = </td><td>${JSON.stringify(feature.properties[key])}</td></tr>`;
        }
        html += '</table>';
      }
    }

    featureInfoPanel.innerHTML = html;
    featureInfoPanel.style.display = "block";

    if (showCloseButton) {
      document.getElementById("close-feature-info")?.addEventListener("click", (e) => {
        e.stopPropagation();
        unpinFeatures();
      });
    }
  }

  function unpinFeatures() {
    if (isPinned) {
      clearFeatureStates(pinnedFeatures);
      pinnedFeatures = [];
      isPinned = false;
      featureInfoPanel.style.display = "none";
    }
  }

  function clearHoverStates() {
    clearFeatureStates(hoveredFeatures);
    hoveredFeatures = [];
    if (!isPinned) featureInfoPanel.style.display = "none";
    map.getCanvas().style.cursor = "";
  }

  function queryFeatures(e) {
    const tolerance = 5;
    const bbox = [
      [e.point.x - tolerance, e.point.y - tolerance],
      [e.point.x + tolerance, e.point.y + tolerance]
    ];
    return map.queryRenderedFeatures(bbox, { layers: getQueryLayers() });
  }

  map.on("mousemove", (e) => {
    if (isPinned) return;

    clearFeatureStates(hoveredFeatures);
    const features = queryFeatures(e);

    if (features.length > 0) {
      const selectedFeatures = selectFeaturesByType(features);
      const featuresWithDistance = selectedFeatures
        .map(feature => ({ feature, distance: getDistanceToFeature(feature, e.lngLat) }))
        .sort((a, b) => a.distance - b.distance);

      hoveredFeatures = featuresWithDistance.map(item => item.feature);
      setFeatureStates(hoveredFeatures, { hover: true });
      displayFeatures(hoveredFeatures);
      map.getCanvas().style.cursor = "pointer";
    } else {
      clearHoverStates();
    }
  });

  map.on("click", (e) => {
    if (isPinned) clearFeatureStates(pinnedFeatures);

    const features = queryFeatures(e);
    if (features.length > 0) {
      const selectedFeatures = selectFeaturesByType(features);
      const featuresWithDistance = selectedFeatures
        .map(feature => ({ feature, distance: getDistanceToFeature(feature, e.lngLat) }))
        .sort((a, b) => a.distance - b.distance);

      pinnedFeatures = featuresWithDistance.map(item => item.feature);
      isPinned = true;

      clearFeatureStates(hoveredFeatures);
      setFeatureStates(pinnedFeatures, { hover: true });
      displayFeatures(pinnedFeatures, true);
    } else {
      unpinFeatures();
    }
  });

  map.on("mouseleave", clearHoverStates);
  document.getElementById(containerId)?.addEventListener("mouseleave", () => {
    if (!isPinned) clearHoverStates();
  });
}

function createStyleLayers(sourceId, vectorLayers) {
  let layers = [];
  
  for (const [i, layerName] of vectorLayers.entries()) {
    const color = getLayerColor(i);

    layers.push({
      id: `${sourceId}_${layerName}_polygons`,
      type: "fill",
      source: sourceId,
      "source-layer": layerName,
      paint: {
        "fill-color": color,
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.4, 0.15]
      },
      filter: ["==", ["geometry-type"], "Polygon"]
    });

    layers.push({
      id: `${sourceId}_${layerName}_linestrings`,
      type: "line",
      source: sourceId,
      "source-layer": layerName,
      paint: {
        "line-color": color,
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0.5]
      },
      filter: ["==", ["geometry-type"], "LineString"]
    });

    layers.push({
      id: `${sourceId}_${layerName}_points`,
      type: "circle",
      source: sourceId,
      "source-layer": layerName,
      paint: {
        "circle-color": color,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 12, 4],
        "circle-opacity": 0.8,
        "circle-stroke-color": "white",
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 3, 0]
      },
      filter: ["==", ["geometry-type"], "Point"]
    });

    layers.push({
      id: `${sourceId}_${layerName}_point_labels`,
      type: "symbol",
      source: sourceId,
      "source-layer": layerName,
      layout: {
        "text-field": ["get", "name"],
        "text-font": TEXT_FONT,
        "text-size": TEXT_SIZE_POINT,
        "text-offset": [0, -0.5],
        "text-anchor": "bottom"
      },
      paint: {
        "text-color": color,
        "text-halo-color": TEXT_HALO_COLOR,
        "text-halo-width": TEXT_HALO_WIDTH,
        "text-halo-blur": TEXT_HALO_BLUR
      },
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"]]
    });

    // LineString labels
    layers.push({
      id: `${sourceId}_${layerName}_linestring_labels`,
      type: "symbol",
      source: sourceId,
      "source-layer": layerName,
      layout: {
        "text-field": ["get", "name"],
        "text-font": TEXT_FONT,
        "text-size": TEXT_SIZE_LINE,
        "symbol-placement": "line",
        "text-rotation-alignment": "map"
      },
      paint: {
        "text-color": color,
        "text-halo-color": TEXT_HALO_COLOR,
        "text-halo-width": TEXT_HALO_WIDTH,
        "text-halo-blur": TEXT_HALO_BLUR
      },
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "name"]]
    });

    // Polygon labels
    layers.push({
      id: `${sourceId}_${layerName}_polygon_labels`,
      type: "symbol",
      source: sourceId,
      "source-layer": layerName,
      layout: {
        "text-field": ["get", "name"],
        "text-font": TEXT_FONT,
        "text-size": TEXT_SIZE_POLYGON,
        "text-max-angle": 85,
        "text-offset": [0, 1],
        "text-rotation-alignment": "map",
        "text-keep-upright": true,
        "symbol-placement": "line",
        "symbol-spacing": 250
      },
      paint: {
        "text-color": color,
        "text-halo-color": TEXT_HALO_COLOR,
        "text-halo-width": TEXT_HALO_WIDTH,
        "text-halo-blur": TEXT_HALO_BLUR
      },
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["has", "name"]]
    });
  }

  layers = [
    ...layers.filter(l => !l.id.includes("labels")),
    ...layers.filter(l => l.id.includes("labels")),
  ]

  return layers;
}

export async function initTilesetViewer(config) {
  const {
    tileJsonUrl,
    containerId = 'map',
    center = [-99.5, 39.5],
    zoom = 4
  } = config;

  const mapContainer = document.getElementById(containerId);
  if (!mapContainer) {
    throw new Error(`Container element with id '${containerId}' not found`);
  }

  // Fetch TileJSON metadata
  let tileJsonData;
  try {
    const response = await fetch(tileJsonUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch TileJSON: ${response.status} ${response.statusText}`);
    }
    tileJsonData = await response.json();
  } catch (error) {
    console.error('Error loading TileJSON:', error);
    mapContainer.innerHTML = `<div style="padding: 20px; color: red;">Error loading tileset: ${error.message}</div>`;
    return;
  }

  // Detect tileset type
  const vectorLayers = tileJsonData.vector_layers?.map(layer => layer.id) || [];
  const isRasterTileset = vectorLayers.length === 0 && tileJsonData.tiles;
  
  if (!isRasterTileset && vectorLayers.length === 0) {
    console.warn('No vector layers or raster tiles found in TileJSON');
    mapContainer.innerHTML = `<div style="padding: 20px; color: orange;">No layers found in this tileset</div>`;
    return;
  }

  // Determine initial view - use config params if provided, otherwise fall back to TileJSON
  let initialCenter = center;
  let initialZoom = zoom;
  
  // Only use TileJSON center/bounds if no center was explicitly provided in config
  if (!config.center && tileJsonData.center) {
    initialCenter = [tileJsonData.center[0], tileJsonData.center[1]];
    initialZoom = tileJsonData.center[2] || zoom;
  } else if (!config.center && tileJsonData.bounds) {
    const bounds = tileJsonData.bounds;
    initialCenter = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  }

  // Create map
  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      glyphs: "https://tiles.openstreetmap.us/fonts/{fontstack}/{range}.pbf",
      sources: {},
      layers: [{
        id: "background",
        type: "background",
        paint: { "background-color": "#001122" }
      }]
    },
    center: initialCenter,
    zoom: initialZoom,
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: false,
    hash: "map"
  });

  map.addControl(new ZoomControl(), "bottom-left");
  
  let legendControl;
  if (!isRasterTileset) {
    legendControl = new LegendControl();
    map.addControl(legendControl, "top-left");
    map.addControl(new FeatureInfoControl(), "top-right");
  }

  map.on("load", () => {
    const sourceId = 'tileset';
    
    if (isRasterTileset) {
      map.addSource(sourceId, { type: "raster", url: tileJsonUrl });
      map.addLayer({ id: `${sourceId}_raster`, type: "raster", source: sourceId });
    } else {
      map.addSource(sourceId, { type: "vector", url: tileJsonUrl });
      const layers = createStyleLayers(sourceId, vectorLayers);
      for (const layer of layers) {
        map.addLayer(layer);
      }
      legendControl.setLayers(vectorLayers, sourceId, map);
      setupHoverInteraction(map, vectorLayers, sourceId, containerId);
    }
  });

  return map;
}

// Global export for backward compatibility
if (typeof window !== 'undefined') {
  window.initTilesetViewer = initTilesetViewer;
}
