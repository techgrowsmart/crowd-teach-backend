const express = require("express");
const router = express.Router();
const cassandra = require("cassandra-driver");
const { v4: uuidv4 } = require("uuid");
const verifyToken = require("../utils/verifyToken");
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']);
const credentials = {
  username: process.env.ASTRA_DB_USERNAME,
  password: process.env.ASTRA_DB_PASSWORD
};
const client = new cassandra.Client({ 
  keyspace: process.env.ASTRA_DB_KEYSPACE, 
  cloud, 
  authProvider,  
  credentials
});

// Create user subscriptions table with validity dates
const createUserSubscriptionsTable = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        subscription_id UUID PRIMARY KEY,
        user_email TEXT,
        plan_title TEXT,
        amount_paid DECIMAL,
        payment_status TEXT,
        subscription_status TEXT,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        validity_date TIMESTAMP,
        created_at TIMESTAMP
      )
    `);
    
    await client.execute(`CREATE INDEX IF NOT EXISTS ON user_subscriptions(user_email)`);
    console.log("✅ User subscriptions table created successfully");
  } catch (error) {
    console.error("❌ Error creating user subscriptions table:", error.message);
  }
};

createUserSubscriptionsTable();

// Create Razorpay order
router.post("/create-order", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// Create subscription after payment verification
router.post("/create-subscription", verifyToken, async (req, res) => {
  try {
    const { plan_title, amount, payment_id, order_id, signature } = req.body;
    const user_email = req.user.email;
    
    if (!plan_title || !amount || !payment_id || !order_id || !signature) {
      return res.status(400).json({ 
        success: false, 
        message: "All payment details are required" 
      });
    }

    // Verify the payment signature
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(order_id + "|" + payment_id)
      .digest('hex');

    if (generated_signature !== signature) {
      return res.status(400).json({ 
        success: false, 
        message: "Payment verification failed" 
      });
    }

    const startDate = new Date();
    const endDate = new Date();
    
    // Set validity based on plan
    if (plan_title === "TeachLite") {
      endDate.setDate(startDate.getDate() + 90);
    } else if (plan_title === "TeachStart") {
      endDate.setDate(startDate.getDate() + 180);
    } else if (plan_title === "GuruGrade") {
      endDate.setDate(startDate.getDate() + 365);
    } else {
      endDate.setDate(startDate.getDate() + 30); // Default 30 days
    }

    const subscriptionId = uuidv4();
    
    const query = `
      INSERT INTO user_subscriptions (
        subscription_id, user_email, plan_title, amount_paid,
        payment_status, subscription_status, start_date, end_date, validity_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await client.execute(query, [
      subscriptionId,
      user_email,
      plan_title,
      parseFloat(amount),
      'completed',
      'active',
      startDate,
      endDate,
      endDate,
      new Date()
    ], { prepare: true });
    
    res.status(200).json({
      success: true,
      message: "Subscription activated successfully",
      subscription_id: subscriptionId,
      validity_date: endDate
    });
    
  } catch (error) {
    console.error("❌ Error creating subscription:", error);
    res.status(500).json({ success: false, message: "Failed to create subscription" });
  }
});

// Check user's active subscription
router.get("/check-subscription", verifyToken, async (req, res) => {
  try {
    const user_email = req.user.email;
    const currentDate = new Date();
    
    const query = `SELECT * FROM user_subscriptions WHERE user_email = ? AND validity_date >= ? AND subscription_status = ? ALLOW FILTERING`;
    
    const result = await client.execute(query, [user_email, currentDate, 'active'], { prepare: true });
    
    const hasActiveSubscription = result.rowLength > 0;
    const subscription = hasActiveSubscription ? result.rows[0] : null;
    
    res.status(200).json({
      success: true,
      has_active_subscription: hasActiveSubscription,
      subscription: subscription
    });
    
  } catch (error) {
    console.error("❌ Error checking subscription:", error);
    res.status(500).json({ success: false, message: "Failed to check subscription" });
  }
});

// Simple subscription verification middleware
const verifySubscription = async (req, res, next) => {
  try {
    const user_email = req.user?.email;
    
    if (!user_email) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }

    const currentDate = new Date();
    
    const query = `SELECT * FROM user_subscriptions WHERE user_email = ? AND validity_date >= ? AND subscription_status = ? ALLOW FILTERING`;
    
    const result = await client.execute(query, [user_email, currentDate, 'active'], { prepare: true });
    
    if (result.rowLength === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED"
      });
    }

    next();
  } catch (error) {
    console.error("❌ Error verifying subscription:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to verify subscription" 
    });
  }
};

module.exports = router;