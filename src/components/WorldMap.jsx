import { useEffect, useLayoutEffect, useRef } from "react";

// ── Country data (world-atlas, geographic lon/lat) ────────────────────────────
let geoCache = null;
let geoPromise = null;
function fetchGeo() {
  if (geoCache) return Promise.resolve(geoCache);
  if (geoPromise) return geoPromise;
  geoPromise = fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json")
    .then((r) => r.json())
    .then((t) => { geoCache = t; return t; });
  return geoPromise;
}

// ── US state data (us-atlas, geographic WGS84) ───────────────────────────────
let statesCache = null;
let statesPromise = null;
function fetchStates() {
  if (statesCache) return Promise.resolve(statesCache);
  if (statesPromise) return statesPromise;
  statesPromise = fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
    .then((r) => r.json())
    .then((t) => { statesCache = t; return t; });
  return statesPromise;
}

// ── Canadian province data (GeoJSON, WGS84) ───────────────────────────────────
let provincesCache = null;
let provincesPromise = null;
function fetchProvinces() {
  if (provincesCache) return Promise.resolve(provincesCache);
  if (provincesPromise) return provincesPromise;
  provincesPromise = fetch(`${import.meta.env.BASE_URL}canada-provinces.geojson`)
    .then((r) => r.json())
    .then((t) => { provincesCache = t; return t; });
  return provincesPromise;
}

// ── Projection ────────────────────────────────────────────────────────────────
const WORLD = { lngMin: -180, lngMax: 180,  latMin: -58, latMax: 80 };
const NA    = { lngMin: -173, lngMax:  -26, latMin:  22, latMax: 73 };
const CA    = { lngMin: -134, lngMax: -108, latMin:  32, latMax: 44 };
const US    = { lngMin: -125, lngMax:  -66, latMin:  24, latMax: 50 };
const ANIM_DURATION = 500;

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
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpBounds(a, b, t) {
  return {
    lngMin: lerp(a.lngMin, b.lngMin, t), lngMax: lerp(a.lngMax, b.lngMax, t),
    latMin: lerp(a.latMin, b.latMin, t), latMax: lerp(a.latMax, b.latMax, t),
  };
}

// ── Mercator projection ───────────────────────────────────────────────────────
// Conformal — shapes look correct everywhere, no distortion as you pan north/south.
function mercY(lat) {
  const rad = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}
