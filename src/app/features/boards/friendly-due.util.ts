const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (dbDate: string): number => {
  const [year, month, day] = dbDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

export interface FriendlyDue {
  text: string;
  isLate: boolean;
}

/** Eisenhower fork: "tomorrow" or "in 3 days" for the phone's task rows. */
export const getFriendlyDue = (dueDay: string, todayStr: string): FriendlyDue => {
  const days = Math.round((toUtc(dueDay) - toUtc(todayStr)) / DAY_MS);
  if (days < -1) return { text: `${-days} days ago`, isLate: true };
  if (days === -1) return { text: 'yesterday', isLate: true };
  if (days === 0) return { text: 'today', isLate: false };
  if (days === 1) return { text: 'tomorrow', isLate: false };
  if (days < 7) return { text: `in ${days} days`, isLate: false };
  const [, month, day] = dueDay.split('-').map(Number);
  return { text: `${day} ${MONTHS[month - 1]}`, isLate: false };
};
