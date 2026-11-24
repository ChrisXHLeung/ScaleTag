function calendarDate(time) {
  return new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function calendarText(value) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\\;,]/g, "\\$&")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function fold(line) {
  let result = "", length = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += character;
    length += bytes;
  }
  return result;
}

export function pickupCalendar({ id, title, serverTime, pickupWindow }, origin) {
  const url = new URL(`/sale/${id}`, origin);
  const endsAt = Math.ceil(pickupWindow.endsAt / 1000) * 1000;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ScaleTag//Giveaway pickup//EN",
    "BEGIN:VEVENT", `UID:pickup-${id}@${url.hostname}`, `DTSTAMP:${calendarDate(serverTime)}`,
    `DTSTART:${calendarDate(pickupWindow.startsAt)}`, `DTEND:${calendarDate(endsAt)}`,
    `SUMMARY:${calendarText(title)}`, `DESCRIPTION:${calendarText(url.href)}`,
    `URL:${url.href}`, "TRANSP:TRANSPARENT", "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}
