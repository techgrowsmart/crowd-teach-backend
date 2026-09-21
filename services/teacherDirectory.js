/**
 * Cached, in-memory "teacher directory".
 *
 * Teacher profile data lives in Cassandra across two tables:
 *   teachers1 → name / picture / tuitions (what they teach)
 *   tutors    → state (where they are), specialization, experience
 * Cassandra cannot join, and the review data that drives the search lives in
 * MongoDB, so the join happens here in memory. The directory is small (a few
 * thousand rows at most) and is refreshed lazily every few minutes.
 */

const client = require('../config/db');
const { normalize } = require('../utils/searchVocab');

const TTL_MS = 5 * 60 * 1000;

let cache = null;          // { builtAt, byEmail: Map, states: [], subjects: [] }
let inFlight = null;       // de-duplicates concurrent rebuilds

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Everything a teacher teaches, as plain display strings. */
function extractTaught(tuitions) {
  const values = [];
  for (const tuition of tuitions) {
    if (!tuition || typeof tuition !== 'object') continue;
    if (tuition.subject) values.push(String(tuition.subject));
    if (tuition.skill) values.push(String(tuition.skill));
  }
  return [...new Set(values)];
}

async function build() {
  const byEmail = new Map();

  const teacherRows = await client.execute(
    `SELECT email, name, category, introduction, profilepic, qualifications, teachingmode,
            tuitions, workexperience, isspotlight, spotlight_type
     FROM teachers1`,
    [], { prepare: true }
  );

  for (const row of teacherRows.rows) {
    if (!row.email) continue;
    const email = String(row.email).toLowerCase();
    const tuitions = parseJsonArray(row.tuitions);
    byEmail.set(email, {
      email: row.email,
      name: row.name || '',
      category: row.category || '',
      introduction: row.introduction || '',
      profilePic: row.profilepic || null,
      qualifications: parseJsonArray(row.qualifications),
      teachingMode: parseJsonArray(row.teachingmode),
      workExperience: row.workexperience || '',
      isSpotlight: row.isspotlight === true,
      spotlightType: row.spotlight_type || '',
      tuitions,
      taught: extractTaught(tuitions),
      state: '',
      specialization: '',
      experience: '',
    });
  }

  // tutors holds the registration details, including the teacher's state.
  try {
    const tutorRows = await client.execute(
      `SELECT email, full_name, state, specialization, experience FROM tutors`,
      [], { prepare: true }
    );
    for (const row of tutorRows.rows) {
      if (!row.email) continue;
      const email = String(row.email).toLowerCase();
      const existing = byEmail.get(email) || {
        email: row.email, name: row.full_name || '', category: '', introduction: '',
        profilePic: null, qualifications: [], teachingMode: [], workExperience: '',
        isSpotlight: false, spotlightType: '', tuitions: [], taught: [],
        state: '', specialization: '', experience: '',
      };
      existing.state = row.state || existing.state || '';
      existing.specialization = row.specialization || existing.specialization || '';
      existing.experience = row.experience || existing.experience || '';
      if (!existing.name) existing.name = row.full_name || '';
      byEmail.set(email, existing);
    }
  } catch (err) {
    console.warn('⚠️ teacherDirectory: tutors lookup failed:', err.message);
  }

  const states = [...new Set([...byEmail.values()].map(t => t.state).filter(Boolean))];
  const subjects = [...new Set([...byEmail.values()].flatMap(t => t.taught).filter(Boolean))];

  return { builtAt: Date.now(), byEmail, states, subjects };
}

/** @param {boolean} [force] rebuild even when the cache is still warm */
async function getDirectory(force = false) {
  const fresh = cache && Date.now() - cache.builtAt < TTL_MS;
  if (fresh && !force) return cache;
  if (inFlight) return inFlight;

  inFlight = build()
    .then((built) => { cache = built; return built; })
    .catch((err) => {
      console.error('❌ teacherDirectory build failed:', err.message);
      if (cache) return cache; // serve stale rather than nothing
      throw err;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

function getTeacher(directory, email) {
  if (!email) return null;
  return directory.byEmail.get(String(email).toLowerCase()) || null;
}

/** Distinct states with the number of listed teachers, most populated first. */
function stateCounts(directory) {
  const counts = new Map();
  for (const teacher of directory.byEmail.values()) {
    if (!teacher.state) continue;
    const key = normalize(teacher.state);
    const entry = counts.get(key) || { state: teacher.state, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** Distinct subjects/skills taught, most offered first. */
function subjectCounts(directory) {
  const counts = new Map();
  for (const teacher of directory.byEmail.values()) {
    for (const subject of teacher.taught) {
      const key = normalize(subject);
      if (!key) continue;
      const entry = counts.get(key) || { subject, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

module.exports = { getDirectory, getTeacher, stateCounts, subjectCounts, parseJsonArray };
