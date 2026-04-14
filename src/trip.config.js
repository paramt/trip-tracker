// Trip configuration — edit this file to customize for your own trip

export const TRIP_TITLE       = 'Route 66\nRoad Trip Tracker';
export const TRIP_DESCRIPTION = 'See live updates from my Route 66 road trip as photos from my phone are synced and the timeline is auto generated using metadata. The plan is:';
export const PAGE_TITLE       = 'Route 66';

export const TRIP_START         = new Date('2026-04-24T16:00:00Z'); // Apr 24 2026 noon EDT
export const TRIP_END           = new Date('2026-05-04T16:00:00Z'); // May 4 2026 noon EDT
export const TRIP_DISTANCE_KM   = 6000; // estimated total trip distance (for progress bar)

// Changes the description in the sidebar, has no effect on the actual route
export const TRIP_LEGS = [
  { icon: '🚗', label: 'Waterloo → Chicago' },
  { icon: '🛣️', label: 'Chicago → LA', note: 'via Historic Route 66' },
  { icon: '🌊', label: 'LA → San Francisco', note: 'via the Pacific Coast Highway' },
];

// Map projection — options:
//   'globe'    — 3D globe
//   'mercator' — standard flat web map
export const MAP_PROJECTION = 'globe';

// Map style — pick one of the OpenFreeMap styles:
//   'bright'   — clean, colorful, high detail (default)
//   'positron' — minimal light grey, good for photo-heavy maps
//   'liberty'  — OSM-style, earthy tones
//   'dark'     — dark background, light labels
//   'fiord'    — muted dark blue/grey
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

