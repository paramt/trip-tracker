// Trip configuration — edit this file to customize for your own trip

export const TRIP_TITLE       = 'Route 66\nRoad Trip Tracker';
export const TRIP_DESCRIPTION = 'See live updates from my Route 66 road trip as photos from my phone are synced and the timeline is auto generated using metadata. The plan is:';
export const PAGE_TITLE       = 'Route 66';

export const TRIP_START = new Date('2026-04-24T16:00:00Z'); // Apr 24 2026 noon EDT
export const TRIP_END   = new Date('2026-05-04T16:00:00Z'); // May 4 2026 noon EDT


// Changes the description in the sidebar, has no effect on the actual route
export const TRIP_LEGS = [
  { icon: '🚗', label: 'Waterloo → Chicago' },
  { icon: '🛣️', label: 'Chicago → LA', note: 'via Historic Route 66' },
  { icon: '🌊', label: 'LA → San Francisco', note: 'via the Pacific Coast Highway' },
];
