/**
 * Review-driven teacher search.
 *
 * A student types one sentence – "best teacher for maths in Andra pradesh" –
 * and the API turns it into exactly two filters (SUBJECT + STATE) and ranks the
 * matching teachers purely on their reviews (/api/teacher-reviews data), joined
 * with their profile (/api/teachers data) for the state and the subjects taught.
 *
 * Endpoints (mounted under /api):
 *   GET  /teacher-search?q=...              → ranked teachers
 *   POST /teacher-search                    → same, body { q, subject, state, ... }
 *   GET  /teacher-search/suggestions?q=...  → search-bar autocomplete sentences
 *   GET  /teacher-search/parse?q=...        → what the parser understood (debug)
 * Aliases: /teachers/search, /teacher-reviews/search
 */

const express = require('express');
const router = express.Router();

const TeacherReview = require('../../models/TeacherReview');
const { getDirectory, getTeacher, stateCounts, subjectCounts } = require('../../services/teacherDirectory');
const { parseTeacherQuery, valuesMatch } = require('../../utils/teacherSearchParser');
const {
  normalize,
  SUBJECT_INDEX,
  ALL_STATE_NAMES,
  ALL_SUBJECT_NAMES,
  POPULAR_SUBJECTS,
  POPULAR_STATES,
} = require('../../utils/searchVocab');

// Rating prior: a 5★ teacher with a single review must not outrank a 4.8★
// teacher with forty reviews, so ratings are pulled towards the global average.
const PRIOR_WEIGHT = 3;
const DEFAULT_PRIOR = 3.8;

// ── Review aggregation ────────────────────────────────────────────────────────

/** Per-teacher review totals (+ the single most useful review to show). */
async function getReviewStats() {
  const rows = await TeacherReview.aggregate([
    { $sort: { rating: -1, createdAt: -1 } },
    {
      $group: {
        _id: { $toLower: '$teacherEmail' },
        teacherEmail: { $first: '$teacherEmail' },
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        lastReviewAt: { $max: '$createdAt' },
        reviewedSubjects: { $addToSet: '$subject' },
        topReview: {
          $first: {
            review: '$review',
            rating: '$rating',
            studentName: '$studentName',
            subject: '$subject',
            createdAt: '$createdAt',
          },
        },
      },
    },
  ]).allowDiskUse(true);

  const byEmail = new Map();
  for (const row of rows) {
    byEmail.set(row._id, {
      email: row.teacherEmail,
      totalReviews: row.totalReviews,
      averageRating: row.averageRating,
      lastReviewAt: row.lastReviewAt,
      reviewedSubjects: (row.reviewedSubjects || []).filter(Boolean),
      topReview: row.topReview || null,
    });
  }
  return byEmail;
}

/** Per-teacher, per-subject review totals – used when the query names a subject. */
async function getSubjectReviewStats() {
  const rows = await TeacherReview.aggregate([
    { $match: { subject: { $exists: true, $nin: [null, ''] } } },
    {
      $group: {
        _id: { email: { $toLower: '$teacherEmail' }, subject: { $toLower: '$subject' } },
        subject: { $first: '$subject' },
        count: { $sum: 1 },
        averageRating: { $avg: '$rating' },
      },
    },
  ]).allowDiskUse(true);

  const byEmail = new Map();
  for (const row of rows) {
    const list = byEmail.get(row._id.email) || [];
    list.push({ subject: row.subject, count: row.count, averageRating: row.averageRating });
    byEmail.set(row._id.email, list);
  }
  return byEmail;
}

// ── Matching helpers ─────────────────────────────────────────────────────────

/** Does any of `values` mean the same thing as one of the parsed `terms`? */
function matchesAny(values, terms) {
  if (!terms || terms.length === 0) return true;
  for (const value of values) {
    if (!value) continue;
    const normalized = normalize(value);
    if (!normalized) continue;
    for (const term of terms) {
      if (normalized === term) return true;
      if (normalized.includes(term) || term.includes(normalized)) return true;
      if (valuesMatch(normalized, term)) return true;
    }
  }
  return false;
}

