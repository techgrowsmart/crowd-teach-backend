/**
 * Vocabulary + text helpers used by the natural-language teacher search.
 *
 * A search sentence like "best teacher for maths in Andra pradesh" carries only
 * two real variables: the SUBJECT (maths) and the STATE (Andhra Pradesh).
 * Everything in this file exists to recognise those two variables reliably,
 * even when the user misspells them or uses a short form.
 */

const fs = require('fs');
const path = require('path');

// ── Text normalisation ────────────────────────────────────────────────────────

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
function similarity(a, b) {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

// ── Words that carry no filter meaning ───────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'best', 'better', 'top', 'good', 'great', 'nice', 'excellent',
  'highest', 'high', 'rated', 'rating', 'ratings', 'review', 'reviews', 'reviewed',
  'star', 'stars', 'teacher', 'teachers', 'tutor', 'tutors', 'trainer', 'trainers',
  'faculty', 'mentor', 'mentors', 'coach', 'coaches', 'instructor', 'instructors',
  'for', 'of', 'in', 'at', 'near', 'from', 'around', 'within', 'inside', 'across',
  'me', 'my', 'i', 'we', 'you', 'is', 'are', 'am', 'be', 'who', 'whom', 'which',
  'what', 'where', 'find', 'show', 'get', 'give', 'list', 'search', 'searching',
  'looking', 'look', 'want', 'need', 'please', 'kindly', 'help', 'with', 'and',
  'or', 'to', 'by', 'on', 'any', 'all', 'some', 'most', 'more', 'popular', 'famous',
  'experienced', 'expert', 'experts', 'online', 'offline', 'home', 'tuition',
  'tuitions', 'class', 'classes', 'coaching', 'state', 'india', 'subject', 'skill',
  'above', 'below', 'over', 'under', 'than', 'plus', 'higher', 'least', 'atleast',
  'minimum', 'maximum', 'quality', 'affordable', 'cheap', 'available',
]);

/** Prepositions that usually introduce a place. */
const LOCATION_PREPOSITIONS = new Set(['in', 'at', 'near', 'from', 'around', 'inside', 'within', 'of']);

/** Prepositions that usually introduce the thing being taught. */
const SUBJECT_PREPOSITIONS = new Set(['for', 'in', 'of', 'teaching', 'teaches', 'taught']);

// ── Indian states / union territories ────────────────────────────────────────

const STATES = [
  { name: 'Andhra Pradesh', aliases: ['ap', 'andhra', 'andra', 'andra pradesh', 'andhrapradesh', 'andhra predesh'] },
  { name: 'Arunachal Pradesh', aliases: ['arunachal'] },
  { name: 'Assam', aliases: [] },
  { name: 'Bihar', aliases: [] },
  { name: 'Chhattisgarh', aliases: ['chattisgarh', 'chhatisgarh'] },
  { name: 'Goa', aliases: [] },
  { name: 'Gujarat', aliases: ['gujrat'] },
  { name: 'Haryana', aliases: ['hariyana'] },
  { name: 'Himachal Pradesh', aliases: ['hp', 'himachal'] },
  { name: 'Jharkhand', aliases: ['jharkand'] },
  { name: 'Karnataka', aliases: ['karnatka', 'bangalore', 'bengaluru'] },
  { name: 'Kerala', aliases: ['keral'] },
  { name: 'Madhya Pradesh', aliases: ['mp', 'madhya'] },
  { name: 'Maharashtra', aliases: ['maharastra', 'maharashtr', 'mumbai', 'pune'] },
  { name: 'Manipur', aliases: [] },
  { name: 'Meghalaya', aliases: [] },
  { name: 'Mizoram', aliases: [] },
  { name: 'Nagaland', aliases: [] },
  { name: 'Odisha', aliases: ['orissa'] },
  { name: 'Punjab', aliases: ['panjab'] },
  { name: 'Rajasthan', aliases: ['rajastan'] },
  { name: 'Sikkim', aliases: [] },
  { name: 'Tamil Nadu', aliases: ['tn', 'tamilnadu', 'tamil', 'chennai'] },
  { name: 'Telangana', aliases: ['telengana', 'hyderabad'] },
  { name: 'Tripura', aliases: [] },
  { name: 'Uttar Pradesh', aliases: ['up', 'uttarpradesh'] },
  { name: 'Uttarakhand', aliases: ['uttaranchal', 'uttrakhand'] },
  { name: 'West Bengal', aliases: ['wb', 'bengal', 'westbengal', 'kolkata'] },
  { name: 'Andaman and Nicobar Islands', aliases: ['andaman', 'nicobar', 'andaman and nicobar'] },
  { name: 'Chandigarh', aliases: [] },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', aliases: ['dadra and nagar haveli', 'daman and diu', 'daman', 'diu'] },
  { name: 'Delhi', aliases: ['new delhi', 'ncr', 'delhi ncr'] },
  { name: 'Jammu and Kashmir', aliases: ['jk', 'j and k', 'jammu', 'kashmir', 'jammu kashmir'] },
  { name: 'Ladakh', aliases: ['leh'] },
  { name: 'Lakshadweep', aliases: [] },
  { name: 'Puducherry', aliases: ['pondicherry', 'pondy'] },
];

