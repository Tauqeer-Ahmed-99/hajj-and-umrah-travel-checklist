const pad = (value: number) => String(value).padStart(2, "0");
export const calendarValue = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
export function pickerDate(value: string) {
  const found = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return found
    ? new Date(
        Date.UTC(
          Number(found[1]),
          Number(found[2]) - 1,
          Number(found[3]),
          Number(found[4] ?? 12),
          Number(found[5] ?? 0),
        ),
      )
    : new Date(
        Date.UTC(
          new Date().getFullYear(),
          new Date().getMonth(),
          new Date().getDate(),
          12,
        ),
      );
}
function wallParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const read = (name: string) =>
    Number(parts.find((p) => p.type === name)?.value);
  return Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
}
// The native controls display wall-clock components in UTC so the device's
// own DST rules cannot alter a destination's date/time. Resolve the explicitly
// selected IANA zone here, preserving both occurrences of a DST overlap.
export function zonedChoices(wall: Date, timeZone: string): string[] {
  const target = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
  );
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = target + hours * 3_600_000;
    offsets.add(wallParts(probe, timeZone) - probe);
  }
  return [...offsets]
    .map((offset) => ({ offset, instant: target - offset }))
    .filter(({ instant }) => wallParts(instant, timeZone) === target)
    .sort((a, b) => a.instant - b.instant)
    .map(({ offset }) => {
      const minutes = Math.abs(offset / 60_000);
      return `${calendarValue(wall)}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    });
}