function bayesianScore(average, count, prior) {
  if (!count) return 0;
  return (average * count + prior * PRIOR_WEIGHT) / (count + PRIOR_WEIGHT);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value || 0) * factor) / factor;
}

/**
 * Rank every reviewed teacher against the given filters.
 * Teachers with no reviews never appear – the search is review-based by design.
 */
function rankTeachers({ directory, reviewStats, subjectStats, filters, prior }) {
  const { subjectTerms, stateTerms, minRating } = filters;
  const results = [];

  for (const [emailKey, stats] of reviewStats) {
    const teacher = getTeacher(directory, emailKey);

    // STATE filter – comes from the teacher's registration record.
    const teacherState = teacher ? teacher.state : '';
    if (stateTerms.length > 0 && !matchesAny([teacherState], stateTerms)) continue;

    // SUBJECT filter – satisfied either by what the teacher teaches or by what
    // the reviews were written about.
    const taught = teacher ? teacher.taught : [];
    const subjectRows = subjectStats.get(emailKey) || [];
    const reviewedSubjects = stats.reviewedSubjects;

    let subjectRow = null;
    if (subjectTerms.length > 0) {
      const teachesIt = matchesAny([...taught, teacher ? teacher.specialization : ''], subjectTerms);
      const reviewedForIt = matchesAny(reviewedSubjects, subjectTerms);
      if (!teachesIt && !reviewedForIt) continue;
      subjectRow = subjectRows.find(row => matchesAny([row.subject], subjectTerms)) || null;
    }

    // Reviews written for the requested subject are the most relevant signal;
    // fall back to the teacher's overall reviews when there are none.
    const ratingSource = subjectRow ? 'subject' : 'overall';
    const average = subjectRow ? subjectRow.averageRating : stats.averageRating;
    const count = subjectRow ? subjectRow.count : stats.totalReviews;

    if (minRating && average < minRating) continue;

    results.push({
      email: stats.email,
      name: (teacher && teacher.name) || String(stats.email || '').split('@')[0],
      profilePic: (teacher && teacher.profilePic) || null,
      introduction: (teacher && teacher.introduction) || '',
      category: (teacher && teacher.category) || '',
      state: teacherState || '',
      subjects: taught,
      specialization: (teacher && teacher.specialization) || '',
      experience: (teacher && teacher.experience) || '',
      isSpotlight: !!(teacher && teacher.isSpotlight),
      averageRating: round(stats.averageRating, 1),
      totalReviews: stats.totalReviews,
      subjectRating: subjectRow ? round(subjectRow.averageRating, 1) : null,
      subjectReviews: subjectRow ? subjectRow.count : 0,
      matchedSubject: subjectRow ? subjectRow.subject : null,
      ratingSource,
      lastReviewAt: stats.lastReviewAt,
      topReview: stats.topReview,
      score: round(bayesianScore(average, count, prior), 3),
      inDirectory: !!teacher,
    });
  }

  results.sort((a, b) =>
    b.score - a.score ||
    b.totalReviews - a.totalReviews ||
    (b.averageRating - a.averageRating) ||
    String(a.name).localeCompare(String(b.name))
  );

  return results;
}

// ── Core search ──────────────────────────────────────────────────────────────

