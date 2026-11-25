import { useState, useRef, useEffect, useMemo } from 'react';
import '@fontsource-variable/caveat';
import WorldMap from './components/WorldMap';
import Polaroid from './components/Polaroid';
import rawPhotos from './data/photos.json';
import rawRoute from './data/route.json';
import { TRIP_START, TRIP_END, TRIP_LEGS, TRIP_TITLE, TRIP_DESCRIPTION, TRIP_LINKS, PAGE_TITLE, TRIP_DISTANCE_KM } from './trip.config.js';
import * as tripConfig from './trip.config.js';

// Optional config (older trip.config.js files may not define it)
const DAY_START_HOUR = tripConfig.DAY_START_HOUR ?? 4;

document.title = PAGE_TITLE;

function getTripStatus() {
  const now = new Date();
  if (now >= TRIP_START && now <= TRIP_END) return { label: 'LIVE', live: true };
  if (now < TRIP_START) {
    const days = Math.ceil((TRIP_START - now) / 864e5);
    return { label: `STARTS IN ${days} DAY${days === 1 ? '' : 'S'}`, live: false };
  }
  const days = Math.floor((now - TRIP_END) / 864e5);
  return { label: `ENDED ${days} DAY${days === 1 ? '' : 'S'} AGO`, live: false };
}

// ── Day Timeline ──────────────────────────────────────────────────────────────

