export const CITIES = ["Melbourne", "Sydney", "Brisbane", "Adelaide", "Perth", "Canberra", "Darwin", "Hobart"];

export const CODE: { [key: string]: string } = {
  Melbourne: "MEL",
  Sydney: "SYD",
  Brisbane: "BNE",
  Adelaide: "ADL",
  Perth: "PER",
  Canberra: "CBR",
  Darwin: "DRW",
  Hobart: "HBA"
};

// approximate road distances (km) between capitals
export const KM: { [key: string]: number } = {
  "Melbourne-Sydney": 878, "Melbourne-Brisbane": 1677, "Melbourne-Adelaide": 727, "Melbourne-Perth": 3418,
  "Melbourne-Canberra": 663, "Melbourne-Darwin": 3750, "Melbourne-Hobart": 599,
  "Sydney-Brisbane": 911, "Sydney-Adelaide": 1375, "Sydney-Perth": 3934, "Sydney-Canberra": 286,
  "Sydney-Darwin": 3970, "Sydney-Hobart": 1320,
  "Brisbane-Adelaide": 2031, "Brisbane-Perth": 4310, "Brisbane-Canberra": 1197, "Brisbane-Darwin": 3429, "Brisbane-Hobart": 2240,
  "Adelaide-Perth": 2693, "Adelaide-Canberra": 1160, "Adelaide-Darwin": 3028, "Adelaide-Hobart": 1280,
  "Perth-Canberra": 3724, "Perth-Darwin": 4042, "Perth-Hobart": 3940,
  "Canberra-Darwin": 3938, "Canberra-Hobart": 1190, "Darwin-Hobart": 4310
};

export function getDistance(a: string, b: string): number {
  if (a === b) return 0;
  return KM[`${a}-${b}`] ?? KM[`${b}-${a}`] ?? 0;
}

export const SIZE_MULT: { [key: string]: number } = { S: 1, M: 1.8, L: 3, XL: 5 };

export const SIZE_LABEL: { [key: string]: string } = {
  S: "Small — fits a backpack (≤5 kg)",
  M: "Medium — fits a boot (≤20 kg)",
  L: "Large — back seat / ute tray (≤60 kg)",
  XL: "Extra large — trailer load (≤200 kg)"
};

export const SIZE_SHORT_LABEL: { [key: string]: string } = {
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra large"
};

export function calculatePrice(a: string, b: string, size: string): number {
  if (a === b) return 0;
  const base = 15 + getDistance(a, b) * 0.035;
  return Math.round(base * SIZE_MULT[size]);
}

export function getFerryNote(a: string, b: string): string {
  return (a === "Hobart" || b === "Hobart") ? " · incl. Spirit of Tasmania crossing" : "";
}

export function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatFriendlyDate(s: string): string {
  return new Date(s + "T00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}
