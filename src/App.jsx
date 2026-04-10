import { useState, useRef } from 'react';
import '@fontsource-variable/caveat';
import WorldMap, { projX, projY } from './components/WorldMap';
import Polaroid from './components/Polaroid';
import rawPhotos from './data/photos.json';

function formatDate(datetime) {
  if (!datetime) return null;
  const d = new Date(datetime);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// All GPS photos in chronological order
const gpsPhotos = rawPhotos
  .filter(p => p.lat != null && p.lng != null)
  .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''));

// Marker entries — one per GPS photo
const allCoords = gpsPhotos.map(p => ({ lat: p.lat, lng: p.lng, event: p }));

// Full trip route line
const globalRoute = gpsPhotos.length > 1
  ? [gpsPhotos.map(p => ({ lat: p.lat, lng: p.lng }))]
  : [];

export default function App() {
  const [hoveredPhoto, setHoveredPhoto] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const boundsRef = useRef(null);

  const activePhoto = hoveredPhoto ?? selectedPhoto;
  const popupPos = activePhoto && boundsRef.current ? (() => {
    const xPct = projX(activePhoto.lng, boundsRef.current) * 100;
    const yPct = projY(activePhoto.lat, boundsRef.current) * 100;
    // Shift popup horizontally so it stays on screen near edges
    // Polaroid is 260px wide; clamp so it doesn't overflow left or right
    let xShift = '-50%';
    if (xPct < 15) xShift = '0%';
    else if (xPct > 85) xShift = '-100%';
    return {
      left: `${xPct}%`,
      top: `${yPct}%`,
      transform: `translateX(${xShift}) translateY(18px)`,
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
              onMarkerClick={photo => setSelectedPhoto(prev => prev === photo ? null : photo)}
              onBoundsChange={b => { boundsRef.current = b; }}
              selectedEvent={selectedPhoto}
            />
            {activePhoto && popupPos && (
              <div className="map-photo-popup" style={popupPos}>
                <Polaroid
                  src={activePhoto.file}
                  thumb={activePhoto.thumb}
                  w={activePhoto.width}
                  h={activePhoto.height}
                  date={formatDate(activePhoto.datetime)}
                  location={activePhoto.location ?? null}
                  color
                  static
                  tack={false}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
