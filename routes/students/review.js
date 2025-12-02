
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const client = require("../../config/db");


router.post('/review', async (req, res) => {
    const {
        teacherEmail,
        teacherName,
        studentEmail,
        studentName,
        studentProfilePic,
        rating,
        selectedTags,
        reviewText
    } = req.body;

    if (!teacherEmail || !studentEmail || !rating || !reviewText) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    const reviewId = uuidv4();
    const createdAt = new Date();

    const query = `
        INSERT INTO teacher_reviews (
            teacher_email, review_id, teacher_name,
            student_email, student_name, student_profile_pic,
            rating, selected_tags, review_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    const params = [
        teacherEmail, reviewId, teacherName,
        studentEmail, studentName, studentProfilePic || '',
        rating, selectedTags, reviewText, createdAt
    ];

    try {
        await client.execute(query, params, { prepare: true });
        res.status(200).json({ message: 'Review submitted' });
    } catch (error) {
        console.error('Failed to insert review:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/', async (req, res) => {

    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ message: 'Email query param is required' });
    }

    const query = `SELECT * FROM teacher_reviews WHERE teacher_email = ? ALLOW FILTERING`;

    try {
        const result = await client.execute(query, [email], { prepare: true });

        const reviews = result.rows;
        res.status(200).json({ reviews });
    } catch (error) {
        console.error('❌ Failed to fetch reviews:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
