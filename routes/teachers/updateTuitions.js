const express = require("express");
const router = express.Router();
const client = require("../../config/db");
const verifyToken = require("../../utils/verifyToken");

// Update only the tuitions column for a teacher
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

        // Format tuitions array - ensure teachingMode is included in each tuition
        const formattedTuitions = tuitions.map(t => {
            // Handle teachingMode - can be array or string
            let teachingMode = t.teachingMode || ['Online'];
            if (Array.isArray(teachingMode)) {
                teachingMode = teachingMode.join(', ');
            }

            // Build tuition object based on type
            if (t.board === 'Universities') {
                return {
                    university: t.university || '',
                    year: t.year || '',
                    subject: t.subject || '',
                    board: t.board || 'Universities',
                    timeFrom: t.timeFrom || '',
                    timeTo: t.timeTo || '',
                    charge: t.charge || '',
                    day: t.day || '',
                    teachingMode: teachingMode
                };
            } else if (t.skill) {
                // Skill teacher format
                return {
                    skill: t.skill || '',
                    timeFrom: t.timeFrom || '',
                    timeTo: t.timeTo || '',
                    charge: t.charge || '',
                    day: t.day || '',
                    teachingMode: teachingMode
                };
            } else {
                // Regular subject teacher format
                return {
                    class: t.class || '',
                    subject: t.subject || '',
                    board: t.board || '',
                    timeFrom: t.timeFrom || '',
                    timeTo: t.timeTo || '',
                    charge: t.charge || '',
                    day: t.day || '',
                    classId: t.classId || '',
                    teachingMode: teachingMode
                };
            }
        });

        // Update only the tuitions column in teachers1 table
        const updateQuery = `UPDATE teachers1 SET tuitions = ? WHERE email = ? AND name = ?`;
        const params = [JSON.stringify(formattedTuitions), email, name];

        await client.execute(updateQuery, params, { prepare: true });

        res.status(200).json({
            success: true,
            message: "Tuitions updated successfully"
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
