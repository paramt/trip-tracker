// Trip configuration — edit this file to customize for your own trip

export const TRIP_TITLE       = 'Trip Tracker';
export const TRIP_DESCRIPTION = 'This is a live demo of Trip Tracker — an open-source template that plots your road trip on a map as you go. Drop in your photos, and it auto-generates a timeline from the GPS and date metadata. The example data is Terry Fox\'s 1980 Marathon of Hope across Canada.';
export const PAGE_TITLE       = 'Trip Tracker';

export const TRIP_START         = new Date('1980-04-12T12:00:00Z'); // Apr 12 1980 — dipped his leg in the Atlantic in St. John's, NL
export const TRIP_END           = new Date('1980-09-01T12:00:00Z'); // Sep 1 1980 — forced to stop near Thunder Bay, ON
export const TRIP_DISTANCE_KM   = 5373; // total distance covered

// Optional: break the trip into named legs shown as a list in the sidebar
export const TRIP_LEGS = [];
// export const TRIP_LEGS = [
//   { icon: '🚗', label: 'Leg 1', note: 'City A → City B' },
//   { icon: '🛣️', label: 'Leg 2', note: 'City B → City C' },
// ];

// Links shown below the trip description in the sidebar
export const TRIP_LINKS = [
  { label: 'Photos: Terry Fox Foundation', url: 'https://terryfox.org/terrys-story/terrys-timeline/' },
  { label: 'Build your own Trip Tracker', url: 'https://github.com/paramt/trip-tracker#readme' },
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
