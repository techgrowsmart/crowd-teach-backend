const express = require("express");
const router = express.Router();
const verifyToken = require("./../utils/verifyToken");
const { normalizeEmail, getBlockState, getBlockedEmails, blockUser, unblockUser } = require("../services/blockService");

// Tell both users (all their devices) that a block changed, so open chats update live
function emitBlockChange(blockerEmail, blockedEmail, blocked) {
    try {
        const { getIO } = require('../socket');
        const io = getIO();
        const payload = { blockerEmail, blockedEmail, blocked };
        io.to(`user:${blockerEmail}`).emit('block_status_changed', payload);
        io.to(`user:${blockedEmail}`).emit('block_status_changed', payload);
    } catch (socketError) {
        console.warn('⚠️ Block status WebSocket emit failed:', socketError.message);
    }
}

// GET /api/blocks/status/:contactEmail - Block state between current user and a contact
router.get('/status/:contactEmail', verifyToken, async (req, res) => {
    try {
        const currentUserEmail = req.user?.email;
        const { contactEmail } = req.params;

        if (!currentUserEmail || !contactEmail) {
            return res.status(400).json({ success: false, error: "User and contact email required" });
        }

        const state = await getBlockState(currentUserEmail, contactEmail);
        return res.json({ success: true, ...state });
    } catch (error) {
        console.error("❌ Error fetching block status:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch block status" });
    }
});

// GET /api/blocks/list - Emails of everyone the current user has blocked
router.get('/list', verifyToken, async (req, res) => {
    try {
        const currentUserEmail = req.user?.email;

        if (!currentUserEmail) {
            return res.status(400).json({ success: false, error: "User email required" });
        }

        const blockedEmails = await getBlockedEmails(currentUserEmail);
        return res.json({ success: true, blockedEmails });
    } catch (error) {
        console.error("❌ Error fetching blocked users:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch blocked users" });
    }
});

// Shared handler: the block row is always keyed by the authenticated user as blocker,
// so a user can only create or remove their own block
const setBlocked = (blocked) => async (req, res) => {
    try {
        const currentUserEmail = req.user?.email;
        const { contactEmail } = req.body;

        if (!currentUserEmail || !contactEmail) {
            return res.status(400).json({ success: false, error: "User and contact email required" });
        }

        if (normalizeEmail(currentUserEmail) === normalizeEmail(contactEmail)) {
            return res.status(400).json({ success: false, error: "You cannot block yourself" });
        }

        if (blocked) {
            await blockUser(currentUserEmail, contactEmail);
        } else {
            await unblockUser(currentUserEmail, contactEmail);
        }

        emitBlockChange(currentUserEmail, contactEmail, blocked);

        const state = await getBlockState(currentUserEmail, contactEmail);
        console.log(`🚫 ${currentUserEmail} ${blocked ? 'blocked' : 'unblocked'} ${contactEmail}`);
        return res.json({ success: true, ...state });
    } catch (error) {
        console.error(`❌ Error ${blocked ? 'blocking' : 'unblocking'} user:`, error);
        return res.status(500).json({ success: false, error: `Failed to ${blocked ? 'block' : 'unblock'} user` });
    }
};

// POST /api/blocks/block - Block a contact
router.post('/block', verifyToken, setBlocked(true));

// POST /api/blocks/unblock - Remove the current user's own block on a contact
router.post('/unblock', verifyToken, setBlocked(false));

module.exports = router;
