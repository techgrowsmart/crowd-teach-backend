/**
 * Natural-language parser for the teacher search bar.
 *
 * Input : "best teacher for maths in Andra pradesh"
 * Output: { subject: 'Mathematics', state: 'Andhra Pradesh', ... }
 *
 * Only two variables are extracted – SUBJECT and STATE – because those are the
 * only two things the review-ranked teacher search filters on. Everything else
 * in the sentence ("best", "teacher for", "in") is scaffolding.
 */

const {
  normalize,
  tokenize,
  similarity,
  STOPWORDS,
  LOCATION_PREPOSITIONS,
  SUBJECT_INDEX,
  STATE_INDEX,
} = require('./searchVocab');

const MAX_PHRASE_WORDS = 5;

/** Minimum similarity for a fuzzy hit, per number of words in the phrase. */
const FUZZY_THRESHOLD = 0.8;
/** Single short words are matched exactly only – "goa"/"art" are too short to fuzz. */
const MIN_FUZZY_LENGTH = 5;

function buildPhrases(tokens) {
  const phrases = [];
  for (let size = Math.min(MAX_PHRASE_WORDS, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const slice = tokens.slice(start, start + size);
      if (slice.some(t => t === null)) continue;
      phrases.push({ start, size, text: slice.join(' '), words: slice });
    }
  }
  return phrases;
}

/**
 * @param {string[]} tokens        token list (consumed slots are null)
 * @param {Map} index             term index to match against
 * @param {object} opts
 * @param {Set<string>} opts.requireContextFor  terms that only count when preceded
 *        by a location preposition (resolves subject/state ambiguity like "tamil")
 * @param {boolean} opts.skipStopwords          ignore single-token stopwords
 */
function matchIndex(tokens, index, opts = {}) {
  const { requireContextFor, skipStopwords = true, contextWords } = opts;
  const phrases = buildPhrases(tokens);

  const hasLocationContext = (start) => {
    const prev = tokens[start - 1];
    return !!prev && (contextWords || LOCATION_PREPOSITIONS).has(prev);
  };

  // 1) Exact matches win, longest phrase first.
  let best = null;
  for (const phrase of phrases) {
    const hit = index.get(phrase.text);
    if (!hit) continue;
    if (phrase.size === 1 && skipStopwords && STOPWORDS.has(phrase.text)) continue;
    if (requireContextFor && requireContextFor.has(phrase.text) && !hasLocationContext(phrase.start)) continue;
    const score = phrase.size * 100 + phrase.text.length + (hasLocationContext(phrase.start) ? 10 : 0);
    if (!best || score > best.score) {
      best = { value: hit.canonical, kind: hit.kind, terms: hit.terms, matched: phrase.text, start: phrase.start, size: phrase.size, exact: true, score, confidence: 1 };
    }
  }
  if (best) return best;

  // 2) Fuzzy fallback – tolerates "andra pradesh", "mathmatics", "chemestry".
  // Scored by similarity first (never by phrase length) so that a near-perfect
  // one-word hit beats a sloppy two-word hit such as "mathmatics in"→"mathematics ii".
  for (const phrase of phrases) {
    if (phrase.text.length < MIN_FUZZY_LENGTH) continue;
    if (/^\d+$/.test(phrase.text)) continue;
    // A real subject/state phrase never starts or ends on filler words.
    if (skipStopwords && (STOPWORDS.has(phrase.words[0]) || STOPWORDS.has(phrase.words[phrase.size - 1]))) continue;
    const threshold = phrase.size === 1 ? FUZZY_THRESHOLD : FUZZY_THRESHOLD + 0.05;
    for (const [term, hit] of index) {
      // Compare like-for-like: same word count keeps the comparison meaningful.
      if (term.split(' ').length !== phrase.size) continue;
      if (Math.abs(term.length - phrase.text.length) > 3) continue;
      const sim = similarity(phrase.text, term);
      if (sim < threshold) continue;
      if (requireContextFor && requireContextFor.has(term) && !hasLocationContext(phrase.start)) continue;
      const score = sim * 100 + phrase.size + (hasLocationContext(phrase.start) ? 1 : 0);
      if (!best || score > best.score) {
        best = { value: hit.canonical, kind: hit.kind, terms: hit.terms, matched: phrase.text, start: phrase.start, size: phrase.size, exact: false, score, confidence: Number(sim.toFixed(2)) };
      }
    }
  }
  return best;
}

