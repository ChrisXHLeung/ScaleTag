import { readFileSync } from "node:fs";

export const WORDLIST_DIR = new URL("../data/ldnoobw/", import.meta.url);
export const WORDLIST_FILES = ["en", "zh", "fr", "fr-CA-u-sd-caqc"];

const LATIN_OR_DIGIT = /^[\p{Script=Latin}\p{Nd}]$/u;
const SINGLE_HAN = /^\p{Script=Han}$/u;
const HAS_DIGIT = /\p{Nd}/u;
const HAS_LETTER = /\p{L}/u;
const LEADING_BOUNDARY = "(?<![\\p{Script=Latin}\\p{Nd}])";
const TRAILING_BOUNDARY = "(?![\\p{Script=Latin}\\p{Nd}])";

export function normalizeForFilter(value) {
  return value.normalize("NFKC").toLowerCase();
}

export function isIncludedTerm(term) {
  if (!term) return false;
  // Single Han characters match inside benign compounds (e.g. 牛奶, 安全性).
  if (SINGLE_HAN.test(term)) return false;
  // Letterless digit/punctuation entries (e.g. "13.") would block numbered lists and dates.
  if (HAS_DIGIT.test(term) && !HAS_LETTER.test(term)) return false;
  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileAlternation(terms) {
  if (!terms.length) return null;
  const sorted = [...new Set(terms)].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  return sorted
    .map((term) => escapeRegExp(term).replace(/\s+/g, "\\s+"))
    .join("|");
}

export function loadBlockedTerms(
  directory = WORDLIST_DIR,
  files = WORDLIST_FILES,
) {
  const terms = new Set();
  for (const file of files) {
    const raw = readFileSync(new URL(file, directory), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const normalized = normalizeForFilter(line.trim());
      if (isIncludedTerm(normalized)) terms.add(normalized);
    }
  }
  return [...terms];
}

export function createWordFilter(terms = loadBlockedTerms()) {
  const bothBounded = [];
  const leadBounded = [];
  const trailBounded = [];
  const unbounded = [];

  for (const rawTerm of terms) {
    const term = normalizeForFilter(rawTerm.trim());
    if (!isIncludedTerm(term)) continue;
    const chars = Array.from(term);
    const first = chars[0];
    const last = chars[chars.length - 1];
    const needLead = LATIN_OR_DIGIT.test(first);
    const needTrail = LATIN_OR_DIGIT.test(last);

    if (needLead && needTrail) bothBounded.push(term);
    else if (needLead) leadBounded.push(term);
    else if (needTrail) trailBounded.push(term);
    else unbounded.push(term);
  }

  const patterns = [];
  const bothAlt = compileAlternation(bothBounded);
  if (bothAlt)
    patterns.push(
      new RegExp(`${LEADING_BOUNDARY}(?:${bothAlt})${TRAILING_BOUNDARY}`, "u"),
    );
  const leadAlt = compileAlternation(leadBounded);
  if (leadAlt) patterns.push(new RegExp(`${LEADING_BOUNDARY}(?:${leadAlt})`, "u"));
  const trailAlt = compileAlternation(trailBounded);
  if (trailAlt)
    patterns.push(new RegExp(`(?:${trailAlt})${TRAILING_BOUNDARY}`, "u"));
  const unboundedAlt = compileAlternation(unbounded);
  if (unboundedAlt) patterns.push(new RegExp(`(?:${unboundedAlt})`, "u"));

  return function containsBlockedTerm(value) {
    if (typeof value !== "string" || !value) return false;
    const normalized = normalizeForFilter(value);
    return patterns.some((pattern) => pattern.test(normalized));
  };
}

export const containsBlockedTerm = createWordFilter();
