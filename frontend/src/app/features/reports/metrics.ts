/** Build the month chart from the selected report period, never from today's date alone. */
export function reportMonthKeys(from: string, to: string, today: string): string[] {
  const month = (s: string) => /^\d{4}-\d{2}/.test(s) ? s.slice(0,7) : '';
  const end = month(to) || month(today);
  const start = month(from) || (() => {
    const [y,m] = end.split('-').map(Number);
    return new Date(Date.UTC(y,m-6,1)).toISOString().slice(0,7);
  })();
  if (!end || !start || start > end) return [];
  const [sy,sm] = start.split('-').map(Number);
  const [ey,em] = end.split('-').map(Number);
  const total = Math.max(0,(ey-sy)*12+em-sm+1);
  // The chart stays legible for long selected periods: last 12 months.
  return Array.from({length:Math.min(12,total)}, (_,i) => {
    const d=new Date(Date.UTC(ey,em-Math.min(12,total)+i,1));
    return d.toISOString().slice(0,7);
  });
}
