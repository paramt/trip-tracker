import { useState, useEffect, useRef, useMemo } from 'react';
import '@fontsource-variable/caveat';
import WorldMap from './components/WorldMap';
import Polaroid from './components/Polaroid';
import Tack from './components/Tack';
import rawPhotos from './data/photos.json';

const _preloaded = [];

// ── Transform flat photos array into day-grouped timeline events ──────────────
function buildTimeline(photos) {
  if (photos.length === 0) return [];

  // Group by calendar date ("2026-04-12")
  const byDate = {};
  for (const photo of photos) {
    const day = photo.datetime ? photo.datetime.slice(0, 10) : '__unknown__';
    (byDate[day] ??= []).push(photo);
  }

  // Build one event per day
  const events = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayPhotos]) => {
      let month = '?', year = '?', title = day;
      if (day !== '__unknown__') {
        const d = new Date(day + 'T12:00:00'); // noon local to avoid TZ off-by-one
        month = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // "Apr 12"
        year = String(d.getFullYear());
        title = d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }); // "Sat, April 12"
      }

      const gpsPhotos = dayPhotos.filter(p => p.lat != null && p.lng != null);
      let coords = null;
      if (gpsPhotos.length === 1) {
        coords = { lat: gpsPhotos[0].lat, lng: gpsPhotos[0].lng };
      } else if (gpsPhotos.length > 1) {
        coords = gpsPhotos.map(p => ({ lat: p.lat, lng: p.lng }));
      }

      const attachments = dayPhotos.map(p => ({
        type: 'image',
        src: p.file,
        thumb: p.thumb,
        w: p.width,
        h: p.height,
      }));

      return { day, month, year, title, coords, attachments };
    });

  // Group by year, newest first
  const byYear = {};
  for (const event of events) {
    (byYear[event.year] ??= []).push(event);
  }

  return Object.entries(byYear)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, evts]) => ({ year, events: evts.slice().reverse() })); // newest day first within year
}

const timeline = buildTimeline(rawPhotos);
const flat = timeline.flatMap(g => g.events.map(e => ({ ...e, year: g.year })));

// All GPS coords across all photos (for the full route background line)
const allGpsCoords = rawPhotos
  .filter(p => p.lat != null && p.lng != null)
  .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''))
  .map(p => ({ lat: p.lat, lng: p.lng }));

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const sectionRef = useRef(null);
  const entryRefs = useRef(new Map());
  const hoverSourceRef = useRef(null);
  const selectedSourceRef = useRef(null);

  // Preload thumbnails when section scrolls into view
  useEffect(() => {
    if (window.innerWidth < 860) return;
    const thumbs = flat.flatMap(e => (e.attachments ?? []).map(a => a.thumb).filter(Boolean));
    if (thumbs.length === 0) return;
    let preloaded = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !preloaded) {
        preloaded = true;
        observer.disconnect();
        const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
        idle(() => thumbs.forEach(src => { const img = new Image(); img.src = src; _preloaded.push(img); }));
      }
    }, { rootMargin: '800px' });
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  // Scroll timeline into view when marker is clicked on map
  useEffect(() => {
    if (selectedEvent && selectedSourceRef.current === 'map') {
      entryRefs.current.get(selectedEvent)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedEvent]);

  const allCoords = flat.flatMap(e => {
    if (!e.coords) return [];
    const pts = Array.isArray(e.coords) ? e.coords : [e.coords];
    return pts.map(({ lat, lng }) => ({ lat, lng, event: e }));
  });

  // Each day with multiple GPS photos is its own route segment
  const allRoutes = flat
    .filter(e => Array.isArray(e.coords) && e.coords.length > 1)
    .map(e => e.coords);

  // Full trip route (all GPS coords chronologically) shown as background
  const globalRoute = allGpsCoords.length > 1 ? [allGpsCoords] : [];

  const activeEvent = hoveredEvent ?? selectedEvent;
  const activeCoords = activeEvent?.coords ?? null;
  const activeAttachments = activeEvent?.attachments ?? [];
  const noZoom = hoveredEvent
    ? hoverSourceRef.current === 'map'
    : selectedEvent
      ? selectedSourceRef.current === 'map'
      : false;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Route 66</h1>
        <p className="app-subtitle">Chicago → Santa Monica</p>
      </header>

      <section className="section timeline-section" ref={sectionRef}>
        {flat.length === 0 ? (
          <div className="empty-state">
            <p>Drop photos into <code>public/dump/</code> and run <code>npm run process</code> to get started.</p>
          </div>
        ) : (
          <div className="timeline-layout">
            <div className="timeline-col">
              <div className={`timeline${selectedEvent ? ' timeline--has-selection' : ''}`}>
                {flat.map((event, i) => {
                  const prevEvent = flat[i - 1];
                  const showYearBefore = !prevEvent || event.year !== prevEvent.year;
                  const hasCoords = event.coords != null;
                  return (
                    <div key={event.day + i}>
                      {showYearBefore && (
                        <div className="timeline-year-marker">
                          <span className="timeline-year">{event.year}</span>
                        </div>
                      )}
                      <div
                        ref={el => { el ? entryRefs.current.set(event, el) : entryRefs.current.delete(event); }}
                        className={`timeline-event${activeEvent === event ? ' timeline-event--active' : ''}${selectedEvent === event ? ' timeline-event--selected' : ''}`}
                        onMouseEnter={() => { hoverSourceRef.current = 'timeline'; setHoveredEvent(event); }}
                        onMouseLeave={() => { hoverSourceRef.current = null; setHoveredEvent(null); }}
                        onClick={() => { selectedSourceRef.current = 'timeline'; setSelectedEvent(prev => prev === event ? null : event); }}
                      >
                        <span className="timeline-month">{event.month}</span>
                        <div className="timeline-line-content">
                          <div className={`timeline-dot${hasCoords ? ' timeline-dot-locatable' : ''}`} />
                          <div className="timeline-body">
                            <span className="timeline-title">{event.title}</span>
                            <span className="timeline-count">{event.attachments.length} photo{event.attachments.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="timeline-map-col"
              aria-hidden="true"
              onMouseLeave={() => { hoverSourceRef.current = null; setHoveredEvent(null); }}
            >
              <div className="map-frame">
                <svg className="map-string" aria-hidden="true">
                  <line x1="50%" y1="9" x2="28%" y2="38" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="50%" y1="9" x2="72%" y2="38" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <Tack size={8} style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }} />
                <WorldMap
                  coords={activeCoords}
                  allCoords={allCoords}
                  allRoutes={[...globalRoute, ...allRoutes]}
                  noZoom={noZoom}
                  onMarkerHover={event => { hoverSourceRef.current = 'map'; setHoveredEvent(event); }}
                  onMarkerLeave={() => { hoverSourceRef.current = null; setHoveredEvent(null); }}
                  onMarkerClick={event => { selectedSourceRef.current = 'map'; setSelectedEvent(prev => prev === event ? null : event); }}
                />
              </div>
              {activeAttachments.length > 0 && (
                <div className="timeline-polaroids">
                  {activeAttachments.map((attachment, i) => (
                    <Polaroid
                      key={attachment.src}
                      src={attachment.src}
                      thumb={attachment.thumb}
                      w={attachment.w}
                      h={attachment.h}
                      color
                      static
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
