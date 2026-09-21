/**
 * Student search for teachers.
 *
 * The teacher search bar understands free text ("Ravi Sharma CBSE Class 10 Andhra Pradesh")
 * the same way the student-side teacher search does: the sentence is broken into
 * tokens and every token has to match one of the student's profile fields.
 *
 * Endpoints (mounted under /api):
 *   GET  /student-search?q=...              → matching students (full profile fields)
 *   GET  /student-search/suggestions?q=...  → autocomplete students for the search bar
 *   GET  /student-search/filters            → distinct boards / classes / states in the data
 *
 * All endpoints require a teacher JWT – student profile data is PII.
 */

const express = require('express');
const router = express.Router();

const client = require('../../config/db');
const verifyToken = require('../../utils/verifyToken');
const { normalize, tokenize, STOPWORDS } = require('../../utils/searchVocab');

const TTL_MS = 2 * 60 * 1000;

let cache = null;   // { builtAt, byEmail: Map }
let inFlight = null;

// ── Directory (cached full table scan – student table is small) ─────────────

async function build() {
  const byEmail = new Map();
  const result = await client.execute(
    `SELECT email, name, profileimage, board, class_year, medium, school_name,
            state, phone_number, address, pincode, country, date_of_birth
     FROM student`,
    [], { prepare: true }
  );

  for (const row of result.rows || []) {
    if (!row.email) continue;
    const email = String(row.email).toLowerCase();
    byEmail.set(email, {
      email: row.email,
      name: row.name || '',
      profileImage: row.profileimage || null,
      educationBoard: row.board || '',
      classYear: row.class_year || '',
      preferredMedium: row.medium || '',
      instituteName: row.school_name || '',
      stateName: row.state || '',
      phone: row.phone_number || '',
      fullAddress: row.address || '',
      pincode: row.pincode || '',
      country: row.country || '',
      dateOfBirth: row.date_of_birth || '',
    });
  }

  return { builtAt: Date.now(), byEmail };
}

