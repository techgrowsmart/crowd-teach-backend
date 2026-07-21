const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const { v4: uuidv4 } = require('uuid');
const client = require('../config/db'); 

// Add teacher to favorites
router.post('/add', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;
        const { teacherEmail } = req.body;

        if (!teacherEmail) {
            return res.status(400).json({ success: false, message: 'Teacher email is required' });
        }

        // Get teacher details
        const teacherQuery = 'SELECT email, name, profilePic, introduction, category FROM teachers1 WHERE email = ?';
        const teacherResult = await client.execute(teacherQuery, [teacherEmail], { prepare: true });

        if (teacherResult.rowLength === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        const teacher = teacherResult.rows[0];

        // Check if already favorited
        const checkQuery = 'SELECT * FROM favorite_teachers WHERE student_id = ? AND teacher_id = ?';
        const existing = await client.execute(checkQuery, [studentEmail, teacherEmail], { prepare: true });

        if (existing.rowLength > 0) {
            return res.status(400).json({ success: false, message: 'Teacher already in favorites' });
        }

        // Add to favorites
        const insertQuery = `
            INSERT INTO favorite_teachers (student_id, teacher_id, created_at, teacher_data)
            VALUES (?, ?, ?, ?)
        `;

        await client.execute(insertQuery, [
            studentEmail,
            teacherEmail,
            new Date(),
            JSON.stringify(teacher)
        ], { prepare: true });

        res.status(200).json({
            success: true,
            message: 'Teacher added to favorites'
        });

    } catch (error) {
        console.error('❌ Error adding to favorites:', error);
        res.status(500).json({ success: false, message: 'Failed to add favorite' });
    }
});

// Remove teacher from favorites
router.delete('/remove', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;
        const { teacherEmail } = req.body;

        if (!teacherEmail) {
            return res.status(400).json({ success: false, message: 'Teacher email is required' });
        }

        const deleteQuery = 'DELETE FROM favorite_teachers WHERE student_id = ? AND teacher_id = ?';
        await client.execute(deleteQuery, [studentEmail, teacherEmail], { prepare: true });

        res.status(200).json({
            success: true,
            message: 'Teacher removed from favorites'
        });

    } catch (error) {
        console.error('❌ Error removing from favorites:', error);
        res.status(500).json({ success: false, message: 'Failed to remove favorite' });
    }
});

// Get all favorite teachers for a student
router.get('/list', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;

        const query = 'SELECT teacher_id, created_at, teacher_data FROM favorite_teachers WHERE student_id = ?';
        const result = await client.execute(query, [studentEmail], { prepare: true });

        const favorites = result.rows.map(row => {
            const teacherData = JSON.parse(row.teacher_data);
            return {
                ...teacherData,
                isFavorite: true,
                favoritedAt: row.created_at
            };
        });

        res.status(200).json({
            success: true,
            favorites
        });

    } catch (error) {
        console.error('❌ Error fetching favorites:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch favorites' });
    }
});

// Check if teacher is favorited
router.get('/check/:teacherEmail', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;
        const { teacherEmail } = req.params;

        const query = 'SELECT * FROM favorite_teachers WHERE student_id = ? AND teacher_id = ?';
        const result = await client.execute(query, [studentEmail, teacherEmail], { prepare: true });

        res.status(200).json({
            success: true,
            isFavorited: result.rowLength > 0
        });

    } catch (error) {
        console.error('❌ Error checking favorite status:', error);
        res.status(500).json({ success: false, message: 'Failed to check favorite status' });
    }
});

module.exports = router;