function formatDayLabel(dateStr) {
  if (!dateStr || dateStr === 'unknown') return '?';
  const [, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function DayTimeline({ dayGroups, dayDistances, selectedDay, onSelectDay }) {
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
                  <div className="day-timeline-count">
                    {group.photos.length} photo{group.photos.length !== 1 ? 's' : ''}
                    {dayDistances?.[i] > 0 ? ` · ${dayDistances[i]} km` : ''}
                  </div>
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

function Sidebar({ open, onToggle, selectedDay, onSelectDay, distanceKm, tripTime, photoCount, citiesVisited, statesVisited }) {
  return (
    <aside
      className={`sidebar${open ? ' sidebar-open' : ''}`}
      onClick={!open ? onToggle : undefined}
    >
      <div className="sidebar-header">
        <button
          className="sidebar-toggle"
          onClick={e => { e.stopPropagation(); onToggle(); }}
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="sidebar-toggle-icon">{open ? '▶' : '◀'}</span>
        </button>
        <div className={`sidebar-badge${getTripStatus().live ? ' sidebar-badge--live' : ''}`}>{getTripStatus().label}</div>
      </div>

      <div className="sidebar-titlebar">
        <h1 className="sidebar-title">{TRIP_TITLE.split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}</h1>
      </div>

      <div className="sidebar-body">
        <section className="sidebar-section">
          <p className="sidebar-desc">
            {TRIP_DESCRIPTION}
          </p>
          {TRIP_LINKS?.length > 0 && (
            <ul className="sidebar-links">
              {TRIP_LINKS.map(link => (
                <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></li>
              ))}
            </ul>
          )}
          {TRIP_LEGS.length > 0 && (
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
          )}
        </section>

        {distanceKm && (
          <section className="sidebar-section">
            <h2 className="sidebar-section-title">Trip Stats</h2>
            <div className="trip-stats">
              <div className="trip-stat">
                <div className="trip-stat-value">{tripTime ?? '—'}</div>
                <div className="trip-stat-label">Trip Time</div>
              </div>
              <div className="trip-stat">
                <div className="trip-stat-value">{photoCount}</div>
                <div className="trip-stat-label">Photos</div>
              </div>
              <div className="trip-stat">
                <div className="trip-stat-value">{statesVisited || '—'}</div>
                <div className="trip-stat-label">States / Provinces</div>
              </div>
              <div className="trip-stat">
                <div className="trip-stat-value">{citiesVisited || '—'}</div>
                <div className="trip-stat-label">Cities</div>
              </div>
              <div className="trip-stat trip-stat--progress">
                <div className="trip-stat-progress-header">
                  <span className="trip-stat-value">{distanceKm?.toLocaleString()} km</span>
                  <span className="trip-stat-progress-target">est. {TRIP_DISTANCE_KM.toLocaleString()} km</span>
                </div>
                <div className="trip-stat-progress-bar">
                  <div
                    className="trip-stat-progress-fill"
                    style={{ width: `${Math.min(100, (distanceKm / TRIP_DISTANCE_KM) * 100)}%` }}
                  />
                </div>
                <div className="trip-stat-label">Distance Covered</div>
              </div>
            </div>
          </section>
        )}

        {dayGroups.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-section-title">Generated Timeline</h2>
            <DayTimeline
              dayGroups={dayGroups}
              dayDistances={dayDistances}
              selectedDay={selectedDay}
              onSelectDay={onSelectDay}
            />
          </section>
        )}

      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-links">
          <a href="https://param.me" target="_blank" rel="noopener noreferrer" className="sidebar-desc">param.me</a>
          <a
            href="https://github.com/paramt/trip-tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-github-link"
            aria-label="View source on GitHub"
          >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
              -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
              .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
              -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
              .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
              .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
              0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          </a>
        </div>
      </div>
    </aside>
  );
}

// ── Module-level data ─────────────────────────────────────────────────────────

// Photo date as MM/DD/YY in the camera's local time (not the viewer's time zone).
function formatDate(photo) {
  const local = photo.localDatetime ?? (photo.datetime?.endsWith('Z') ? null : photo.datetime);
  if (local) {
    const [y, m, d] = local.slice(0, 10).split('-');
    return `${m}/${d}/${y.slice(2)}`;
  }
  if (!photo.datetime) return null;
  return new Date(photo.datetime).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
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

// Trip day for a photo, in camera-local time. Photos taken before DAY_START_HOUR count
// toward the previous day, so a late night out stays on the day it started.
function getTripDayKey(photo) {
  const local = photo.localDatetime ?? photo.datetime;
  if (!local) return 'unknown';
  const date = local.slice(0, 10);
  const hour = parseInt(local.slice(11, 13), 10);
  if (hour < DAY_START_HOUR) {
    const d = new Date(date + 'T12:00:00Z'); // UTC noon avoids DST edge cases
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

// Group GPS photos by trip day
const dayGroups = (() => {
  const map = {};
  gpsPhotos.forEach((photo, i) => {
    const day = getTripDayKey(photo);
    if (!map[day]) map[day] = { date: day, photos: [], firstPhotoIdx: i };
    map[day].photos.push(photo);
  });
  return Object.values(map);
})();

// Derived stats from photo metadata
const photoCount = rawPhotos.length;
const citiesVisited = new Set(rawPhotos.map(p => p.location).filter(Boolean)).size;
const statesVisited = new Set(
  rawPhotos.map(p => p.location?.split(',').pop()?.trim()).filter(Boolean)
).size;

// Trip duration: first photo → min(now, TRIP_END)
const tripTime = (() => {
  if (!gpsPhotos.length) return null;
  const start = new Date(gpsPhotos[0].datetime);
  const end = new Date(Math.min(Date.now(), TRIP_END.getTime()));
  const ms = end - start;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor((ms % 864e5) / 36e5);
  return `${days}d ${hours}h`;
})();

function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Nearest route point index for each GPS photo
const routePts = globalRoute[0] ?? [];

// Cumulative distance (km) along the route at each route point
const routeCumDist = (() => {
  if (!routePts.length) return [];
  const dist = [0];
  for (let i = 1; i < routePts.length; i++)
    dist.push(dist[i - 1] + haversine(routePts[i - 1], routePts[i]));
  return dist;
})();

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

// Route indices covered by a day: from the previous day's last photo (or this day's
// first photo for day 1) to this day's last photo
function dayRouteRange(dayIdx) {
  const startIdx = dayIdx > 0 ? lastPhotoIdx(dayIdx - 1) : dayGroups[dayIdx].firstPhotoIdx;
  const endIdx = lastPhotoIdx(dayIdx);
  const r0 = photoRouteIndices[startIdx];
  const r1 = photoRouteIndices[endIdx];
  return { startIdx, endIdx, lo: Math.min(r0, r1), hi: Math.max(r0, r1) };
}

// Kilometres driven each day, measured along the route
const dayDistances = routeCumDist.length && photoRouteIndices.length
  ? dayGroups.map((_, i) => {
      const { lo, hi } = dayRouteRange(i);
      return Math.round(routeCumDist[hi] - routeCumDist[lo]);
    })
  : [];

function highlightForDay(dayIdx) {
  if (!routePts.length || dayIdx == null) return null;
  const { startIdx, endIdx, lo, hi } = dayRouteRange(dayIdx);
  // Single point — no segment to draw but still zoom to it
  if (startIdx === endIdx || lo === hi) return [gpsPhotos[startIdx]];
  return routePts.slice(lo, hi + 1);
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [hoveredPhoto, setHoveredPhoto] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 640);
  const [selectedDay, setSelectedDay] = useState(null);
  const boundsRef = useRef(null);
  const zoomRef = useRef(5);
  const overlayRef = useRef(null);

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

  useEffect(() => {
    if (expandedPhoto) overlayRef.current?.focus();
  }, [expandedPhoto]);

  // Arrow keys step through photos in the expanded view; Escape closes it
  useEffect(() => {
    if (!expandedPhoto) return;
    const idx = gpsPhotos.indexOf(expandedPhoto);
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (idx < gpsPhotos.length - 1) setExpandedPhoto(gpsPhotos[idx + 1]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (idx > 0) setExpandedPhoto(gpsPhotos[idx - 1]);
      } else if (e.key === 'Escape') {
        setExpandedPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [expandedPhoto]);

  const activePhoto = hoveredPhoto;
  const popupPos = activePhoto && boundsRef.current?.project ? (() => {
    const { xPct: xFrac, yPct: yFrac } = boundsRef.current.project(activePhoto.lng, activePhoto.lat);
    // If the marker is off-screen (e.g. on the back of the globe), suppress the popup
    if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return null;
    const xPct = xFrac * 100;
    const yPct = yFrac * 100;
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
            <p>Drop photos into <code>public/photos/</code> and run <code>npm run process</code> to get started.</p>
          </div>
        ) : (
          <>
            <WorldMap
              coords={allCoords}
              allCoords={allCoords}
              allRoutes={globalRoute}
              highlightRoute={highlightRoute}
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
                  date={formatDate(activePhoto)}
                  location={activePhoto.location ?? null}
                  rotate={activePhoto._rotate}
                  color
                  static
                  tack={false}
                />
              </div>
            )}
            {expandedPhoto && (() => {
              const idx = gpsPhotos.indexOf(expandedPhoto);
              const hasPrev = idx > 0;
              const hasNext = idx < gpsPhotos.length - 1;
              return (
                <div className="polaroid-overlay" ref={overlayRef} tabIndex={-1} onClick={() => setExpandedPhoto(null)}>
                  <button className="polaroid-overlay-close" onClick={() => setExpandedPhoto(null)} aria-label="Close">✕</button>
                  <div className="polaroid-overlay-inner" onClick={e => e.stopPropagation()}>
                    <button
                      className="polaroid-nav polaroid-nav-prev"
                      onClick={() => hasPrev && setExpandedPhoto(gpsPhotos[idx - 1])}
                      aria-label="Previous photo"
                      disabled={!hasPrev}
                    ><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                    <div
                      key={expandedPhoto.file}
                      className="polaroid-expanded"
                      style={expandedPhoto.width && expandedPhoto.height ? { '--photo-aspect': expandedPhoto.width / expandedPhoto.height } : undefined}
                    >
                      <Polaroid
                        src={expandedPhoto.file}
                        thumb={expandedPhoto.thumb}
                        w={expandedPhoto.width}
                        h={expandedPhoto.height}
                        date={formatDate(expandedPhoto)}
                        location={expandedPhoto.location ?? null}
                        rotate={expandedPhoto._rotate}
                        color
                        tack={false}
                      />
                    </div>
                    <button
                      className="polaroid-nav polaroid-nav-next"
                      onClick={() => hasNext && setExpandedPhoto(gpsPhotos[idx + 1])}
                      aria-label="Next photo"
                      disabled={!hasNext}
                    ><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        distanceKm={rawRoute.distanceMeters ? Math.round(rawRoute.distanceMeters / 1000) : null}
        tripTime={tripTime}
        photoCount={photoCount}
        citiesVisited={citiesVisited}
        statesVisited={statesVisited}
      />
    </div>
  );
}