function invMercY(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

// adjustBoundsToAspect: mercYspan = lngSpan_rad * h/w ensures equal x/y scale.
function adjustBoundsToAspect(b, w, h) {
  const lngSpan = b.lngMax - b.lngMin;
  const yMid = mercY((b.latMax + b.latMin) / 2);
  const halfYSpan = lngSpan * (Math.PI / 180) * (h / w) / 2;
  return {
    lngMin: b.lngMin,
    lngMax: b.lngMax,
    latMin: invMercY(yMid - halfYSpan),
    latMax: invMercY(yMid + halfYSpan),
  };
}

// ── Interaction helpers ───────────────────────────────────────────────────────
function boundsFromLngMid(lngMin, lngMax, latMid) {
  return { lngMin, lngMax, latMin: latMid - 1, latMax: latMid + 1 };
}
const MIN_LNG_SPAN = 5;     // max zoom (~large state level)
const MAX_LNG_SPAN = 300;   // min zoom (slightly inside full world)
const MERC_LIMIT = mercY(85); // Mercator y at ±85° — clamp viewport edges here

// Clamp so viewport edges stay within ±85° lat and [-180, 180] lng.
function clampBounds(b, w, h) {
  const lngSpan = b.lngMax - b.lngMin;
  // Clamp longitude so viewport edges stay within [-180, 180]
  const rawLngMid = (b.lngMin + b.lngMax) / 2;
  const lngMid = Math.max(-180 + lngSpan / 2, Math.min(180 - lngSpan / 2, rawLngMid));
  const newLngMin = lngMid - lngSpan / 2;
  const newLngMax = lngMid + lngSpan / 2;
  // Clamp latitude edges to ±85° in Mercator space
  const yMid = mercY((b.latMax + b.latMin) / 2);
  const halfYSpan = lngSpan * (Math.PI / 180) * (h / w) / 2;
  const clampedYMid = Math.max(-MERC_LIMIT + halfYSpan, Math.min(MERC_LIMIT - halfYSpan, yMid));
  const latMid = invMercY(clampedYMid);
  return { lngMin: newLngMin, lngMax: newLngMax, latMin: latMid - 1, latMax: latMid + 1 };
}

export function projX(lng, b) { return (lng - b.lngMin) / (b.lngMax - b.lngMin); }
export function projY(lat, b) {
  const yLat = mercY(lat), yMin = mercY(b.latMin), yMax = mercY(b.latMax);
  return (yMax - yLat) / (yMax - yMin);
}

// ── Generic arc-path renderer ─────────────────────────────────────────────────
// Decode TopoJSON arcs to geographic [lng, lat] pairs once (no projection yet).
// Cached separately from pixel-space rendering so each frame only re-projects.
function buildGeoArcs(topo) {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

// Per-ring longitude normalization: each point is kept within 180° of the
// previous point in the same ring. This eliminates antimeridian jumps
// (Russia, Alaska) regardless of viewport position, without any special-casing.
// Points that project outside the canvas are drawn off-screen and auto-clipped.
function tracePath(ctx, geoArcs, rings, w, h, bounds) {
  ctx.beginPath();
  rings.forEach((ring) => {
    let first = true, lastLng = null;
    ring.forEach((idx) => {
      const rev = idx < 0;
      const pts = geoArcs[rev ? ~idx : idx];
      const ordered = rev ? [...pts].reverse() : pts;
      ordered.forEach(([rawLng, lat]) => {
        let lng = rawLng;
        if (lastLng !== null) {
          while (lng < lastLng - 180) lng += 360;
          while (lng > lastLng + 180) lng -= 360;
        }
        lastLng = lng;
        const px = projX(lng, bounds) * w;
        const py = projY(lat, bounds) * h;
        if (first) { ctx.moveTo(px, py); first = false; }
        else { ctx.lineTo(px, py); }
      });
    });
    ctx.closePath();
  });
}

function eachGeom(geom, fn) {
  if (!geom) return;
  if (geom.type === "GeometryCollection") { geom.geometries.forEach(g => eachGeom(g, fn)); return; }
  fn(geom);
}

// ── Country map renderer ──────────────────────────────────────────────────────
// Split into fills and borders so borders can be drawn after state/province fills,
// preventing the US-Canada border from being painted over.
function drawCountryFills(ctx, topo, geoArcs, w, h, isDark, bounds) {
  ctx.fillStyle = isDark ? "#1a1a1a" : "#efefef";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = isDark ? "#333333" : "#bebebe";

  eachGeom(topo.objects.countries, (geom) => {
    const arcSets = geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
    arcSets.forEach((rings) => { tracePath(ctx, geoArcs, rings, w, h, bounds); ctx.fill("evenodd"); });
  });
}

function drawCountryBorders(ctx, topo, geoArcs, w, h, isDark, bounds) {
  const zoom = 360 / (bounds.lngMax - bounds.lngMin);
  const borderOpacity = Math.min(1, Math.max(0, (zoom - 1.8) / 0.7));
  if (borderOpacity <= 0) return;

  ctx.strokeStyle = isDark ? `rgba(26,26,26,${borderOpacity})` : `rgba(239,239,239,${borderOpacity})`;
  ctx.lineWidth = 0.75;
  eachGeom(topo.objects.countries, (geom) => {
    const arcSets = geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
    arcSets.forEach((rings) => { tracePath(ctx, geoArcs, rings, w, h, bounds); ctx.stroke(); });
  });
}

// ── US state renderer ────────────────────────────────────────────────────────
// Always fills state polygons with land color (high-res 10m coastline overlaid
// on the coarser world atlas). State border lines fade in separately at zoom.
function drawStates(ctx, topo, geoArcs, w, h, isDark, bounds, opacity) {
  if (!topo || !geoArcs) return;

  // Fill: replace rough world-atlas US coast with crisp 10m state polygons
  ctx.fillStyle = isDark ? "#333333" : "#bebebe";
  eachGeom(topo.objects.states, (geom) => {
    const arcSets = geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
    arcSets.forEach((rings) => {
      tracePath(ctx, geoArcs, rings, w, h, bounds);
      ctx.fill("evenodd");
    });
  });

  // Borders: fade in at higher zoom
  if (opacity > 0) {
    ctx.strokeStyle = isDark ? `rgba(26,26,26,${opacity})` : `rgba(239,239,239,${opacity})`;
    ctx.lineWidth = 1.5;
    eachGeom(topo.objects.states, (geom) => {
      const arcSets = geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
      arcSets.forEach((rings) => {
        rings.forEach((ring) => {
          tracePath(ctx, geoArcs, [ring], w, h, bounds);
          ctx.stroke();
        });
      });
    });
  }
}

// ── Canadian province renderer (GeoJSON) ─────────────────────────────────────
// Fills replace coarse world-atlas coast; borders fade in at same zoom as US states.
function traceGeoRing(ctx, coords, w, h, bounds) {
  if (!coords.length) return;
  ctx.moveTo(projX(coords[0][0], bounds) * w, projY(coords[0][1], bounds) * h);
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(projX(coords[i][0], bounds) * w, projY(coords[i][1], bounds) * h);
  }
  ctx.closePath();
}

function drawProvinces(ctx, geojson, w, h, isDark, bounds, opacity) {
  if (!geojson) return;

  ctx.fillStyle = isDark ? "#333333" : "#bebebe";
  for (const feature of geojson.features) {
    const { type, coordinates } = feature.geometry;
    ctx.beginPath();
    if (type === "Polygon") {
      coordinates.forEach(ring => traceGeoRing(ctx, ring, w, h, bounds));
    } else if (type === "MultiPolygon") {
      coordinates.forEach(poly => poly.forEach(ring => traceGeoRing(ctx, ring, w, h, bounds)));
    }
    ctx.fill("evenodd");
  }

  if (opacity > 0) {
    ctx.strokeStyle = isDark ? `rgba(26,26,26,${opacity})` : `rgba(239,239,239,${opacity})`;
    ctx.lineWidth = 1.5;
    for (const feature of geojson.features) {
      const { type, coordinates } = feature.geometry;
      ctx.beginPath();
      if (type === "Polygon") {
        coordinates.forEach(ring => traceGeoRing(ctx, ring, w, h, bounds));
      } else if (type === "MultiPolygon") {
        coordinates.forEach(poly => poly.forEach(ring => traceGeoRing(ctx, ring, w, h, bounds)));
      }
      ctx.stroke();
    }
  }
}

// ── Route polyline renderer ───────────────────────────────────────────────────
function drawRoute(ctx, pts, w, h, b, alpha = 0.55) {
  if (!pts || pts.length < 2) return;
  const px = pts.map(c => projX(c.lng, b) * w);
  const py = pts.map(c => projY(c.lat, b) * h);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px[0], py[0]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(px[i], py[i]);
  }
  ctx.strokeStyle = '#eb4034';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────
// coords: { lat, lng } | Array<{ lat, lng }> | null
export default function WorldMap({ coords, allCoords = [], allRoutes = [], noZoom = false, onMarkerHover, onMarkerLeave, onMarkerClick, onBoundsChange, selectedEvent, hoveredEvent, children }) {
  // Normalise coords to an array (or null) for uniform handling
  const coordsPts = coords ? (Array.isArray(coords) ? coords : [coords]) : null;

  const canvasRef          = useRef(null);
  const activeMarkersRef   = useRef(null);
  const staticMarkersRef   = useRef(null);
  const topoRef            = useRef(null);
  const geoArcsRef         = useRef(null);  // decoded geographic arcs for world-atlas
  const statesRef          = useRef(null);
  const statesGeoArcsRef   = useRef(null);  // decoded geographic arcs for us-atlas
  const provincesRef       = useRef(null);
  const isDarkRef          = useRef(false);
  const curBounds          = useRef(WORLD);
  const animFrom           = useRef(WORLD);
  const animTo             = useRef(WORLD);
  const rafRef             = useRef(null);
  const coordsPtsRef       = useRef(coordsPts);
  const allCoordsRef       = useRef(allCoords);
  const allRoutesRef       = useRef(allRoutes);
  const noZoomRef          = useRef(noZoom);
  const onBoundsChangeRef  = useRef(onBoundsChange);
  const isDraggingRef      = useRef(false);
  const dragStartRef       = useRef(null);
  const lastTouchesRef     = useRef([]);
  coordsPtsRef.current   = coordsPts;
  allCoordsRef.current   = allCoords;
  allRoutesRef.current   = allRoutes;
  noZoomRef.current      = noZoom;
  onBoundsChangeRef.current = onBoundsChange;

  function renderFrame(b) {
    const canvas = canvasRef.current;
    const topo   = topoRef.current;
    if (canvas && topo) {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (w && h) {
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        const ab = adjustBoundsToAspect(b, w, h);
        // Draw fills first, then all borders on top so country borders (e.g. US-Canada)
        // aren't painted over by state/province fills.
        const geoArcs = geoArcsRef.current;
        drawCountryFills(ctx, topo, geoArcs, w, h, isDarkRef.current, ab);

        const zoom = 360 / (ab.lngMax - ab.lngMin);
        const stateOpacity = Math.min(1, Math.max(0, (zoom - 5) / 5));
        drawStates(ctx, statesRef.current, statesGeoArcsRef.current, w, h, isDarkRef.current, ab, stateOpacity);
        drawProvinces(ctx, provincesRef.current, w, h, isDarkRef.current, ab, stateOpacity);

        // Country borders on top of all fills
        drawCountryBorders(ctx, topo, geoArcs, w, h, isDarkRef.current, ab);

        const activePts = coordsPtsRef.current;
        // Background routes: same visibility rule as static markers
        if (!activePts || noZoomRef.current) {
          allRoutesRef.current.forEach((route) => {
            if (route !== activePts) drawRoute(ctx, route, w, h, ab, 0.25);
          });
        }
        // Active route on top at full opacity
        if (activePts && activePts.length > 1) drawRoute(ctx, activePts, w, h, ab, 1.0);

        const activeContainer = activeMarkersRef.current;
        const pts = coordsPtsRef.current;
        if (activeContainer && pts) {
          const endpts = pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts;
          const children = activeContainer.children;
          for (let i = 0; i < children.length && i < endpts.length; i++) {
            children[i].style.left = `${projX(endpts[i].lng, ab) * 100}%`;
            children[i].style.top  = `${projY(endpts[i].lat, ab) * 100}%`;
          }
        }

        const staticContainer = staticMarkersRef.current;
        if (staticContainer && (!coordsPtsRef.current || noZoomRef.current)) {
          const children = staticContainer.children;
          const allPts = allCoordsRef.current;
          for (let i = 0; i < children.length && i < allPts.length; i++) {
            children[i].style.left = `${projX(allPts[i].lng, ab) * 100}%`;
            children[i].style.top  = `${projY(allPts[i].lat, ab) * 100}%`;
          }
        }

        onBoundsChangeRef.current?.(ab);
      }
    }
  }

  function animateTo(target) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    animFrom.current = { ...curBounds.current };
    animTo.current   = target;
    const start = performance.now();
    function tick(now) {
      const raw = Math.min((now - start) / ANIM_DURATION, 1);
      const b   = lerpBounds(animFrom.current, animTo.current, easeInOut(raw));
      curBounds.current = b;
      renderFrame(b);
      if (raw < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function applyZoom(canvas, focalClientX, focalClientY, scaleFactor) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const ab = adjustBoundsToAspect(curBounds.current, w, h);
    const lngSpan = ab.lngMax - ab.lngMin;

    // Normalized cursor position [0,1]
    const fx = (focalClientX - rect.left) / w;
    const fy = (focalClientY - rect.top)  / h;

    // Geographic coords under cursor (Mercator-correct)
    const focalLng = ab.lngMin + fx * lngSpan;
    const yMax = mercY(ab.latMax), yMin = mercY(ab.latMin), ySpan = yMax - yMin;
    const focalMercY = yMax - fy * ySpan;

    // New spans — Mercator: mercYspan = lngSpan_rad * h/w, so it scales with lngSpan
    const newLngSpan = Math.min(MAX_LNG_SPAN, Math.max(MIN_LNG_SPAN, lngSpan / scaleFactor));
    const newYSpan = newLngSpan * (Math.PI / 180) * (h / w);

    // Keep focal point fixed: focalMercY stays at screen position fy
    const newYMax = focalMercY + fy * newYSpan;
    const newLatMid = invMercY(newYMax - newYSpan / 2);

    const newLngMin = focalLng - fx * newLngSpan;
    const newLngMax = newLngMin + newLngSpan;

    const newB = clampBounds(boundsFromLngMid(newLngMin, newLngMax, newLatMid), w, h);
    curBounds.current = newB;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    renderFrame(newB);
  }

  function applyPanDelta(canvas, dx, dy) {
    const { width: w, height: h } = canvas.getBoundingClientRect();
    const ab = adjustBoundsToAspect(curBounds.current, w, h);
    const lngSpan = ab.lngMax - ab.lngMin;
    const yMax = mercY(ab.latMax), yMin = mercY(ab.latMin), ySpan = yMax - yMin;
    const dLng = -(dx / w) * lngSpan;
    const dY   =  (dy / h) * ySpan;  // drag down → pan north → yMid increases
    const newLatMid = invMercY((yMax + yMin) / 2 + dY);
    const newB = clampBounds(boundsFromLngMid(ab.lngMin + dLng, ab.lngMax + dLng, newLatMid), w, h);
    curBounds.current = newB;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    renderFrame(newB);
  }

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    isDarkRef.current = false; // dark mode disabled
    const onChange = (e) => { isDarkRef.current = false; renderFrame(curBounds.current); };
    mq.addEventListener("change", onChange);

    fetchGeo().then((topo) => { topoRef.current = topo; geoArcsRef.current = buildGeoArcs(topo); renderFrame(curBounds.current); });
    fetchStates().then((s) => { statesRef.current = s; statesGeoArcsRef.current = buildGeoArcs(s); renderFrame(curBounds.current); });
    fetchProvinces().then((p) => { provincesRef.current = p; renderFrame(curBounds.current); });

    const ro = new ResizeObserver(() => renderFrame(curBounds.current));
    if (canvasRef.current) ro.observe(canvasRef.current);

    return () => {
      mq.removeEventListener("change", onChange);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (noZoom) {
      animateTo(US);
    } else {
      animateTo(targetBoundsFor(coordsPts));
    }
  }, [coords, noZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix marker alignment: JSX styles use curBounds (raw) but canvas uses ab (aspect-adjusted).
  // Re-run renderFrame synchronously before every paint to keep marker DOM in sync.
  useLayoutEffect(() => {
    if (topoRef.current) renderFrame(curBounds.current);
  }); // no deps — runs after every render

  // ── Scroll / drag / touch interaction ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onWheel(e) {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      applyZoom(canvas, e.clientX, e.clientY, scale);
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    }
    function onMouseMove(e) {
      if (!isDraggingRef.current) return;
      const { x, y } = dragStartRef.current;
      applyPanDelta(canvas, e.clientX - x, e.clientY - y);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
    function onMouseUp() {
      isDraggingRef.current = false;
      canvas.style.cursor = '';
    }

    function onTouchStart(e) {
      e.preventDefault();
      lastTouchesRef.current = Array.from(e.touches);
    }
    function onTouchMove(e) {
      e.preventDefault();
      const touches = Array.from(e.touches);
      const prev = lastTouchesRef.current;
      if (touches.length === 1 && prev.length === 1) {
        applyPanDelta(canvas, touches[0].clientX - prev[0].clientX,
                              touches[0].clientY - prev[0].clientY);
      } else if (touches.length === 2 && prev.length === 2) {
        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        const prevMidX = (prev[0].clientX + prev[1].clientX) / 2;
        const prevMidY = (prev[0].clientY + prev[1].clientY) / 2;
        applyPanDelta(canvas, midX - prevMidX, midY - prevMidY);
        const dist     = Math.hypot(touches[0].clientX - touches[1].clientX,
                                    touches[0].clientY - touches[1].clientY);
        const prevDist = Math.hypot(prev[0].clientX - prev[1].clientX,
                                    prev[0].clientY - prev[1].clientY);
        if (prevDist > 0) applyZoom(canvas, midX, midY, dist / prevDist);
      }
      lastTouchesRef.current = touches;
    }
    function onTouchEnd(e) {
      lastTouchesRef.current = Array.from(e.touches);
    }

    canvas.addEventListener('wheel',      onWheel,      { passive: false });
    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    window.addEventListener('mousemove',  onMouseMove);
    window.addEventListener('mouseup',    onMouseUp);

    return () => {
      canvas.removeEventListener('wheel',      onWheel);
      canvas.removeEventListener('mousedown',  onMouseDown);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
      window.removeEventListener('mousemove',  onMouseMove);
      window.removeEventListener('mouseup',    onMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="world-map">
      <canvas ref={canvasRef} className="world-map-canvas" />
      {coordsPts && (
        <div ref={activeMarkersRef} aria-hidden="true">
          {(coordsPts.length > 1 ? [coordsPts[0], coordsPts[coordsPts.length - 1]] : coordsPts).map((c, i) => (
            <div
              key={i}
              className="map-marker"
              style={{
                left: `${projX(c.lng, curBounds.current) * 100}%`,
                top:  `${projY(c.lat, curBounds.current) * 100}%`,
              }}
            >
              {coordsPts.length === 1 && <div className="map-marker-pulse" />}
              <div className="map-marker-dot" />
            </div>
          ))}
        </div>
      )}
      {(!coordsPts || noZoom) && (
        <div ref={staticMarkersRef} aria-hidden="true">
          {allCoords.map((c, i) => (
            <div
              key={i}
              className={`map-marker map-marker-static${c.event === selectedEvent ? ' map-marker-selected' : ''}${c.event === hoveredEvent ? ' map-marker-hovered' : ''}`}
              style={{
                left: `${projX(c.lng, curBounds.current) * 100}%`,
                top:  `${projY(c.lat, curBounds.current) * 100}%`,
              }}
              onMouseEnter={() => onMarkerHover?.(c.event)}
              onMouseLeave={() => onMarkerLeave?.()}
              onClick={() => onMarkerClick?.(c.event)}
            >
              <div className="map-marker-dot" />
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
