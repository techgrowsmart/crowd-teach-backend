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
        
        // 1. Get teacher details
        const getQuery = "SELECT id, full_name, email, phone_number, residentialaddress, state, country FROM tutors WHERE id = ?";
        const result = await client.execute(getQuery, [teacher_id], { prepare: true });

        if (result.rowLength === 0) {
            console.error(`Tutor not found with ID: ${teacher_id}`);
            return res.status(404).json({ error: "Tutor not found" });
        }

        const tutor = result.rows[0];
        console.log(`Found tutor: ${tutor.email}`);

        let { full_name, email, phone_number, residentialaddress, state, country } = tutor;

        // 2. Get PAN and pincode from bank details
        const getPanAndPincode = "SELECT pan, pincode FROM bank_details WHERE email = ? ALLOW FILTERING";
        const resultPan = await client.execute(getPanAndPincode, [email], { prepare: true });
        
        console.log("Bank details query result:", {
            rowCount: resultPan.rowLength,
            emailUsed: email
        });

        if (resultPan.rowLength === 0) {
            console.error(`No bank details found for email: ${email}`);
            return res.status(404).json({ error: "Tutor PAN/Pincode not found" });
        }

        const pan = resultPan.rows[0].pan;
        const pincode = resultPan.rows[0].pincode;
        console.log(`Retrieved PAN: ${pan}, Pincode: ${pincode}`);

        // 3. Create Razorpay account
        const data = {
            email,
            phone: phone_number,
            legal_business_name: `${full_name} Class`,
            business_type: "individual",
            customer_facing_business_name: `${full_name} Tuition`,
            contact_name: full_name,
            type: "route",
            profile: {
                category: "education",
                subcategory: "coaching",
                addresses: {
                    registered: {
                        street1: residentialaddress,
                        street2: residentialaddress,
                        city: "Default",
                        state: state,
                        postal_code: String(pincode).trim(),
                        country: "IN"
                    }
                },
            }
        };

        console.log("Creating Razorpay account with data:", JSON.stringify(data, null, 2));
        
        const accountResponse = await axios.post(
            "https://api.razorpay.com/v2/accounts",
            data,
            {
                auth: {
                    username: process.env.RAZORPAY_KEY_ID,
                    password: process.env.RAZORPAY_KEY_SECRET,
                }
            }
        ).catch(error => {
            console.error("Error creating Razorpay account:", error.response?.data || error.message);
            throw error;
        });

        const linked_account_id = accountResponse.data.id;
        console.log(`Razorpay account created with ID: ${linked_account_id}`);

        // 4. Create stakeholder
        const stakeholderResponse = await axios.post(
            `https://api.razorpay.com/v2/accounts/${linked_account_id}/stakeholders`,
            {
                name: full_name,
                email,
                phone: { primary: phone_number },
                relationship: { director: true, executive: true },
                addresses: {
                    residential: {
                        street: residentialaddress,
                        city: "Default",
                        state: state,
                        postal_code: String(pincode).trim(),
                        country: "IN"
                    }
                },
                kyc: { pan: pan }
            },
            {
                auth: {
                    username: process.env.RAZORPAY_KEY_ID,
                    password: process.env.RAZORPAY_KEY_SECRET,
                }
            }
        ).catch(error => {
            console.error("Error creating stakeholder:", error.response?.data || error.message);
            throw error;
        });

        const stakeholder_id = stakeholderResponse.data.id;
        console.log(`Stakeholder created with ID: ${stakeholder_id}`);

        // 5. Create product
        const product = await axios.post(
            `https://api.razorpay.com/v2/accounts/${linked_account_id}/products`,
            { product_name: "route", tnc_accepted: true },
            {
                auth: {
                    username: process.env.RAZORPAY_KEY_ID,
                    password: process.env.RAZORPAY_KEY_SECRET,
                }
            }
        ).catch(error => {
            console.error("Error creating product:", error.response?.data || error.message);
            throw error;
        });

        const productId = product.data.id;
        console.log(`Product created with ID: ${productId}`);

        // 6. Configure settlements
        await axios.patch(
            `https://api.razorpay.com/v2/accounts/${linked_account_id}/products/${productId}`,
            {
                settlements: {
                    beneficiary_name: full_name,
                    ifsc_code,
                    account_number,
                }
            },
            {
                auth: {
                    username: process.env.RAZORPAY_KEY_ID,
                    password: process.env.RAZORPAY_KEY_SECRET,
                }
            }
        ).catch(error => {
            console.error("Error configuring settlements:", error.response?.data || error.message);
            throw error;
        });

        // 7. Update tutor with Razorpay account ID
        console.log(`Updating tutor ${teacher_id} with Razorpay ID: ${linked_account_id}`);
        
        // First, try to update with both ID and email
        let updateQuery = "UPDATE tutors SET razorpay_account_id = ? WHERE id = ? AND email = ?";
        let updateResult = await client.execute(updateQuery, [linked_account_id, teacher_id, email], { prepare: true })
            .catch(error => {
                console.error("Error updating with email:", error.message);
                return null;
            });

        // If update with email failed, try with just ID
        if (!updateResult || updateResult.rowLength === 0) {
            console.log("Update with email failed, trying with ID only");
            updateQuery = "UPDATE tutors SET razorpay_account_id = ? WHERE id = ?";
            updateResult = await client.execute(updateQuery, [linked_account_id, teacher_id], { prepare: true })
                .catch(error => {
                    console.error("Error updating with ID only:", error.message);
                    throw new Error("Failed to update tutor record");
                });
        }

        console.log("Update result:", {
            wasApplied: updateResult.wasApplied(),
            rowLength: updateResult.rowLength
        });

        if (!updateResult.wasApplied()) {
            throw new Error("Failed to update tutor record - update was not applied");
        }

        console.log(`Successfully updated tutor ${teacher_id} with Razorpay ID`);

        res.status(200).json({
            message: "Your details submitted successfully. Wait until your application is approved.",
            account_id: linked_account_id,
            stakeholder_id
        });

    } catch (error) {
        console.error("Onboarding failed:", {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(500).json({ 
            error: "Onboarding failed", 
            detail: error.response?.data || error.message 
        });
    }
});


module.exports = router;