// ── Subject / skill vocabulary (sourced from utils/allBoards.json) ───────────

function collectFromBoards() {
  const subjects = new Set();
  const skills = new Set();
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'allBoards.json'), 'utf8');
    const data = JSON.parse(raw);
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'subjects' && Array.isArray(value)) value.forEach(s => s && s.name && subjects.add(s.name));
        else if (key === 'skills' && Array.isArray(value)) value.forEach(s => s && s.name && skills.add(s.name));
        else walk(value);
      }
    };
    walk(data);
  } catch (err) {
    console.warn('⚠️ searchVocab: could not read allBoards.json:', err.message);
  }
  return { subjects: [...subjects], skills: [...skills] };
}

const { subjects: BOARD_SUBJECTS, skills: BOARD_SKILLS } = collectFromBoards();

/**
 * Short forms / misspellings → canonical subject name.
 * Keys must already be normalised.
 */
const SUBJECT_ALIASES = {
  maths: 'Mathematics',
  math: 'Mathematics',
  mathematic: 'Mathematics',
  mathematics: 'Mathematics',
  mats: 'Mathematics',
  algebra: 'Mathematics',
  geometry: 'Mathematics',
  trigonometry: 'Mathematics',
  calculus: 'Mathematics',
  phy: 'Physics',
  physic: 'Physics',
  chem: 'Chemistry',
  chemistry: 'Chemistry',
  bio: 'Biology',
  biology: 'Biology',
  botany: 'Biology',
  zoology: 'Zoology',
  sci: 'Science',
  science: 'Science',
  cs: 'Computer Science',
  computer: 'Computer Science',
  computers: 'Computer Science',
  'comp sci': 'Computer Science',
  'computer sci': 'Computer Science',
  coding: 'Computer Science',
  programming: 'Computer Science',
  it: 'Information Technology',
  ai: 'Artificial Intelligence',
  ml: 'Machine Learning',
  eng: 'English',
  english: 'English',
  grammar: 'English',
  sst: 'Social Studies',
  'social science': 'Social Studies',
  'social sciences': 'Social Studies',
  social: 'Social Studies',
  civics: 'Political Science',
  'pol sci': 'Political Science',
  polsci: 'Political Science',
  eco: 'Economics',
  economy: 'Economics',
  economics: 'Economics',
  accounts: 'Accountancy',
  accounting: 'Accountancy',
  acc: 'Accountancy',
  bst: 'Business Studies',
  business: 'Business Studies',
  geo: 'Geography',
  hist: 'History',
  psych: 'Psychology',
  psycho: 'Psychology',
  stats: 'Statistics',
  sanskrit: 'Sanskrit',
  hindi: 'Hindi',
  telugu: 'Telugu',
  tamil: 'Tamil',
  kannada: 'Kannada',
  malayalam: 'Malayalam',
  marathi: 'Marathi',
  bengali: 'Bengali',
  urdu: 'Urdu',
  gujarati: 'Gujarati',
  punjabi: 'Punjabi',
  french: 'French',
  german: 'German',
  spanish: 'Spanish',
  japanese: 'Japanese',
  guitar: 'Music',
  piano: 'Music',
  singing: 'Music',
  vocal: 'Music',
  dancing: 'Dance',
  drawing: 'Art',
  painting: 'Art',
  photo: 'Photography',
  gym: 'Workout',
  fitness: 'Workout',
  yoga: 'Yoga',
  karate: 'Martial Arts',
  chess: 'Chess',
  stitching: 'Stitching and Tailoring',
  tailoring: 'Stitching and Tailoring',
  mehendi: 'Mehendi Art',
  cooking: 'Cooking',
  baking: 'Cooking',
};