async function getDirectory(force = false) {
  if (cache && Date.now() - cache.builtAt < TTL_MS && !force) return cache;
  if (inFlight) return inFlight;

  inFlight = build()
    .then((built) => { cache = built; return built; })
    .catch((err) => {
      console.error('❌ studentDirectory build failed:', err.message);
      if (cache) return cache;
      throw err;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

// ── Matching helpers ─────────────────────────────────────────────────────────

/** Case/punctuation-insensitive substring match either way. */
function matchString(value, term) {
  const v = normalize(value);
  const t = normalize(term);
  if (!t) return true;
  if (!v) return false;
  return v.includes(t) || t.includes(v);
}

/** Does this single token appear anywhere in the student's searchable fields? */
function tokenMatches(student, token) {
  const t = normalize(token);
  if (!t) return true;
  const fields = [
    student.name,
    student.educationBoard,
    student.classYear,
    student.stateName,
    student.instituteName,
    student.preferredMedium,
    student.country,
    student.fullAddress,
    student.pincode,
    student.phone,
    student.email,
  ];
  return fields.some(field => normalize(field).split(' ').some(w => w === t || w.startsWith(t)) || normalize(field).includes(t));
}

function countNameTokenMatches(student, tokens) {
  const name = normalize(student.name);
  return tokens.reduce((acc, t) => acc + (name.includes(t) ? 1 : 0), 0);
}

// ── Core search ──────────────────────────────────────────────────────────────

async function runSearch(params) {
  const {
    q = '',
    name = '',
    board = '',
    classYear = '',
    state = '',
    limit = 20,
    offset = 0,
  } = params;

  const directory = await getDirectory();
  const qTokens = tokenize(q).filter(t => !STOPWORDS.has(t));

  const results = [];
  for (const student of directory.byEmail.values()) {
    if (name && !matchString(student.name, name)) continue;
    if (board && !matchString(student.educationBoard, board)) continue;
    if (classYear && !matchString(student.classYear, classYear)) continue;
    if (state && !matchString(student.stateName, state)) continue;

    if (qTokens.length > 0 && !qTokens.every(token => tokenMatches(student, token))) continue;

    results.push(student);
  }

  const needle = normalize(q);
  results.sort((a, b) => {
    const aName = normalize(a.name);
    const bName = normalize(b.name);
    // Exact name match first, then prefix match, then more name-token hits.
    const aExact = needle && aName === needle ? 1 : 0;
    const bExact = needle && bName === needle ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aPrefix = needle && aName.startsWith(needle) ? 1 : 0;
    const bPrefix = needle && bName.startsWith(needle) ? 1 : 0;
    if (aPrefix !== bPrefix) return bPrefix - aPrefix;
    const aScore = countNameTokenMatches(a, qTokens);
    const bScore = countNameTokenMatches(b, qTokens);
    if (aScore !== bScore) return bScore - aScore;
    return String(a.name).localeCompare(String(b.name));
  });

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  return {
    success: true,
    query: String(q || ''),
    filters: {
      name: name || null,
      board: board || null,
      classYear: classYear || null,
      state: state || null,
    },
    total: results.length,
    limit: safeLimit,
    offset: safeOffset,
    results: results.slice(safeOffset, safeOffset + safeLimit),
  };
}

// ── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Autocomplete for the teacher's student search bar. Suggestions are actual
 * students whose name completes the trailing fragment, so the teacher can tap a
 * name straight into the preview. The trailing fragment also fuzzy-matches the
 * student's board/class/state so typing "CBSE" or "Telangana" still surfaces
 * the right students.
 */
async function buildSuggestions({ q = '', limit = 8 }) {
  const text = String(q || '');
  const tokens = tokenize(text).filter(t => !STOPWORDS.has(t));
  const fragment = tokens[tokens.length - 1] || '';
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);

  if (!fragment || fragment.length < 2) {
    return { success: true, query: text, suggestions: [] };
  }

  const directory = await getDirectory();
  const fragmentScore = (value) => {
    const v = normalize(value);
    if (!v) return 0;
    if (v.startsWith(fragment)) return 3;
    if (v.split(' ').some(w => w.startsWith(fragment))) return 2;
    if (v.includes(fragment)) return 1;
    return 0;
  };

  const candidates = [];
  for (const student of directory.byEmail.values()) {
    const score = fragmentScore(student.name);
    if (score > 0) {
      candidates.push({ student, score });
      continue;
    }
    // Field completions – the name doesn't match but the class/board/state does.
    const fieldHit =
      fragmentScore(student.educationBoard) ||
      fragmentScore(student.classYear) ||
      fragmentScore(student.stateName) ||
      fragmentScore(student.instituteName);
    if (fieldHit > 0) candidates.push({ student, score: fieldHit * 0.5 });
  }

  candidates.sort((a, b) => b.score - a.score || a.student.name.localeCompare(b.student.name));

  return {
    success: true,
    query: text,
    suggestions: candidates.slice(0, safeLimit).map(({ student }) => ({
      type: 'student',
      text: student.name,
      ...student,
    })),
  };
}

// ── Distinct filter values ───────────────────────────────────────────────────

async function listFilters() {
  const directory = await getDirectory();
  const boards = new Set();
  const classYears = new Set();
  const states = new Set();
  for (const s of directory.byEmail.values()) {
    if (s.educationBoard) boards.add(s.educationBoard);
    if (s.classYear) classYears.add(s.classYear);
    if (s.stateName) states.add(s.stateName);
  }
  return {
    success: true,
    boards: [...boards].sort(),
    classYears: [...classYears].sort(),
    states: [...states].sort(),
  };
}

// ── Auth: teachers only ──────────────────────────────────────────────────────

const requireTeacher = (req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'teacher' && role !== 'tutor') {
    return res.status(403).json({ success: false, message: 'Only teachers can search students' });
  }
  next();
};

// ── Routes ───────────────────────────────────────────────────────────────────

const searchHandler = async (req, res) => {
  try {
    const source = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const payload = await runSearch({
      q: source.q || source.query || source.search || '',
      name: source.name || '',
      board: source.board || '',
      classYear: source.classYear || source.class_year || '',
      state: source.state || '',
      limit: source.limit,
      offset: source.offset,
    });
    return res.json(payload);
  } catch (error) {
    console.error('❌ student search failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to search students' });
  }
};

const suggestionsHandler = async (req, res) => {
  try {
    const source = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
    const payload = await buildSuggestions({
      q: source.q || source.query || source.search || '',
      limit: source.limit,
    });
    return res.json(payload);
  } catch (error) {
    console.error('❌ student search suggestions failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to build suggestions', suggestions: [] });
  }
};

const filtersHandler = async (_req, res) => {
  try {
    return res.json(await listFilters());
  } catch (error) {
    console.error('❌ student search filters failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
};

for (const base of ['/student-search', '/students/search']) {
  router.get(`${base}/suggestions`, verifyToken, requireTeacher, suggestionsHandler);
  router.post(`${base}/suggestions`, verifyToken, requireTeacher, suggestionsHandler);
  router.get(`${base}/filters`, verifyToken, requireTeacher, filtersHandler);
  router.get(base, verifyToken, requireTeacher, searchHandler);
  router.post(base, verifyToken, requireTeacher, searchHandler);
}

module.exports = router;
module.exports.runSearch = runSearch;
module.exports.buildSuggestions = buildSuggestions;