async function runSearch(params) {
  const {
    q = '',
    subject: subjectOverride = '',
    state: stateOverride = '',
    minRating: minRatingOverride,
    limit = 20,
    offset = 0,
    strict = false,
  } = params;

  const directory = await getDirectory().catch(() => ({ byEmail: new Map(), states: [], subjects: [] }));

  // Values that only exist in this deployment's data (custom subjects, state
  // spellings) are added to the vocabulary so they can be recognised too.
  const parsed = parseTeacherQuery(q, {
    knownStates: directory.states,
    knownSubjects: directory.subjects,
  });

  // Explicit query params always win over what was parsed from the sentence.
  const subject = subjectOverride ? String(subjectOverride) : parsed.subject;
  const state = stateOverride ? String(stateOverride) : parsed.state;
  const subjectTerms = subjectOverride ? [normalize(subjectOverride)] : parsed.subjectTerms;
  const stateTerms = stateOverride ? [normalize(stateOverride)] : parsed.stateTerms;
  const minRating = minRatingOverride != null && minRatingOverride !== ''
    ? Number(minRatingOverride)
    : parsed.minRating;

  const [reviewStats, subjectStats] = await Promise.all([getReviewStats(), getSubjectReviewStats()]);

  let prior = DEFAULT_PRIOR;
  if (reviewStats.size > 0) {
    let sum = 0;
    let count = 0;
    for (const stats of reviewStats.values()) {
      sum += stats.averageRating * stats.totalReviews;
      count += stats.totalReviews;
    }
    if (count > 0) prior = sum / count;
  }

  const attempt = (terms) => rankTeachers({
    directory,
    reviewStats,
    subjectStats,
    filters: { subjectTerms: terms.subjectTerms, stateTerms: terms.stateTerms, minRating },
    prior,
  });

  let results = attempt({ subjectTerms, stateTerms });
  const relaxedFilters = [];

  // Nothing in that state? Widen the search instead of showing an empty page,
  // and tell the client exactly which filter was dropped.
  if (!strict && results.length === 0 && stateTerms.length > 0) {
    results = attempt({ subjectTerms, stateTerms: [] });
    if (results.length > 0) relaxedFilters.push('state');
  }
  if (!strict && results.length === 0 && subjectTerms.length > 0) {
    results = attempt({ subjectTerms: [], stateTerms });
    if (results.length > 0) relaxedFilters.push('subject');
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  return {
    success: true,
    query: String(q || ''),
    parsed: {
      subject: parsed.subject,
      state: parsed.state,
      minRating: parsed.minRating,
      subjectMatch: parsed.subjectMatch,
      stateMatch: parsed.stateMatch,
      unrecognized: parsed.unrecognized,
    },
    filters: { subject: subject || null, state: state || null, minRating: minRating || null },
    relaxedFilters,
    total: results.length,
    limit: safeLimit,
    offset: safeOffset,
    results: results.slice(safeOffset, safeOffset + safeLimit),
  };
}

// ── Suggestions ──────────────────────────────────────────────────────────────

const SENTENCE = (subject, state) => {
  if (subject && state) return `Best teacher for ${subject} in ${state}`;
  if (subject) return `Best teacher for ${subject}`;
  if (state) return `Best teacher in ${state}`;
  return 'Best teacher';
};

function dedupeSuggestions(list, limit) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalize(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * How well a vocabulary value completes what the user is typing.
 * 3 = the value starts with the fragment, 2 = one of its words does,
 * 1 = it merely contains it, 0 = not a completion at all.
 */
function fragmentScore(value, fragment) {
  const v = normalize(value);
  const f = normalize(fragment);
  if (!f) return 3;
  if (v.startsWith(f)) return 3;
  if (v.split(' ').some(word => word.startsWith(f))) return 2;
  if (v.includes(f)) return 1;
  return 0;
}

/** Order by completion quality first, then by how common the value is. */
function rankCandidates(candidates) {
  return candidates
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.priority - b.priority || a.text.length - b.text.length);
}

/** "Maths" → "Mathematics": show one canonical name per subject group. */
function canonicalSubject(value) {
  const hit = SUBJECT_INDEX.get(normalize(value));
  return hit ? hit.canonical : value;
}

/**
 * Autocomplete for the search bar. Suggestions are built from data that
 * actually exists (states/subjects that have teachers) and fall back to the
 * canonical lists when the directory is empty.
 */
async function buildSuggestions({ q = '', state: studentState = '', limit = 8 }) {
  const directory = await getDirectory().catch(() => ({ byEmail: new Map(), states: [], subjects: [] }));
  const liveStates = stateCounts(directory).map(s => s.state);
  const liveSubjects = subjectCounts(directory).map(s => s.subject);

  // Ordered by usefulness: the student's own state and values that really have
  // teachers come before the canonical fallback lists.
  const stateChoices = [...new Set([
    ...(studentState ? [studentState] : []),
    ...liveStates,
    ...POPULAR_STATES,
    ...ALL_STATE_NAMES,
  ])];
  const subjectChoices = [...new Set(
    [...liveSubjects, ...POPULAR_SUBJECTS, ...ALL_SUBJECT_NAMES].map(canonicalSubject)
  )];

  const parsed = parseTeacherQuery(q, { knownStates: directory.states, knownSubjects: directory.subjects });
  const trailing = String(q || '').trim().split(/\s+/).pop() || '';
  const consumed = new Set([
    ...(parsed.subjectMatch ? parsed.subjectMatch.matched.split(' ') : []),
    ...(parsed.stateMatch ? parsed.stateMatch.matched.split(' ') : []),
  ]);
  // Only treat the last word as a fragment when it is not already understood.
  const fragment = consumed.has(normalize(trailing)) ? '' : trailing;

  const candidates = [];
  const subject = parsed.subject ? canonicalSubject(parsed.subject) : null;

  if (subject && parsed.state) {
    // Both variables known – offer the tidy sentence plus the same subject
    // elsewhere, in case the student wants to widen the area.
    candidates.push({ text: SENTENCE(subject, parsed.state), subject, state: parsed.state, score: 4, priority: -1 });
    stateChoices.forEach((state, priority) => {
      if (normalize(state) === normalize(parsed.state)) return;
      candidates.push({ text: SENTENCE(subject, state), subject, state, score: 1, priority });
    });
  } else if (subject) {
    // Subject known, ask for the state.
    stateChoices.forEach((state, priority) => {
      candidates.push({ text: SENTENCE(subject, state), subject, state, score: fragmentScore(state, fragment), priority });
    });
    candidates.push({ text: SENTENCE(subject, ''), subject, state: null, score: fragment ? 0 : 1, priority: 9999 });
  } else if (parsed.state) {
    // State known, ask for the subject.
    subjectChoices.forEach((choice, priority) => {
      candidates.push({ text: SENTENCE(choice, parsed.state), subject: choice, state: parsed.state, score: fragmentScore(choice, fragment), priority });
    });
  } else {
    // Nothing understood yet: complete on the subject, then fill the state with
    // the student's own state (or the states that actually have teachers).
    const defaultState = studentState || stateChoices[0] || '';
    subjectChoices.forEach((choice, priority) => {
      candidates.push({ text: SENTENCE(choice, defaultState), subject: choice, state: defaultState || null, score: fragmentScore(choice, fragment), priority });
    });
    if (fragment) {
      stateChoices.forEach((state, priority) => {
        candidates.push({ text: SENTENCE('', state), subject: null, state, score: fragmentScore(state, fragment), priority: priority + 1000 });
      });
    }
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
  return {
    success: true,
    query: String(q || ''),
    parsed: { subject: parsed.subject, state: parsed.state },
    suggestions: dedupeSuggestions(rankCandidates(candidates), safeLimit)
      .map(({ text, subject: s, state }) => ({ text, subject: s, state })),
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

const searchHandler = async (req, res) => {
  try {
    const source = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const payload = await runSearch({
      q: source.q || source.query || source.search || '',
      subject: source.subject || '',
      state: source.state || '',
      minRating: source.minRating,
      limit: source.limit,
      offset: source.offset,
      strict: source.strict === 'true' || source.strict === true,
    });
    return res.json(payload);
  } catch (error) {
    console.error('❌ teacher search failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to search teachers' });
  }
};

const suggestionsHandler = async (req, res) => {
  try {
    const source = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const payload = await buildSuggestions({
      q: source.q || source.query || source.search || '',
      state: source.state || source.studentState || '',
      limit: source.limit,
    });
    return res.json(payload);
  } catch (error) {
    console.error('❌ teacher search suggestions failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to build suggestions', suggestions: [] });
  }
};

const parseHandler = (req, res) => {
  const q = req.query.q || req.query.query || '';
  return res.json({ success: true, parsed: parseTeacherQuery(q) });
};

for (const base of ['/teacher-search', '/teachers/search', '/teacher-reviews/search']) {
  router.get(`${base}/suggestions`, suggestionsHandler);
  router.post(`${base}/suggestions`, suggestionsHandler);
  router.get(`${base}/parse`, parseHandler);
  router.get(base, searchHandler);
  router.post(base, searchHandler);
}

module.exports = router;
module.exports.runSearch = runSearch;
module.exports.buildSuggestions = buildSuggestions;
