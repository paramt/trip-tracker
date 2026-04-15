import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MAP_STYLE, MAP_PROJECTION } from "../trip.config.js";

// ── Projection ────────────────────────────────────────────────────────────────
const WORLD = { lngMin: -180, lngMax: 180, latMin: -58, latMax: 80 };

function targetBoundsFor(pts) {
  if (!pts || pts.length <= 1) return WORLD;
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const latPad = Math.max((latMax - latMin) * 0.4, 2);
  const lngPad = Math.max((lngMax - lngMin) * 0.4, 3);
  return {
    latMin: Math.max(latMin - latPad, -58),
    latMax: Math.min(latMax + latPad, 80),
    lngMin: Math.max(lngMin - lngPad, -180),
    lngMax: Math.min(lngMax + lngPad, 180),
  };
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// ── Mercator projection (exported for App.jsx popup positioning) ──────────────
function mercY(lat) {
  const rad = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}
function invMercY(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

export function projX(lng, b) { return (lng - b.lngMin) / (b.lngMax - b.lngMin); }
export function projY(lat, b) {
  const yLat = mercY(lat), yMin = mercY(b.latMin), yMax = mercY(b.latMax);
  return (yMax - yLat) / (yMax - yMin);
}

// ── GeoJSON helpers ───────────────────────────────────────────────────────────
function routeToGeoJSON(allRoutes) {
  return {
    type: "FeatureCollection",
    features: (allRoutes || []).map((route) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: route.map((p) => [p.lng, p.lat]),
      },
    })),
  };
}

// ── Emit bounds + a map.project()-based pixel converter ──────────────────────
function emitBoundsChange(map, cb) {
  if (!cb) return;
  const b = map.getBounds();
  const container = map.getContainer();
  cb({
    lngMin: b.getWest(), lngMax: b.getEast(),
    latMin: b.getSouth(), latMax: b.getNorth(),
    // project(lng, lat) → { xPct, yPct } in [0,1] relative to container
    // Works correctly in both globe and flat Mercator projection.
    project: (lng, lat) => {
      const pt = map.project([lng, lat]);
      return { xPct: pt.x / container.offsetWidth, yPct: pt.y / container.offsetHeight };
    },
  });
}

function addRouteLayer(map, allRoutes) {
  map.addSource("route", { type: "geojson", data: routeToGeoJSON(allRoutes) });
  map.addLayer({
    id: "route", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#eb4034", "line-width": 3, "line-opacity": 0.55 },
  });
  map.addSource("route-highlight", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
  });
  map.addLayer({
    id: "route-highlight", type: "line", source: "route-highlight",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffcc00", "line-width": 5, "line-opacity": 0.9 },
  });
}

