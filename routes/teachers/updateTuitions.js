const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const client = require("../../config/db");
const verifyToken = require("../../utils/verifyToken");

const classBoardData = JSON.parse(fs.readFileSync(path.join(__dirname, "../../utils/allBoards.json"), "utf8"));

const getClassId = (boardName, className, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Subject teacher") {
      for (const board of category.boards) {
        if (board.name === boardName) {
          for (const cls of board.classes || []) {
            if (cls.name === className) return cls.id;
          }
        }
      }
    }
  }
  return null;
};

const getSkillID = (skillName, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Skill teacher") {
      for (const skill of category.skills) {
        if (skill.name === skillName) return skill.id;
      }
    }
  }
  return null;
};

const getUniversityYearId = (universityName, yearName, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Subject teacher") {
      for (const board of category.boards) {
        if (board.name === "Universities") {
          for (const uni of board.universities || []) {
            if (uni.name === universityName) {
              for (const year of uni.years || []) {
                if (year.name === yearName) return `${uni.id}_${year.id}`;
              }
            }
          }
        }
      }
    }
  }
  if (universityName && yearName) {
    const safeUni = universityName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const safeYear = yearName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `uni_${safeUni}_${safeYear}`;
  }
  return null;
};

// Update the tuitions column for a teacher and keep teacher_info rows grouped by subject/skill
router.post("/update-tuitions", verifyToken, async (req, res) => {
    try {
        const { email, name, tuitions } = req.body;
 
        if (!email || !name) {
            return res.status(400).json({
                success: false,
                message: "Email and name are required"
            });
        }
 
        if (!Array.isArray(tuitions)) {
            return res.status(400).json({
                success: false,
                message: "Tuitions must be an array"
            });
        }
 
        // Format tuitions array and assign classId / skillId per row
        const formattedTuitions = tuitions.map(t => {
            let teachingMode = t.teachingMode || ['Online'];
            if (Array.isArray(teachingMode)) teachingMode = teachingMode.join(', ');

            let idField = {};
            let base = {};
            if (t.skill) {
                idField = { skillId: getSkillID(t.skill, classBoardData) };
                base = { skill: t.skill || '' };
            } else if (t.board === 'Universities') {
                idField = { classId: getUniversityYearId(t.university, t.year, classBoardData) };
                base = {
                    university: t.university || '',
                    year: t.year || '',
                    subject: t.subject || '',
                    board: t.board || 'Universities'
                };
            } else {
                idField = { classId: getClassId(t.board, t.class, classBoardData) };
                base = {
                    class: t.class || '',
                    subject: t.subject || '',
                    board: t.board || ''
                };
            }

            return {
                ...base,
                timeFrom: t.timeFrom || '',
                timeTo: t.timeTo || '',
                charge: t.charge || '',
                day: t.day || '',
                teachingMode,
                ...idField,
                type: t.skill ? 'skill' : 'subject'
            };
        });
 
        // Update the tuitions column in teachers1 table
        await client.execute(
            `UPDATE teachers1 SET tuitions = ? WHERE email = ? AND name = ?`,
            [JSON.stringify(formattedTuitions), email, name],
            { prepare: true }
        );

        // Fetch existing teacher_info rows for this email
        const allIdsResult = await client.execute(`SELECT id FROM teacher_info WHERE email = ?`, [email], { prepare: true });
        const existingIds = new Set(allIdsResult.rows.map(r => r.id));

        // Group tuitions by skillId/classId so each teacher_info row is a single subject/skill group
        const tuitionsByKey = {};
        for (const tuition of formattedTuitions) {
            const key = tuition.skillId || tuition.classId || 'unknown';
            if (!tuitionsByKey[key]) tuitionsByKey[key] = [];
            tuitionsByKey[key].push(tuition);
        }
        const newKeys = Object.keys(tuitionsByKey);

        // Fetch profilepic and introduction from teachers1 for sync
        const teacherDataResult = await client.execute(`SELECT profilepic, introduction FROM teachers1 WHERE email = ? LIMIT 1`, [email], { prepare: true });
        const profilepic = teacherDataResult.rows.length > 0 ? (teacherDataResult.rows[0].profilepic || '') : '';
        const introduction = teacherDataResult.rows.length > 0 ? (teacherDataResult.rows[0].introduction || '') : '';

        // Delete stale teacher_info rows that no longer match any tuition group
        for (const existingId of existingIds) {
            if (!newKeys.includes(existingId)) {
                await client.execute(`DELETE FROM teacher_info WHERE id = ? AND email = ?`, [existingId, email], { prepare: true });
                console.log(`🗑️ Deleted stale teacher_info row for email: ${email}, id: ${existingId}`);
            }
        }

        // Upsert teacher_info rows per subject/skill group
        for (const key of newKeys) {
            await client.execute(
                `INSERT INTO teacher_info (id, email, name, tutions, profilePic, introduction) VALUES (?, ?, ?, ?, ?, ?)`,
                [key, email, name, JSON.stringify(tuitionsByKey[key]), profilepic, introduction],
                { prepare: true }
            );
            console.log(`✅ Synced teacher_info group for email: ${email}, id: ${key}`);
        }
        res.status(200).json({
            success: true,
            message: "Tuitions updated successfully and synced to teacher_info"
        });
 
    } catch (error) {
        console.error("❌ Error updating tuitions:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to update tuitions",
            error: error.message
        });
    }
});
 
module.exports = router;
