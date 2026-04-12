import { useState, useRef, useEffect, useMemo } from 'react';
import '@fontsource-variable/caveat';
import WorldMap, { projX, projY } from './components/WorldMap';
import Polaroid from './components/Polaroid';
import rawPhotos from './data/photos.json';
import rawRoute from './data/route.json';

const TRIP_LEGS = [
  { icon: '🚗', label: 'Waterloo → Chicago' },
  { icon: '🛣️', label: 'Chicago → LA', note: 'via Historic Route 66' },
  { icon: '🌊', label: 'LA → San Francisco', note: 'via the Pacific Coast Highway' },
];

// ── Day Timeline ──────────────────────────────────────────────────────────────

function formatDayLabel(dateStr) {
  if (!dateStr || dateStr === 'unknown') return '?';
  const [, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function DayTimeline({ dayGroups, selectedDay, onSelectDay }) {
  if (!dayGroups.length) return null;
  return (
    <div className={`day-timeline${selectedDay != null ? ' day-timeline--has-selection' : ''}`}>
      {dayGroups.map((group, i) => {
        const isActive = selectedDay === i;
        const lastPhoto = group.photos[group.photos.length - 1];
        return (
          <div
            key={group.date}
            className="day-timeline-row"
            onClick={() => onSelectDay(isActive ? null : i)}
          >
            <div className={`day-timeline-event${isActive ? ' day-timeline-event--active' : ''}`}>
              <span className="day-timeline-day">Day {i + 1}</span>
              <div className="day-timeline-line-content">
                <div className="day-timeline-dot" />
                <div className="day-timeline-body">
                  <div className="day-timeline-title">{formatDayLabel(group.date)}</div>
                  {lastPhoto?.location && (
                    <div className="day-timeline-desc">{lastPhoto.location}</div>
                  )}
                  <div className="day-timeline-count">{group.photos.length} photo{group.photos.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ open, onToggle, selectedDay, onSelectDay }) {
  return (
    <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="sidebar-toggle-icon">{open ? '▶' : '◀'}</span>
        </button>
        <div className="sidebar-badge">LIVE</div>
      </div>

      <div className="sidebar-titlebar">
        <h1 className="sidebar-title">Road Trip<br />Live Tracker</h1>
      </div>

      <div className="sidebar-body">
        <section className="sidebar-section">
          <p className="sidebar-desc">
            See live updates from my Route 66 road trip as photos from my phone are synced and the timeline is auto generated using metadata. 
            The plan is: 
          </p>
          <ul className="trip-legs">
            {TRIP_LEGS.map(leg => (
              <li key={leg.label} className="trip-leg">
                <span className="trip-leg-icon">{leg.icon}</span>
                <div>
                  <div className="trip-leg-label">{leg.label}</div>
                  <div className="trip-leg-note">{leg.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {dayGroups.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-section-title">Generated Timeline</h2>
            <DayTimeline
              dayGroups={dayGroups}
              selectedDay={selectedDay}
              onSelectDay={onSelectDay}
            />
          </section>
        )}

        <section className="sidebar-section sidebar-section-last sidebar-anniversary">
          <div className="anniversary-badge">100</div>
          <div>
            <div className="anniversary-title">Route 66 Centennial</div>
            <div className="anniversary-sub">
              Route 66 was originally established in 1926, so we'll get to celebrate its anniversary :)
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

// ── Module-level data ─────────────────────────────────────────────────────────

function formatDate(datetime) {
  if (!datetime) return null;
  const d = new Date(datetime);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
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

// Group GPS photos by calendar day
const dayGroups = (() => {
  const map = {};
  gpsPhotos.forEach((photo, i) => {
    const day = photo.datetime?.slice(0, 10) ?? 'unknown';
    if (!map[day]) map[day] = { date: day, photos: [], firstPhotoIdx: i };
    map[day].photos.push(photo);
  });
  return Object.values(map);
})();

// Nearest route point index for each GPS photo
const routePts = globalRoute[0] ?? [];
const photoRouteIndices = routePts.length
  ? gpsPhotos.map(p => {
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < routePts.length; i++) {
        const d = (routePts[i].lat - p.lat) ** 2 + (routePts[i].lng - p.lng) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    })
  : [];

function lastPhotoIdx(dayIdx) {
  const g = dayGroups[dayIdx];
  return g.firstPhotoIdx + g.photos.length - 1;
}

function highlightForDay(dayIdx) {
  if (!routePts.length || dayIdx == null) return null;
  // Start: last photo of previous day, or first photo of current day if day 0
  const startIdx = dayIdx > 0 ? lastPhotoIdx(dayIdx - 1) : dayGroups[dayIdx].firstPhotoIdx;
  const endIdx = lastPhotoIdx(dayIdx);
  const r0 = photoRouteIndices[startIdx];
  const r1 = photoRouteIndices[endIdx];
  const lo = Math.min(r0, r1);
  const hi = Math.max(r0, r1);
  // Single point — no segment to draw but still zoom to it
  if (startIdx === endIdx || lo === hi) return [gpsPhotos[startIdx]];
  return routePts.slice(lo, hi + 1);
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [hoveredPhoto, setHoveredPhoto] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);
  const boundsRef = useRef(null);
  const zoomRef = useRef(5);

  const highlightRoute = useMemo(() => highlightForDay(selectedDay), [selectedDay]);

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
    let xShift = '-50%';
    if (xPct < 15) xShift = '0%';
    else if (xPct > 85) xShift = '-100%';
    const popupScale = Math.max(0.6, Math.min(1, zoomRef.current / 6));
    const popupHeightPct = (260 * popupScale * (activePhoto.height / activePhoto.width) + 40) / window.innerHeight * 100;
    const isAbove = yPct + popupHeightPct > 100;
    const yShift = isAbove ? 'calc(-100% - 52px)' : '18px';
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
              highlightRoute={highlightRoute}
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
                  style={expandedPhoto.width && expandedPhoto.height ? { '--photo-aspect': expandedPhoto.width / expandedPhoto.height } : undefined}
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
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />
    </div>
  );
}
