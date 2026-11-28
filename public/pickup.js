import { date, t } from "/common.js";

export function toLocalDateTime(time) {
  if (!Number.isSafeInteger(time)) return "";
  const value = new Date(time);
  if (!Number.isFinite(value.getTime())) return "";
  return new Date(time - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function readLocalDateTime(input) {
  const time = new Date(input.value).valueOf();
  // A time in the gap at a daylight-saving jump cannot be scheduled.
  return toLocalDateTime(time) === input.value ? time : NaN;
}

export function pickupWindowFields(prefix, window) {
  return `<fieldset class="options-fieldset" data-pickup-window>
    <legend>${t("Pickup window (optional)", "领取时段（选填）")}</legend>
    <label for="${prefix}-pickup-start">${t("Pickup starts", "领取开始")}</label>
    <input id="${prefix}-pickup-start" type="datetime-local" value="${toLocalDateTime(window?.startsAt)}">
    <label for="${prefix}-pickup-end">${t("Pickup ends", "领取结束")}</label>
    <input id="${prefix}-pickup-end" type="datetime-local" value="${toLocalDateTime(window?.endsAt)}">
    <p class="field-hint">${t("Times use your device’s time zone.", "时间以设备所在时区为准。")}</p>
  </fieldset>`;
}

export function readPickupWindow(start, end) {
  if (!start.value && !end.value) return null;
  const startsAt = readLocalDateTime(start);
  const endsAt = readLocalDateTime(end);
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt >= endsAt)
    throw new Error(t("Choose a pickup start and end time in order.", "请按先后顺序填写领取开始和结束时间。"));
  return { startsAt, endsAt };
}

function utcOffset(time) {
  const minutes = -new Date(time).getTimezoneOffset();
  const magnitude = Math.abs(minutes);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, "0");
  const remainder = String(magnitude % 60).padStart(2, "0");
  return `UTC${minutes < 0 ? "−" : "+"}${hours}:${remainder}`;
}

export function localTimeRangeText({ startsAt, endsAt }) {
  const startOffset = utcOffset(startsAt);
  const endOffset = utcOffset(endsAt);
  const startLabel = startOffset === endOffset ? "" : ` (${startOffset})`;
  return `${date(startsAt)}${startLabel} – ${date(endsAt)} (${endOffset})`;
}

export function pickupWindowText(window) {
  return `${t("Pickup window", "领取时段")} · ${localTimeRangeText(window)}`;
}
