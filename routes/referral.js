const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const client = require('../config/db');
const verifyToken = require('../utils/verifyToken');

// Helper to generate a stable referral code from a UUID
function generateReferralCode(userId) {
    const base = userId.replace(/-/g, '').slice(0, 10).toUpperCase();
    let sum = 0;
    for (let i = 0; i < 8 && i < base.length; i++) {
        sum += base.charCodeAt(i);
    }
    const checksum = sum % 1000;
    return `GS${base}${checksum}`;
}

// Milestone definitions: count -> months of free subscription
const MILESTONES = [
    { count: 7,  months: 3 },   // 3 months free
    { count: 12, months: 6 },   // 6 months free
    { count: 20, months: 12 },  // 1 year free
];

// Helper: activate spotlight for a teacher
async function activateSpotlight(email, name, months) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);
    const updateQuery = `
        UPDATE teachers1 
        SET isspotlight = true, spotlight_type = ?, subscription_expiry = ?
        WHERE email = ? AND name = ?
    `;
    await client.execute(updateQuery, ['both', expiry, email, name], { prepare: true });
    console.log(`✅ Spotlight activated for ${email} for ${months} months until ${expiry}`);
}

// GET /api/referral/teacher-count/:email
router.get('/referral/teacher-count/:email', async (req, res) => {
  const teacherEmail = req.params.email;
  try {
    const query = 'SELECT referral_count FROM users WHERE email = ? ALLOW FILTERING';
    const result = await client.execute(query, [teacherEmail], { prepare: true });
    if (result.rows.length === 0) {
      return res.json({ success: true, referralCount: 0 });
    }
    const referralCount = result.rows[0].referral_count || 0;
    res.json({ success: true, referralCount });
  } catch (err) {
    console.error('Error fetching referral count:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/referral/info
router.get('/referral/info', verifyToken, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const userRole = req.user.role;
        
        // 1. Get user details from users table
        const userQuery = `SELECT id, name, referral_code, referral_count FROM users WHERE email = ? ALLOW FILTERING`;
        const userResult = await client.execute(userQuery, [userEmail], { prepare: true });
        if (userResult.rowLength === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const user = userResult.rows[0];
        const userId = user.id;
        const teacherName = user.name;
        let referralCode = user.referral_code;
        let referralCount = user.referral_count || 0;
        
        // Generate referral code if missing
        if (!referralCode) {
            referralCode = generateReferralCode(userId);
            await client.execute(
                `UPDATE users SET referral_code = ? WHERE id = ?`,
                [referralCode, userId],
                { prepare: true }
            );
        }
        
        // 2. Only teachers get subscription benefits
        let isSpotlightActive = false;
        let subscriptionExpiry = null;
        
        if (userRole === 'teacher') {
            // Fetch teacher's current spotlight status and expiry
            const teacherQuery = `SELECT isspotlight, subscription_expiry FROM teachers1 WHERE email = ? ALLOW FILTERING`;
            const teacherRes = await client.execute(teacherQuery, [userEmail], { prepare: true });
            if (teacherRes.rowLength > 0) {
                const teacher = teacherRes.rows[0];
                const expiry = teacher.subscription_expiry ? new Date(teacher.subscription_expiry) : null;
                const now = new Date();
                isSpotlightActive = teacher.isspotlight === true && (!expiry || expiry > now);
                subscriptionExpiry = expiry ? expiry.toISOString() : null;
            }
            
            // 3. Check if any new milestone reached and not already active (or expired)
            // Find the highest milestone reached
            let highestMilestone = null;
            for (let i = MILESTONES.length - 1; i >= 0; i--) {
                if (referralCount >= MILESTONES[i].count) {
                    highestMilestone = MILESTONES[i];
                    break;
                }
            }
            
            // Activate if milestone reached and no active subscription (or expired)
            if (highestMilestone && !isSpotlightActive) {
                await activateSpotlight(userEmail, teacherName, highestMilestone.months);
                // Refetch updated data
                const updated = await client.execute(teacherQuery, [userEmail], { prepare: true });
                if (updated.rowLength > 0) {
                    const updatedTeacher = updated.rows[0];
                    const newExpiry = updatedTeacher.subscription_expiry ? new Date(updatedTeacher.subscription_expiry) : null;
                    isSpotlightActive = updatedTeacher.isspotlight === true && (!newExpiry || newExpiry > new Date());
                    subscriptionExpiry = newExpiry ? newExpiry.toISOString() : null;
                }
            }
        }
        
        // Prepare milestone data for frontend display (with achieved flags)
        const milestones = MILESTONES.map(m => ({
            target: m.count,
            reward: `${m.months} months free subscription`,
            achieved: referralCount >= m.count
        }));
        
        res.json({
            success: true,
            referralCode,
            referralCount,
            milestones,
            isSpotlightActive,
            subscriptionExpiry
        });
    } catch (error) {
        console.error('❌ Error fetching referral info:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;