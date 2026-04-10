import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

const OFM_STYLE = "https://tiles.openfreemap.org/styles/positron";

// ── Projection ────────────────────────────────────────────────────────────────
const WORLD = { lngMin: -180, lngMax: 180,  latMin: -58, latMax: 80 };
const NA    = { lngMin: -173, lngMax:  -26, latMin:  22, latMax: 73 };
const CA    = { lngMin: -134, lngMax: -108, latMin:  32, latMax: 44 };
const US    = { lngMin: -125, lngMax:  -66, latMin:  24, latMax: 50 };

function isCalifornia(lat, lng)   { return lat >= 32 && lat <= 42 && lng >= -125 && lng <= -114; }
function isNorthAmerica(lat, lng) { return lat >= 22 && lat <= 73 && lng >= -170 && lng <= -50; }
function targetBoundsFor(pts) {
  if (!pts || pts.length === 0) return WORLD;
  if (pts.length === 1) {
    const { lat, lng } = pts[0];
    if (isCalifornia(lat, lng))   return CA;
    if (isNorthAmerica(lat, lng)) return NA;
    return WORLD;
  }
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

// ── Emit bounds in the {lngMin,lngMax,latMin,latMax} shape App.jsx expects ───
function emitBoundsChange(map, cb) {
  if (!cb) return;
  const b = map.getBounds();
  cb({ lngMin: b.getWest(), lngMax: b.getEast(), latMin: b.getSouth(), latMax: b.getNorth() });
}

function addRouteLayer(map, allRoutes) {
  map.addSource("route", { type: "geojson", data: routeToGeoJSON(allRoutes) });
  map.addLayer({
    id: "route", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#eb4034", "line-width": 3, "line-opacity": 0.55 },
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
  div.addEventListener("mouseenter", () => onMarkerHover?.(event));
  div.addEventListener("mouseleave", () => onMarkerLeave?.());
  div.addEventListener("click",      () => onMarkerClick?.(event));
  return div;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WorldMap({
  coords, allCoords = [], allRoutes = [], noZoom = false,
  onMarkerHover, onMarkerLeave, onMarkerClick, onBoundsChange, onZoomChange,
  selectedEvent, hoveredEvent, children,
}) {
  const coordsPts = coords ? (Array.isArray(coords) ? coords : [coords]) : null;

  const containerRef       = useRef(null);
  const mapRef             = useRef(null);
  const markersRef         = useRef(new Map()); // event → { marker, el }
  const coordsPtsRef       = useRef(coordsPts);
  const allRoutesRef       = useRef(allRoutes);
  const noZoomRef          = useRef(noZoom);
  const onBoundsChangeRef  = useRef(onBoundsChange);
  const onZoomChangeRef    = useRef(onZoomChange);
  const callbacksRef       = useRef({ onMarkerHover, onMarkerLeave, onMarkerClick });
  coordsPtsRef.current     = coordsPts;
  allRoutesRef.current     = allRoutes;
  noZoomRef.current        = noZoom;
  onBoundsChangeRef.current = onBoundsChange;
  onZoomChangeRef.current   = onZoomChange;
  callbacksRef.current     = { onMarkerHover, onMarkerLeave, onMarkerClick };

  // ── Initialize map ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OFM_STYLE,
      center: [-96, 38],
      zoom: 3,
      attributionControl: false,
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on("load", () => {
      addRouteLayer(map, allRoutesRef.current);

      // Fit to initial target
      const target = noZoomRef.current ? US : targetBoundsFor(coordsPtsRef.current);
      map.fitBounds(
        [[target.lngMin, target.latMin], [target.lngMax, target.latMax]],
        { animate: false }
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
    const target = noZoom ? US : targetBoundsFor(coordsPts);
    const fit = () => map.fitBounds(
      [[target.lngMin, target.latMin], [target.lngMax, target.latMax]],
      { animate: true, duration: 500, easing: easeInOut }
    );
    if (map.loaded()) fit();
    else map.once("load", fit);
  }, [coords, noZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update route source when allRoutes changes ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.getSource("route")?.setData(routeToGeoJSON(allRoutes));
  }, [allRoutes]);

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

  return (
    <div className="world-map" ref={containerRef}>
      {children}
    </div>
  );
}
