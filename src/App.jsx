import { useState, useRef, useEffect } from 'react';
import '@fontsource-variable/caveat';
import WorldMap, { projX, projY } from './components/WorldMap';
import Polaroid from './components/Polaroid';
import rawPhotos from './data/photos.json';
import rawRoute from './data/route.json';

function formatDate(datetime) {
  if (!datetime) return null;
  const d = new Date(datetime);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

// All GPS photos in chronological order
const gpsPhotos = rawPhotos
  .filter(p => p.lat != null && p.lng != null)
  .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''))
  .map(p => ({ ...p, file: base + p.file, thumb: base + p.thumb, _rotate: (Math.random() - 0.5) * 8 }));

// Marker entries — one per GPS photo
const allCoords = gpsPhotos.map(p => ({ lat: p.lat, lng: p.lng, event: p }));

// Road-snapped route from process.js; fall back to straight lines if not yet generated
const globalRoute = (() => {
  const coords = rawRoute?.coordinates;
  if (Array.isArray(coords) && coords.length > 1)
    return [coords.map(([lng, lat]) => ({ lat, lng }))];
  return gpsPhotos.length > 1
    ? [gpsPhotos.map(p => ({ lat: p.lat, lng: p.lng }))]
    : [];
})();

export default function App() {
  const [hoveredPhoto, setHoveredPhoto] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const boundsRef = useRef(null);
  const zoomRef = useRef(5);

  useEffect(() => {
    gpsPhotos.forEach(p => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = p.thumb;
      link.fetchPriority = 'low';
      document.head.appendChild(link);
    });
  }, []);

  const activePhoto = hoveredPhoto;
  const popupPos = activePhoto && boundsRef.current ? (() => {
    const xPct = projX(activePhoto.lng, boundsRef.current) * 100;
    const yPct = projY(activePhoto.lat, boundsRef.current) * 100;
    // Shift popup horizontally so it stays on screen near edges
    // Polaroid is 260px wide; clamp so it doesn't overflow left or right
    let xShift = '-50%';
    if (xPct < 15) xShift = '0%';
    else if (xPct > 85) xShift = '-100%';
    // Scale popup with zoom: smaller when zoomed out, capped at 1 when zoomed in
    const popupScale = Math.max(0.5, Math.min(1, zoomRef.current / 6));
    // Flip popup above the pin when it would overflow the bottom of the screen.
    // Polaroid renders at 260px wide; compute its rendered height from the photo's aspect ratio.
    // Add 40px buffer: photos are rotated up to ±4° which increases their bounding box height
    const popupHeightPct = (260 * popupScale * (activePhoto.height / activePhoto.width) + 40) / window.innerHeight * 100;
    const isAbove = yPct + popupHeightPct > 100;
    const yShift = isAbove ? 'calc(-100% - 24px)' : '18px';
    const xOrigin = xShift === '0%' ? 'left' : xShift === '-100%' ? 'right' : 'center';
    const yOrigin = isAbove ? 'bottom' : 'top';
    return {
      left: `${xPct}%`,
      top: `${yPct}%`,
      transform: `translateX(${xShift}) translateY(${yShift}) scale(${popupScale})`,
      transformOrigin: `${xOrigin} ${yOrigin}`,
    };
  })() : null;

  return (
    <div className="app">
      <div className="map-full" onMouseLeave={() => setHoveredPhoto(null)}>
        {rawPhotos.length === 0 ? (
          <div className="empty-state">
            <p>Drop photos into <code>public/dump/</code> and run <code>npm run process</code> to get started.</p>
          </div>
        ) : (
          <>
            <WorldMap
              coords={null}
              allCoords={allCoords}
              allRoutes={globalRoute}
              noZoom={true}
              onMarkerHover={photo => setHoveredPhoto(photo)}
              onMarkerLeave={() => setHoveredPhoto(null)}
              onMarkerClick={photo => setExpandedPhoto(prev => prev === photo ? null : photo)}
              onBoundsChange={b => { boundsRef.current = b; }}
              onZoomChange={z => { zoomRef.current = z; }}
              selectedEvent={expandedPhoto}
              hoveredEvent={hoveredPhoto}
            />
            {activePhoto && popupPos && !expandedPhoto && (
              <div className="map-photo-popup" style={popupPos}>
                <Polaroid
                  src={activePhoto.thumb}
                  w={activePhoto.width}
                  h={activePhoto.height}
                  date={formatDate(activePhoto.datetime)}
                  location={activePhoto.location ?? null}
                  rotate={activePhoto._rotate}
                  color
                  static
                  tack={false}
                />
              </div>
            )}
            {expandedPhoto && (
              <div
                className="polaroid-overlay"
                onClick={() => setExpandedPhoto(null)}
              >
                <button
                  className="polaroid-overlay-close"
                  onClick={() => setExpandedPhoto(null)}
                  aria-label="Close"
                >✕</button>
                <div
                  className="polaroid-expanded"
                  onClick={e => e.stopPropagation()}
                >
                  <Polaroid
                    src={expandedPhoto.file}
                    thumb={expandedPhoto.thumb}
                    w={expandedPhoto.width}
                    h={expandedPhoto.height}
                    date={formatDate(expandedPhoto.datetime)}
                    location={expandedPhoto.location ?? null}
                    rotate={expandedPhoto._rotate}
                    color
                    tack={false}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