// ── Marker DOM element factory ────────────────────────────────────────────────
function createMarkerEl(event, { onMarkerHover, onMarkerLeave, onMarkerClick }) {
  const div = document.createElement("div");
  div.className = "map-marker map-marker-static";
  div.innerHTML = `<svg class="map-marker-pin" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M12,0 C5.373,0 0,5.373 0,12 C0,21 12,32 12,32 C12,32 24,21 24,12 C24,5.373 18.627,0 12,0 Z"/>
    <circle cx="12" cy="11" r="4.5" fill="white" fill-opacity="0.45"/>
  </svg>`;
  div.addEventListener("mouseenter", () => { if (div.style.opacity !== '0') onMarkerHover?.(event); });
  div.addEventListener("mouseleave", () => onMarkerLeave?.());
  div.addEventListener("click",      () => { if (div.style.opacity !== '0') onMarkerClick?.(event); });
  return div;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WorldMap({
  coords, allCoords = [], allRoutes = [], highlightRoute = null, noZoom = false,
  onMarkerHover, onMarkerLeave, onMarkerClick, onBoundsChange, onZoomChange,
  selectedEvent, hoveredEvent, children,
}) {
  const coordsPts = coords ? (Array.isArray(coords) ? coords : [coords]) : null;

  const containerRef        = useRef(null);
  const mapRef              = useRef(null);
  const markersRef          = useRef(new Map()); // event → { marker, el }
  const coordsPtsRef        = useRef(coordsPts);
  const allRoutesRef        = useRef(allRoutes);
  const highlightRouteRef   = useRef(highlightRoute);
  const noZoomRef           = useRef(noZoom);
  const onBoundsChangeRef   = useRef(onBoundsChange);
  const onZoomChangeRef     = useRef(onZoomChange);
  const callbacksRef        = useRef({ onMarkerHover, onMarkerLeave, onMarkerClick });
  coordsPtsRef.current      = coordsPts;
  allRoutesRef.current      = allRoutes;
  highlightRouteRef.current = highlightRoute;
  noZoomRef.current         = noZoom;
  onBoundsChangeRef.current = onBoundsChange;
  onZoomChangeRef.current   = onZoomChange;
  callbacksRef.current      = { onMarkerHover, onMarkerLeave, onMarkerClick };

  // ── Initialize map ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 0,
      minZoom: 2,
      attributionControl: false,
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    // Hide the canvas container until globe projection is fully active.
    // Using the container div (not the canvas itself) because Firefox's WebGL
    // compositor can present the canvas before CSS opacity on the canvas element
    // propagates, causing a flat-Mercator flash. A regular HTML div is composited
    // consistently across all browsers.
    map.getCanvasContainer().style.opacity = '0';

    map.on("load", () => {
      map.setProjection({ type: MAP_PROJECTION });

      // Hide all POI icons and labels
      map.getStyle().layers
        .filter(l => l.id.startsWith("poi"))
        .forEach(l => map.setLayoutProperty(l.id, "visibility", "none"));

      addRouteLayer(map, allRoutesRef.current);

      // Reveal the map now that globe projection is fully active
      const cc = map.getCanvasContainer();
      cc.style.transition = 'opacity 0.4s ease';
      cc.style.opacity = '1';

      // Fade out loading indicator
      const loading = loadingRef.current;
      if (loading) {
        loading.style.transition = 'opacity 0.4s ease';
        loading.style.opacity = '0';
        setTimeout(() => { loading.style.display = 'none'; }, 400);
      }

      // Fly from globe view down to the route
      const target = noZoomRef.current ? WORLD : targetBoundsFor(coordsPtsRef.current);
      map.fitBounds(
        [[target.lngMin, target.latMin], [target.lngMax, target.latMax]],
        { animate: true, duration: 2000 }
      );
    });

    map.on("move", () => emitBoundsChange(map, onBoundsChangeRef.current));

    const updateMarkerSize = () => {
      const zoom = map.getZoom();
      const size = Math.max(10, Math.min(30, zoom * 2 + 6));
      containerRef.current?.style.setProperty("--marker-size", `${size}px`);
      onZoomChangeRef.current?.(zoom);
    };
    map.on("zoom", updateMarkerSize);
    map.on("load", updateMarkerSize);

    mapRef.current = map;
    return () => {
      for (const [, { marker }] of markersRef.current) marker.remove();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom to bounds when coords / noZoom changes ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = noZoom ? WORLD : targetBoundsFor(coordsPts);
    const fit = () => map.fitBounds(
      [[target.lngMin, target.latMin], [target.lngMax, target.latMax]],
      { animate: true, duration: 500, easing: easeInOut }
    );
    if (map.loaded()) fit();
    // else: on initial mount the map isn't loaded yet; the load handler handles
    // the first zoom so we don't register a competing once("load") here.
  }, [coords, noZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update route source when allRoutes changes ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.getSource("route")?.setData(routeToGeoJSON(allRoutes));
  }, [allRoutes]);

  // ── Update highlight segment ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const coords = highlightRoute ? highlightRoute.map(p => [p.lng, p.lat]) : [];
    const apply = () => {
      // For a single-point highlight, don't draw a line (invalid GeoJSON LineString)
      const lineCoords = highlightRoute && highlightRoute.length > 1 ? coords : [];
      map.getSource("route-highlight")?.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: lineCoords },
      });

      if (highlightRoute && highlightRoute.length > 1) {
        const lats = highlightRoute.map(p => p.lat);
        const lngs = highlightRoute.map(p => p.lng);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { animate: true, duration: 600, easing: easeInOut, padding: Math.min(80, map.getContainer().offsetWidth * 0.1, map.getContainer().offsetHeight * 0.1) }
        );
      } else if (highlightRoute && highlightRoute.length === 1) {
        map.easeTo({ center: [highlightRoute[0].lng, highlightRoute[0].lat], zoom: 8, duration: 600 });
      } else if (!highlightRoute) {
        const target = noZoomRef.current ? WORLD : targetBoundsFor(coordsPtsRef.current);
        map.fitBounds(
          [[target.lngMin, target.latMin], [target.lngMax, target.latMax]],
          { animate: true, duration: 600, easing: easeInOut }
        );
      }
    };
    // If the style isn't loaded yet (source doesn't exist), wait for load.
    // In practice the user clicks long after load, so the first branch always runs.
    if (map.getSource("route-highlight")) {
      apply();
    } else if (highlightRoute) {
      map.once("load", apply);
    }
  }, [highlightRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync markers when allCoords changes ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = markersRef.current;

    // Remove stale markers
    for (const [event, { marker }] of existing) {
      if (!allCoords.find((c) => c.event === event)) {
        marker.remove();
        existing.delete(event);
      }
    }

    // Add new markers
    for (const coord of allCoords) {
      if (!existing.has(coord.event)) {
        const el = createMarkerEl(coord.event, callbacksRef.current);
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([coord.lng, coord.lat])
          .setOpacity('1', '0')
          .addTo(map);
        existing.set(coord.event, { marker, el });
      }
    }

    // Apply current selected/hovered classes
    for (const [event, { el }] of existing) {
      el.classList.toggle("map-marker-selected", event === selectedEvent);
      el.classList.toggle("map-marker-hovered",  event === hoveredEvent);
    }

  }, [allCoords]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update selected/hovered marker classes ────────────────────────────────
  useEffect(() => {
    for (const [event, { el }] of markersRef.current) {
      el.classList.toggle("map-marker-selected", event === selectedEvent);
      el.classList.toggle("map-marker-hovered",  event === hoveredEvent);
    }
  }, [selectedEvent, hoveredEvent]);

  const loadingRef = useRef(null);

  const starCanvasRef = useRef(null);
  useEffect(() => {
    const canvas = starCanvasRef.current;
    if (!canvas) return;
    const { offsetWidth: w, offsetHeight: h } = canvas.parentElement;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 250; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.6 + 0.2).toFixed(2)})`;
      ctx.fill();
    }
  }, []);

  return (
    <div className="world-map" ref={containerRef}>
      <canvas ref={starCanvasRef} className="star-field" />
      <div ref={loadingRef} className="map-loading">
        <svg className="loading-globe" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          {/* Globe outline */}
          <circle cx="50" cy="50" r="38" className="gl-outline" />
          {/* Latitude parallels — static */}
          <ellipse cx="50" cy="31" rx="29" ry="8"  className="gl-lat" />
          <ellipse cx="50" cy="50" rx="38" ry="10" className="gl-lat" />
          <ellipse cx="50" cy="69" rx="29" ry="8"  className="gl-lat" />
          {/* Meridians — 6 circles offset 30° apart, spin as a group */}
          <g className="gl-meridians">
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer" />
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer gl-mer-b" />
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer gl-mer-c" />
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer gl-mer-d" />
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer gl-mer-e" />
            <ellipse cx="50" cy="50" rx="38" ry="38" className="gl-mer gl-mer-f" />
          </g>
        </svg>
      </div>
      {children}
    </div>
  );
}