function consume(tokens, match) {
  if (!match) return tokens;
  const copy = [...tokens];
  for (let i = match.start; i < match.start + match.size; i++) copy[i] = null;
  return copy;
}

/** Terms that mean a subject *and* a state (e.g. "tamil"). */
const AMBIGUOUS_STATE_TERMS = new Set(
  [...STATE_INDEX.keys()].filter(term => SUBJECT_INDEX.has(term))
);

function extractMinRating(query) {
  const q = normalize(query);
  const m = q.match(/(\d(?:\s*\.\s*\d)?)\s*(?:star|stars)?\s*(?:and\s*)?(?:above|plus|or\s*more|or\s*higher)/)
    || q.match(/(?:above|over|more than|atleast|at least|minimum)\s*(\d(?:\s*\.\s*\d)?)/)
    || q.match(/(\d(?:\s*\.\s*\d)?)\s*(?:star|stars)\b/);
  if (!m) return null;
  const value = parseFloat(String(m[1]).replace(/\s+/g, ''));
  return value >= 1 && value <= 5 ? value : null;
}

/**
 * Parse a search sentence into the subject + state filters.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {string[]} [options.knownStates]   extra state values that exist in the DB
 * @param {string[]} [options.knownSubjects] extra subject values that exist in the DB
 * @returns {{query:string, subject:string|null, state:string|null, subjectMatch:object|null,
 *            stateMatch:object|null, minRating:number|null, unrecognized:string[]}}
 */
function parseTeacherQuery(query, options = {}) {
  const original = String(query || '').trim();
  const tokens = tokenize(original);

  const stateIndex = withExtras(STATE_INDEX, options.knownStates, 'state');
  const subjectIndex = withExtras(SUBJECT_INDEX, options.knownSubjects, 'subject');

  // State first: "in <place>" is the least ambiguous part of the sentence.
  const stateMatch = matchIndex(tokens, stateIndex, { requireContextFor: AMBIGUOUS_STATE_TERMS });
  const afterState = consume(tokens, stateMatch);

  // Subject from whatever is left.
  const subjectMatch = matchIndex(afterState, subjectIndex, {});
  const afterSubject = consume(afterState, subjectMatch);

  const unrecognized = afterSubject
    .filter(t => t && !STOPWORDS.has(t) && !/^\d+$/.test(t));

  return {
    query: original,
    subject: subjectMatch ? subjectMatch.value : null,
    state: stateMatch ? stateMatch.value : null,
    // Every equivalent spelling, used when comparing against stored teacher data.
    subjectTerms: subjectMatch ? (subjectMatch.terms || [normalize(subjectMatch.value)]) : [],
    stateTerms: stateMatch ? (stateMatch.terms || [normalize(stateMatch.value)]) : [],
    subjectKind: subjectMatch ? subjectMatch.kind : null,
    subjectMatch: subjectMatch && { matched: subjectMatch.matched, exact: subjectMatch.exact, confidence: subjectMatch.confidence },
    stateMatch: stateMatch && { matched: stateMatch.matched, exact: stateMatch.exact, confidence: stateMatch.confidence },
    minRating: extractMinRating(original),
    unrecognized,
  };
}

function withExtras(baseIndex, extras, kind) {
  if (!extras || extras.length === 0) return baseIndex;
  const merged = new Map(baseIndex);
  for (const value of extras) {
    const key = normalize(value);
    if (!key || key.length < 2 || merged.has(key)) continue;
    merged.set(key, { canonical: value, kind, terms: [key] });
  }
  return merged;
}

/** True when two free-text values refer to the same subject/state. */
function valuesMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return similarity(x, y) >= 0.85;
}

module.exports = { parseTeacherQuery, valuesMatch, extractMinRating };
