const Razorpay = require('razorpay');
const crypto = require('crypto');


const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create a new order
const createOrder = async (amount, currency = 'INR') => {
    try {
        const options = {
            amount: amount ,
            currency,
            payment_capture: 1,
            receipt: `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        throw new Error('Failed to create payment order');
    }
};

// Verify payment signature
const verifyPayment = (orderId, paymentId, signature) => {
    try {
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');

        console.log("Signature",generatedSignature)
        return generatedSignature === signature;
    } catch (error) {
        console.error('Error verifying payment:', error);
        return false;
    }
};

module.exports = {
    createOrder,
    verifyPayment
};