/**
 * Terms that must never be treated as a subject even though they appear in the
 * board data (they are ambiguous with the sentence scaffolding).
 */
const SUBJECT_BLOCKLIST = new Set(['thesis', 'dissertation', 'project', 'internship', 'elective', 'electives', 'other', 'others']);

/**
 * Build the lookup used by the parser: normalised term → { canonical, kind, terms }.
 * `terms` holds every equivalent spelling of that value, which is what the data
 * filter compares against (a teacher may have stored "Maths" while the student
 * typed "mathematics").
 */
function buildTermIndex(groups, kindFor) {
  const index = new Map();
  for (const { canonical, terms } of groups) {
    const normalizedTerms = [...new Set(terms.map(normalize).filter(t => t && t.length >= 2))];
    if (normalizedTerms.length === 0) continue;
    const value = { canonical, kind: typeof kindFor === 'function' ? kindFor(canonical) : kindFor, terms: normalizedTerms };
    for (const term of normalizedTerms) {
      if (!index.has(term)) index.set(term, value);
    }
  }
  return index;
}

/** canonical subject name → every spelling that means the same thing */
function buildSubjectGroups() {
  const groups = new Map(); // normalized canonical → { canonical, terms:Set }
  const add = (canonical, term) => {
    const key = normalize(canonical);
    if (!groups.has(key)) groups.set(key, { canonical, terms: new Set([key]) });
    groups.get(key).terms.add(normalize(term));
  };

  // Short forms first so that the *canonical* name is the one we display back.
  for (const [alias, canonical] of Object.entries(SUBJECT_ALIASES)) add(canonical, alias);

  // Platform subjects/skills: fold into an existing group when they are just
  // another spelling of it, otherwise they become their own group.
  const foldable = new Map();
  for (const group of groups.values()) {
    for (const term of group.terms) foldable.set(term, group);
  }
  for (const name of [...BOARD_SUBJECTS, ...BOARD_SKILLS]) {
    const key = normalize(name);
    if (!key || SUBJECT_BLOCKLIST.has(key)) continue;
    const existing = foldable.get(key);
    if (existing) existing.terms.add(key);
    else if (!groups.has(key)) groups.set(key, { canonical: name, terms: new Set([key]) });
  }

  return [...groups.values()].map(g => ({ canonical: g.canonical, terms: [...g.terms] }));
}

const SUBJECT_GROUPS = buildSubjectGroups();
const SKILL_NAMES = new Set(BOARD_SKILLS.map(normalize));

const SUBJECT_INDEX = buildTermIndex(
  SUBJECT_GROUPS,
  (canonical) => (SKILL_NAMES.has(normalize(canonical)) ? 'skill' : 'subject')
);

const STATE_INDEX = buildTermIndex(
  STATES.map(({ name, aliases }) => ({ canonical: name, terms: [name, ...aliases] })),
  'state'
);

/** Subjects worth offering as search suggestions before the user types. */
const POPULAR_SUBJECTS = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Science',
  'Computer Science', 'Accountancy', 'Economics', 'Social Studies', 'Hindi',
  'History', 'Geography', 'Political Science', 'Business Studies', 'Statistics',
];

const POPULAR_STATES = [
  'Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Karnataka', 'Maharashtra',
  'Delhi', 'Uttar Pradesh', 'West Bengal', 'Kerala', 'Gujarat', 'Rajasthan',
  'Madhya Pradesh', 'Punjab', 'Bihar',
];

const ALL_STATE_NAMES = STATES.map(s => s.name);
const ALL_SUBJECT_NAMES = SUBJECT_GROUPS.map(g => g.canonical).sort();

module.exports = {
  normalize,
  tokenize,
  levenshtein,
  similarity,
  STOPWORDS,
  LOCATION_PREPOSITIONS,
  SUBJECT_PREPOSITIONS,
  SUBJECT_INDEX,
  STATE_INDEX,
  SUBJECT_ALIASES,
  ALL_STATE_NAMES,
  ALL_SUBJECT_NAMES,
  POPULAR_SUBJECTS,
  POPULAR_STATES,
  BOARD_SKILLS,
};
