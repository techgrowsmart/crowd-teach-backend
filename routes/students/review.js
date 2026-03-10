
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
        return res.status(400).json({ 
            success: false,
            message: 'Missing required fields' 
        });
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
        teacherEmail,
        reviewId,
        teacherName,
        studentEmail,
        studentName,
        studentProfilePic,
        rating,
        selectedTags || '',
        reviewText,
        createdAt
    ];

    try {
        await client.execute(query, params, { prepare: true });
        console.log(`✅ Review submitted successfully by ${studentEmail} for ${teacherEmail}`);
        res.status(200).json({ 
            success: true,
            message: 'Review submitted successfully',
            reviewId: reviewId 
        });
    } catch (error) {
        console.error('Failed to insert review:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: error.message 
        });
    }
});

// Test route to verify router is working
router.get('/ping', async (req, res) => {
    res.status(200).json({ message: 'Review router is working', timestamp: new Date().toISOString() });
});

// Root route to show available endpoints
router.get('/', async (req, res) => {
    res.status(200).json({ 
        message: 'Review API endpoints',
        endpoints: {
            'GET /': 'List all endpoints',
            'GET /ping': 'Test if router is working',
            'GET /student-reviews?studentEmail=xxx': 'Get reviews by student email',
            'GET /all-reviews': 'Get all reviews',
            'GET /teacher?email=xxx': 'Get reviews by teacher email',
            'POST /review': 'Create a new review'
        }
    });
});

router.get('/student-reviews', async (req, res) => {
    const { studentEmail } = req.query;

    if (!studentEmail) {
        return res.status(400).json({ 
            success: false,
            message: 'Student email query param is required' 
        });
    }

    const query = `SELECT * FROM teacher_reviews WHERE student_email = ? ALLOW FILTERING`;

    try {
        const result = await client.execute(query, [studentEmail], { prepare: true });
        
        // Get profile pictures for all students in the reviews
        const studentEmails = [...new Set(result.rows.map(review => review.student_email))];
        const studentProfiles = {};
        
        // Fetch profile pictures from student table
        for (const email of studentEmails) {
            try {
                const studentQuery = `SELECT profileimage FROM student WHERE email = ?`;
                const studentResult = await client.execute(studentQuery, [email], { prepare: true });
                
                if (studentResult.rows.length > 0 && studentResult.rows[0].profileimage) {
                    studentProfiles[email] = studentResult.rows[0].profileimage;
                }
            } catch (err) {
                console.warn(`Could not fetch profile for ${email}:`, err.message);
            }
        }
        
        // Update reviews with actual profile pictures
        const reviews = result.rows.map(review => ({
            ...review,
            student_profile_pic: studentProfiles[review.student_email] || review.student_profile_pic,
            selected_tags: review.selected_tags || ''
        }));
        
        console.log(`Found ${reviews.length} reviews for student ${studentEmail}`);
        res.status(200).json({ 
            success: true,
            count: reviews.length,
            reviews: reviews 
        });
    } catch (error) {
        console.error('❌ Failed to fetch student reviews:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: error.message 
        });
    }
});

router.get('/test', async (req, res) => {
    res.status(200).json({ message: 'Review routes are working' });
});

router.get('/all-reviews', async (req, res) => {
    const query = `SELECT * FROM teacher_reviews ALLOW FILTERING`;

    try {
        const result = await client.execute(query, [], { prepare: true });
        
        // Get profile pictures for all students in the reviews
        const studentEmails = [...new Set(result.rows.map(review => review.student_email))];
        const studentProfiles = {};
        
        // Fetch profile pictures from student table
        for (const email of studentEmails) {
            try {
                const studentQuery = `SELECT profileimage FROM student WHERE email = ?`;
                const studentResult = await client.execute(studentQuery, [email], { prepare: true });
                
                if (studentResult.rows.length > 0 && studentResult.rows[0].profileimage) {
                    studentProfiles[email] = studentResult.rows[0].profileimage;
                }
            } catch (err) {
                console.warn(`Could not fetch profile for ${email}:`, err.message);
            }
        }
        
        // Update reviews with actual profile pictures
        const reviews = result.rows.map(review => ({
            ...review,
            student_profile_pic: studentProfiles[review.student_email] || review.student_profile_pic,
            selected_tags: review.selected_tags || ''
        }));
        
        console.log(`Found ${reviews.length} total reviews`);
        res.status(200).json({ 
            success: true,
            count: reviews.length,
            reviews: reviews 
        });
    } catch (error) {
        console.error('❌ Failed to fetch all reviews:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: error.message 
        });
    }
});

router.get('/teacher', async (req, res) => {

    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ 
            success: false,
            message: 'Email query param is required' 
        });
    }

    const query = `SELECT * FROM teacher_reviews WHERE teacher_email = ? ALLOW FILTERING`;

    try {
        const result = await client.execute(query, [email], { prepare: true });

        const reviews = result.rows.map(review => ({
            ...review,
            selected_tags: review.selected_tags || ''
        }));
        console.log(`Found ${reviews.length} reviews for teacher ${email}`);
        
        // Calculate average rating
        const averageRating = reviews.length > 0
            ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
            : 0;

        res.status(200).json({ 
            success: true,
            count: reviews.length,
            averageRating: averageRating.toFixed(1),
            reviews: reviews 
        });
    } catch (error) {
        console.error('❌ Failed to fetch reviews:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: error.message 
        });
    }
});

module.exports = router;
