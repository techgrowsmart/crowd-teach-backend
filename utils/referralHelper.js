// utils/referralHelper.js
function generateReferralCode(userId) {
    // userId is a UUID string, e.g., "123e4567-e89b-12d3-a456-426614174000"
    const base = userId.replace(/-/g, '').slice(0, 10).toUpperCase();
    let sum = 0;
    for (let i = 0; i < 8 && i < base.length; i++) {
        sum += base.charCodeAt(i);
    }
    const checksum = sum % 1000;
    return `GS${base}${checksum}`;
}

module.exports = { generateReferralCode };