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

