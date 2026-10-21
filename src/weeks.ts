/** The id of the week that contains `todayISO` (`YYYY-MM-DD`), or null. A week
 *  covers seven calendar days from its start date. Uses calendar-day
 *  arithmetic so DST can't shift the boundary. */
export function currentWeekId(weeks: { id: string; startDate: string }[], todayISO: string): string | null {
  for (const w of weeks) {
    if (todayISO >= w.startDate && todayISO < addDaysISO(w.startDate, 7)) return w.id;
  }
  return null;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Where `dateISO` falls across a Monday–Friday week that starts on
 *  `weekStartISO`, from 0 (start) to 1 (end), at the middle of its day.
 *  Weekend dates sit at the end. */
export function dayOffset(weekStartISO: string, dateISO: string): number {
  const days = Math.round((Date.parse(dateISO + 'T00:00:00Z') - Date.parse(weekStartISO + 'T00:00:00Z')) / 86_400_000);
  return Math.min(Math.max((days + 0.5) / 5, 0), 1);
}
