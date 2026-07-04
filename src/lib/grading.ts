import type { Company, Grade, Sector } from "../types";

// Some companies appear under two names depending on the acronym (e.g. an
// answer might spell "Alphabet" for the A in MATANA but "Google" for the G in
// GAMMA). canonical() collapses synonyms to one key so either entry grades as
// the same company for membership / position / cap checks.
export const SYNONYM: Record<string, string> = { Alphabet: "Google" };
export const canonical = (name: string) => SYNONYM[name] ?? name;
export const sameCompany = (a: string, b: string) => canonical(a) === canonical(b);

// Sector families: same family -> "close" sector match, else "wrong".
const CLUSTER: Record<Sector, string> = {
  social: "net", search: "net", ecommerce: "net", media: "net", consumer: "net",
  ailab: "ai", semis: "ai", cloud: "ai", networking: "ai", hardware: "ai",
  space: "frontier", ev: "frontier",
  fintech: "fin", finance: "fin",
  mobility: "mob",
  energy: "phys", pharma: "phys", retail: "phys", conglomerate: "phys",
};

export const SECTOR_LABEL: Record<Sector, string> = {
  social: "Social/Internet", consumer: "Consumer", ecommerce: "E-commerce",
  cloud: "Cloud/Software", semis: "Semiconductors", ailab: "AI Lab", media: "Media",
  space: "Aerospace", fintech: "Fintech", finance: "Banking", search: "Search/Ads",
  ev: "Automotive/EV", energy: "Energy", pharma: "Pharma", retail: "Retail",
  networking: "Networking", hardware: "Hardware", mobility: "Mobility",
  conglomerate: "Conglomerate",
};

// Short sector names for the cramped per-tile hint column (full names live in
// SECTOR_LABEL, used where there's room).
export const SECTOR_SHORT: Record<Sector, string> = {
  social: "Social", consumer: "Consumer", ecommerce: "E-comm",
  cloud: "Cloud", semis: "Semis", ailab: "AI Lab", media: "Media",
  space: "Aero", fintech: "Fintech", finance: "Banking", search: "Search/Ads",
  ev: "Auto/EV", energy: "Energy", pharma: "Pharma", retail: "Retail",
  networking: "Network", hardware: "Hardware", mobility: "Mobility",
  conglomerate: "Conglom",
};

export const CAP_WORD: Record<Grade, string> = { correct: "≈ size", close: "close", wrong: "far off" };
export const SEC_WORD: Record<Grade, string> = { correct: "same sector", close: "related", wrong: "different" };

export interface CapResult { grade: Grade; arrow: "" | "▲" | "▼" }

/** Compare a guessed company's market cap to the true company's. */
export function capGrade(guess: Company, truth: Company): CapResult {
  if (sameCompany(guess.name, truth.name)) return { grade: "correct", arrow: "" };
  const ratio = guess.cap / truth.cap;
  const arrow: "▲" | "▼" = truth.cap > guess.cap ? "▲" : "▼";
  if (ratio >= 0.8 && ratio <= 1.25) return { grade: "correct", arrow };
  if (ratio >= 0.4 && ratio <= 2.5) return { grade: "close", arrow };
  return { grade: "wrong", arrow };
}

export function sectorGrade(guess: Company, truth: Company): Grade {
  if (guess.sector === truth.sector) return "correct";
  return CLUSTER[guess.sector] === CLUSTER[truth.sector] ? "close" : "wrong";
}

export const capLabel = (g: number) => (g >= 1000 ? `$${(g / 1000).toFixed(1)}T` : `$${g}B`);

// Market-cap buckets for the picker's filter. Half-open ranges [min, max).
export const CAP_BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: "t2",   label: "$2T+",        min: 2000, max: Infinity },
  { key: "t1",   label: "$1T–2T",      min: 1000, max: 2000 },
  { key: "b500", label: "$500B–1T",    min: 500,  max: 1000 },
  { key: "b300", label: "$300B–500B",  min: 300,  max: 500 },
  { key: "b200", label: "$200B–300B",  min: 200,  max: 300 },
  { key: "b120", label: "$120B–200B",  min: 120,  max: 200 },
  { key: "b60",  label: "$60B–120B",   min: 60,   max: 120 },
  { key: "u60",  label: "Under $60B",  min: 0,    max: 60 },
];
export const capBand = (cap: number) => CAP_BANDS.find((b) => cap >= b.min && cap < b.max)?.key ?? "";
