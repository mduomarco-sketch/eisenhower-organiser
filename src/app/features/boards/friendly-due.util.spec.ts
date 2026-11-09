import { getFriendlyDue } from './friendly-due.util';

describe('getFriendlyDue', () => {
  const today = '2026-11-08';
  const cases: [string, string, boolean][] = [
    ['2026-11-01', '7 days ago', true],
    ['2026-11-06', '2 days ago', true],
    ['2026-11-07', 'yesterday', true],
    ['2026-11-08', 'today', false],
    ['2026-11-09', 'tomorrow', false],
    ['2026-11-11', 'in 3 days', false],
    ['2026-11-14', 'in 6 days', false],
    ['2026-11-15', '15 Nov', false],
    ['2027-01-03', '3 Jan', false],
  ];
  cases.forEach(([due, text, isLate]) => {
    it(`shows ${due} as "${text}"`, () => {
      expect(getFriendlyDue(due, today)).toEqual({ text, isLate });
    });
  });

  it('counts calendar days across a daylight saving change', () => {
    expect(getFriendlyDue('2027-03-29', '2027-03-27').text).toBe('in 2 days');
  });
});
