export function bangkokToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function normalizeBusinessDate(value) {
  if (!value) return bangkokToday();
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_BUSINESS_DATE");
  return text;
}

export function bangkokDayRange(businessDate) {
  const start = new Date(`${businessDate}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_BUSINESS_DATE");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function normalizeSummaryGroup(value) {
  if (!value || String(value).toUpperCase() === "ALL") return null;
  return String(value).trim();
}
