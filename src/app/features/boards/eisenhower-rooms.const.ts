/** Eisenhower fork: the phone's short names for the four quadrants. */
export interface EisenhowerRoom {
  panelId: string;
  name: string;
}

// In board order, so the phone's 2x2 map matches the desktop grid.
export const EISENHOWER_ROOMS: readonly EisenhowerRoom[] = [
  { panelId: 'URGENT_AND_IMPORTANT', name: 'Do it now' },
  { panelId: 'NOT_URGENT_AND_IMPORTANT', name: 'Plan it' },
  { panelId: 'URGENT_AND_NOT_IMPORTANT', name: 'Knock it out' },
  { panelId: 'NOT_URGENT_AND_NOT_IMPORTANT', name: 'Let it go' },
];

export const getEisenhowerRoom = (panelId: string): EisenhowerRoom | undefined =>
  EISENHOWER_ROOMS.find((room) => room.panelId === panelId);
