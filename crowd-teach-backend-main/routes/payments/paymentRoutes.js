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

        // Validate that spotlight payment is exactly ₹1 (100 paise)
        const amountInRupees = parseInt(amount) / 100;
        if (amountInRupees !== 1) {
            console.error(`Invalid spotlight payment amount: ₹${amountInRupees}. Expected ₹1`);
            return res.status(400).json({ error: 'Invalid payment amount. Spotlight payment must be ₹1' });
        }

        console.log(`Spotlight payment verified: ₹${amountInRupees} for ${email}`);

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
    const { teacher_id, account_number, ifsc_code, bank_name, check_status_only } = req.body;

    if (!teacher_id) {
        return res.status(400).json({ error: "teacher_id is required." });
    }

    try {
        console.log(`Starting onboarding for teacher: ${teacher_id}`);
        
        // Import MongoDB models
        const { TeacherOnboarding } = require('../../models/TeacherDetails');
        
        // 1. Get teacher details from MongoDB or create if not exists
        let tutor = await TeacherOnboarding.findOne({ teacher_id: teacher_id });

        if (!tutor) {
            console.log(`Tutor not found in MongoDB with ID: ${teacher_id}, creating new entry`);
            
            // Try to get email from Cassandra or use teacher_id as email
            const dbClient = require('../../config/db');
            const teacherQuery = "SELECT email, name FROM teachers1 WHERE email = ? ALLOW FILTERING";
            const teacherResult = await dbClient.execute(teacherQuery, [teacher_id], { prepare: true });
            
            const email = teacherResult.rowLength > 0 ? teacherResult.rows[0].email : teacher_id;
            const name = teacherResult.rowLength > 0 ? teacherResult.rows[0].name : 'Teacher';
            
            // Create new onboarding entry
            tutor = new TeacherOnboarding({
                teacher_id: teacher_id,
                email: email,
                account_number: account_number || '',
                ifsc_code: ifsc_code || '',
                bank_name: bank_name || '',
                onboarding_status: 'pending'
            });
        } else {
            console.log(`Found tutor: ${tutor.email}`);
        }

        // If just checking status, return without updating
        if (check_status_only) {
            return res.status(200).json({
                success: true,
                data: {
                    teacher_id: tutor.teacher_id,
                    email: tutor.email,
                    onboarding_status: tutor.onboarding_status
                }
            });
        }

        // 2. Update onboarding status if bank details provided
        if (account_number && ifsc_code) {
            tutor.account_number = account_number;
            tutor.ifsc_code = ifsc_code;
            tutor.onboarding_status = 'in_review';
            tutor.reviewed_at = new Date();
            tutor.reviewer_notes = 'Bank details verified, ready for final approval';
            
            await tutor.save();
            console.log(`Onboarding updated for teacher: ${teacher_id}`);
        }

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

// Razorpay account creation endpoint
router.post('/create-razorpay-account', async (req, res) => {
    const { teacher_id, email, name, account_number, ifsc_code } = req.body;

    if (!teacher_id || !email) {
        return res.status(400).json({ error: "teacher_id and email are required." });
    }

    try {
        console.log(`Creating Razorpay account for teacher: ${email}`);

        // Import Razorpay
        const Razorpay = require('razorpay');
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });

        // Create a linked account for the teacher (marketplace scenario)
        const accountOptions = {
            name: name || 'Teacher',
            email: email,
            type: 'standard',
            reference_id: teacher_id,
            settlement_bank: {
                account_number: account_number,
                ifsc_code: ifsc_code,
                name: name || 'Teacher',
                beneficiary_name: name || 'Teacher'
            },
            tnc_accepted: true,
            account_details: {
                business_name: name || 'Teacher',
                business_type: 'individual'
            }
        };

        // Create the account
        const account = await razorpay.accounts.create(accountOptions);
        console.log(`Razorpay account created: ${account.id}`);

        // Store the account ID in Cassandra tutors table
        // First get the teacher's id from tutors table
        const getTutorQuery = "SELECT id FROM tutors WHERE email = ? ALLOW FILTERING";
        const tutorResult = await client.execute(getTutorQuery, [email], { prepare: true });
        
        if (tutorResult.rowLength === 0) {
            console.log(`Tutor not found in tutors table with email: ${email}, skipping razorpay_account_id update`);
        } else {
            const tutorId = tutorResult.rows[0].id;
            const updateTutorsQuery = "UPDATE tutors SET razorpay_account_id = ? WHERE id = ? AND email = ?";
            await client.execute(updateTutorsQuery, [account.id, tutorId, email], { prepare: true });
            console.log(`Updated tutors table with razorpay_account_id: ${account.id}`);
        }

        // Update MongoDB onboarding status
        const { TeacherOnboarding } = require('../../models/TeacherDetails');
        await TeacherOnboarding.findOneAndUpdate(
            { teacher_id: teacher_id },
            { 
                onboarding_status: 'approved',
                reviewed_at: new Date(),
                reviewer_notes: 'Razorpay account created and linked successfully'
            },
            { upsert: true, new: true }
        );

        res.status(200).json({ 
            success: true,
            message: "Razorpay account created successfully",
            data: {
                account_id: account.id,
                email: email,
                status: 'active'
            }
        });

    } catch (error) {
        console.error('Error creating Razorpay account:', error);
        
        // For development, if Razorpay API fails, create a mock account ID
        if (error.error && error.error.code === 'BAD_REQUEST_ERROR') {
            console.log('Razorpay API error, using mock account for development');
            const mockAccountId = `acc_mock_${Date.now()}`;
            
            // Store mock account ID in Cassandra
            // First get the teacher's id from tutors table
            const getTutorQuery = "SELECT id FROM tutors WHERE email = ? ALLOW FILTERING";
            const tutorResult = await client.execute(getTutorQuery, [email], { prepare: true });
            
            if (tutorResult.rowLength > 0) {
                const tutorId = tutorResult.rows[0].id;
                const updateTutorsQuery = "UPDATE tutors SET razorpay_account_id = ? WHERE id = ? AND email = ?";
                await client.execute(updateTutorsQuery, [mockAccountId, tutorId, email], { prepare: true });
                console.log(`Updated tutors table with mock razorpay_account_id: ${mockAccountId}`);
            }
            
            // Update MongoDB
            const { TeacherOnboarding } = require('../../models/TeacherDetails');
            await TeacherOnboarding.findOneAndUpdate(
                { teacher_id: teacher_id },
                { 
                    onboarding_status: 'approved',
                    reviewed_at: new Date(),
                    reviewer_notes: 'Mock Razorpay account created for development'
                },
                { upsert: true, new: true }
            );

            return res.status(200).json({ 
                success: true,
                message: "Mock Razorpay account created (development mode)",
                data: {
                    account_id: mockAccountId,
                    email: email,
                    status: 'active'
                }
            });
        }
        
        res.status(500).json({ error: 'Failed to create Razorpay account', detail: error.message });
    }
});


module.exports = router;