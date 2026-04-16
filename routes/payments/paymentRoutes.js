const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment } = require('../../services/razorpayService');
const client = require('../../config/db');
const axios = require('axios')
const cassandra= require('cassandra-driver')



const razorpayAuth = {
    username: process.env.RAZORPAY_KEY_ID,
    password: process.env.RAZORPAY_KEY_SECRET,
};

// Create Razorpay order
router.post('/create-order', async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || isNaN(amount) || amount < 1) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const order = await createOrder(amount);
        console.log("ORDER",order)
        res.json(order);
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

//Verify payment for spotlight
router.post('/verify-payment-spotlight',async (req,res)=>{
    try {
        const transaction_id = cassandra.types.TimeUuid.now()
        const {
            orderId,
            paymentId,
            signature,
            email,
            name,
            amount,
        } = req.body;


        if (!orderId || !paymentId || !signature || !email || !amount || !name) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log("Signature",signature)
        // Verify payment signature
        const isValid = verifyPayment(orderId, paymentId, signature);
        console.log("Valid",isValid)
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        //update isspotlight true

        const updatequerry =`
            UPDATE teachers1
            SET isspotlight =true
            WHERE name= ? AND email = ?
        `

        await client.execute(updatequerry,[name,email],{prepare:true})

        res.json({ success: true, message: "Spotlight activated successfully." });


    }catch (err){
        console.error('Error verifying payment:', err);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
})

router.post('/verify-payment', async (req, res) => {
    try {
        const transaction_id = cassandra.types.TimeUuid.now();
        const {
            orderId,
            paymentId,
            signature,
            email,
            amount,
            teacher_email
        } = req.body;

        if (!orderId || !paymentId || !signature || !email || !amount || !teacher_email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const isValid = verifyPayment(orderId, paymentId, signature);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }


        const updateQuery = `
      UPDATE student_wallets SET balance = balance + ? WHERE email = ?
    `;
        await client.execute(updateQuery, [parseInt(amount) / 100, email], { prepare: true });

        const transactionQuery = `
      INSERT INTO wallet_transactions (email, transaction_id, amount, type, order_id, payment_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, toTimestamp(now()))
    `;
        await client.execute(
            transactionQuery,
            [email, transaction_id, parseInt(amount) / 100, 'credit', orderId, paymentId],
            { prepare: true }
        );

        const teacherQuery = `SELECT razorpay_account_id FROM tutors WHERE email = ? ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, [teacher_email], { prepare: true });

        if (teacherResult.rowLength === 0) {
            return res.status(404).json({ error: "Teacher not found or not onboarded with Razorpay" });
        }

        const linked_account_id = teacherResult.rows[0].razorpay_account_id;
        console.log("Acc",linked_account_id)
        const transferAmount = parseInt(amount);
        const transferPayload = {
            transfers: [
                {
                    account: linked_account_id,
                    amount: transferAmount,
                    currency: "INR",
                    notes: {
                        purpose: "Tuition class payment"
                    },
                    on_hold: false
                }
            ]
        };
        console.log("Transfer payload",transferPayload)

        const transferResponse = await axios.post(
            `https://api.razorpay.com/v1/payments/${paymentId}/transfers`,
            transferPayload,
            { auth: razorpayAuth }
        );

        console.log("Transfer success:", transferResponse.data);

        res.json({ success: true, message: 'Payment verified, wallet updated, and funds transferred' });

    } catch (error) {
        console.error('Error verifying payment or transferring:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to verify or transfer', detail: error.response?.data });
    }
});


router.post("/onboardTeacher", async (req, res) => {
    const { teacher_id, account_number, ifsc_code } = req.body;

    if (!teacher_id || !account_number || !ifsc_code) {
        return res.status(400).json({ error: "All fields are required." });
    }

    try {
        console.log(`Starting onboarding for teacher: ${teacher_id}`);
        
        // Import MongoDB models
        const { TeacherOnboarding } = require('../../models/TeacherDetails');
        
        // 1. Get teacher details
        const tutor = await TeacherOnboarding.findOne({ teacher_id: teacher_id });

        if (!tutor) {
            console.error(`Tutor not found with ID: ${teacher_id}`);
            return res.status(404).json({ error: "Tutor not found" });
        }

        console.log(`Found tutor: ${tutor.email}`);

        // 2. Update onboarding status
        tutor.onboarding_status = 'in_review';
        tutor.account_number = account_number;
        tutor.ifsc_code = ifsc_code;
        tutor.reviewed_at = new Date();
        tutor.reviewer_notes = 'Bank details verified, ready for final approval';
        
        await tutor.save();

        console.log(`Onboarding updated for teacher: ${teacher_id}`);

        res.status(200).json({ 
            success: true,
            message: "Teacher onboarded successfully",
            data: {
                teacher_id: tutor.teacher_id,
                email: tutor.email,
                onboarding_status: tutor.onboarding_status
            }
        });

    } catch (error) {
        console.error('Error during teacher onboarding:', error);
        res.status(500).json({ error: 'Failed to onboard teacher', detail: error.message });
    }
});

// Razorpay account creation endpoint - simplified placeholder
router.post('/create-razorpay-account', async (req, res) => {
    res.status(200).json({ message: "Razorpay account creation endpoint" });
});


module.exports = router;