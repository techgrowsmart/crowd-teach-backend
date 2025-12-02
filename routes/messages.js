const express = require("express");
const router = express.Router();

const verifyToken = require("./../utils/verifyToken")
const { db, admin } = require("./../config/firebase");
const { v1: uuidv1 } = require('uuid');
const axios = require("axios");
const client = require("../config/db");

const sendExpoPushNotification = async (to, title, body) => {
    try {
        const message = {
            to,
            sound: "default",
            title,
            body,
        };

        await axios.post("https://exp.host/--/api/v2/push/send", message, {
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        console.error("Failed to send push notification:", err?.response?.data || err.message);
    }
};

router.post("/send",verifyToken, async (req, res) => {
    const { sender, recipient,senderName, text } = req.body;
    console.log("SENDER,RECIPIENT:",sender,recipient,text)
    if (!sender || !recipient || !text) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const chatId = [sender, recipient].sort().join("_");
    const messageData = {
        sender,
        recipient,
        text,
        timestamp: admin.firestore.Timestamp.now(),
        ...(senderName && { senderName })
    };

    try {
        await db.collection("chats").doc(chatId).collection("messages").add(messageData);
        // Get recipient push token
        const recipientDoc = await db.collection("pushTokens").doc(recipient).get();
        const pushToken = recipientDoc.exists ? recipientDoc.data().token : null;

        if (pushToken) {
            await sendExpoPushNotification(
                pushToken,
                "New Message",
                `${senderName} sent: ${text}`
            );
        }
        return res.status(200).json({ message: "Message sent successfully" });
    } catch (error) {
        console.error("Error sending message to Firebase:", error);
        return res.status(500).json({ message: "Failed to send message" });
    }
})


router.post("/save-token", async (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) {
        return res.status(400).json({ error: "Missing email or token" });
    }

    await db.collection("pushTokens").doc(email).set({ token });
    res.send({ success: true });
});


router.post("/broadcast", verifyToken, async (req, res) => {
    const {
        broadcastData,
        userEmail,
        classInfo,
        students
    } = req.body;

    if (!broadcastData || !userEmail || !classInfo || !Array.isArray(students)) {
        return res.status(400).json({ error: "Missing required data" });
    }

    try {

        const broadcastRef = await db.collection("broadcasts").add({
            ...broadcastData,
            teacherEmail: userEmail,
            ...classInfo,
            status: "processing",
            studentCount: students.length,
            timestamp: admin.firestore.Timestamp.now()
        });

        const batch = db.batch();


        const messageContent = `📢 Broadcast: ${broadcastData.topic}\nDate: ${broadcastData.date}\nTime: ${broadcastData.time}\nLink: ${broadcastData.link}`;


        students.forEach(student => {
            const { studentEmail, studentName, id } = student;

            const chatId = [userEmail, studentEmail].sort().join('_');

            const messageDocRef = db.collection("chats").doc(chatId).collection("messages").doc();
            const broadcastDocRef = db.collection("broadcasts").doc(broadcastRef.id);
            const recipientDocRef = broadcastDocRef.collection("recipients").doc(studentEmail);
            const notificationRef = db.collection("notifications").doc(studentEmail);


            batch.set(messageDocRef, {
                text: messageContent,
                sender: userEmail,
                recipient: studentEmail,
                timestamp: admin.firestore.Timestamp.now(),
                isBroadcast: true
            });

            batch.set(recipientDocRef, {
                studentEmail,
                studentName,
                timestamp: admin.firestore.Timestamp.now(),
            });


            batch.set(notificationRef, {
                type: "broadcast",
                message: messageContent,
                timestamp: admin.firestore.Timestamp.now(),
                broadcastId: broadcastRef.id
            });

            batch.update(broadcastDocRef, {
                status: "sent",
                [`sentTo.${studentEmail}`]: true
            });

            // Send push notification
            (async () => {
                try {
                    const tokenDoc = await db.collection("pushTokens").doc(studentEmail).get();
                    const token = tokenDoc.exists ? tokenDoc.data().token : null;

                    if (token) {
                        await sendExpoPushNotification(
                            token,
                            "📢 Broadcast Message",
                            messageContent.slice(0, 100)
                        );
                    }
                } catch (err) {
                    console.error(`Failed to send push to ${studentEmail}:`, err?.response?.data || err.message);
                }
            })();

        });

        await batch.commit();

        return res.status(200).json({
            message: `Broadcast sent to ${students.length} students!`,
            broadcastId: broadcastRef.id
        });
    } catch (error) {
        console.error("Broadcast backend error:", error);
        return res.status(500).json({ error: "Failed to send broadcast" });
    }
});

router.post("/broadcasts", verifyToken, async (req, res) => {
    try {
        const { userEmail, studentEmail } = req.body;

        let broadcastsQuery = db.collection("broadcasts");


        if (userEmail) {
            broadcastsQuery = broadcastsQuery.where("teacherEmail", "==", userEmail);
        }

        const snapshot = await broadcastsQuery.orderBy("timestamp", "desc").get();

        const broadcasts = [];

        for (const doc of snapshot.docs) {
            const broadcast = { id: doc.id, ...doc.data() };

            if (studentEmail) {
                const recipientSnapshot = await db
                    .collection("broadcasts")
                    .doc(doc.id)
                    .collection("recipients")
                    .where("studentEmail", "==", studentEmail)
                    .get();

                if (recipientSnapshot.empty) continue;
            }


            broadcasts.push(broadcast);
        }
        console.log("123")
        return res.status(200).json({ broadcasts });
    } catch (error) {
        console.error("Error fetching broadcasts:", error);
        return res.status(500).json({ error: "Failed to fetch broadcast messages" });
    }
});



router.post("/get_teacher_broadcast",verifyToken, async (req, res) => {
    const { userEmail, type } = req.body;
    if (type !== 'teacher') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const query = `
        SELECT * FROM broadcast_table WHERE teacheremail = ? ALLOW FILTERING;
      `;
    const results = await client.execute(query, [userEmail], { prepare: true });
    const resultBody = []
    for (const result of results.rows) {
        resultBody.push(JSON.parse(JSON.stringify(result)))
    }
    res.status(200).json({ teacherBroadcastData: resultBody });
})


router.post("/broadcast-message-list",verifyToken, async (req, res) => {
    const { userEmail, userType } = req.body;
    if (userType === 'student') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const query = `
        SELECT * FROM broadcast_messages_table WHERE teacheremail = ? LIMIT 20 ALLOW FILTERING;
      `;
    const results = await client.execute(query, [userEmail], { prepare: true });
    const resultBody = []
    for (const result of results.rows) {
        resultBody.push(JSON.parse(JSON.stringify(result)))
    }
    res.status(200).json({ teacherBroadcastData: resultBody });
})

router.post("/broadcast-message-list-add",verifyToken, async (req, res) => {
    console.log(req.body)

    const {userType,
        teacherEmail,
        className,
        subject,
        studentEmails,
        studentNames,
        isBroadcast,
        sender,
        teacherName,
        text} = req.body;
    if (userType === 'student') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const id = uuidv1(); // timeuuid
    const timestamp = new Date();
    const time = timestamp.toLocaleTimeString();
    const messageContent = `📢 Broadcast: ${text}\nDate: ${new Date().toLocaleDateString()}\nTime: ${time}\n`;
    const query = `
    INSERT INTO broadcast_messages_table 
    (teacherEmail, className, subject, id, studentEmails, studentNames, isBroadcast, sender, teacherName, text, time, timestamp) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
  `;


    const params = [
        teacherEmail,
        className,
        subject,
        id,
        JSON.stringify(studentEmails),
        JSON.stringify(studentNames),
        isBroadcast,
        sender,
        teacherName,
        messageContent,
        time,
        timestamp
    ];

    try {
        await client.execute(query, params, { prepare: true });
        console.log("✅ Broadcast message inserted successfully");


        const broadcastRef = await db.collection("broadcasts").add({
            params,
            teacherEmail,
            className,
            status: "processing",
            studentCount: studentEmails.length,
            timestamp: admin.firestore.Timestamp.now()
        }).catch(err => {console.log(err)});

        const batch = db.batch();

        for (let i=0; i<studentEmails.length; i++) {
            const studentEmail = studentEmails[i];
            const studentName = studentNames[i];

            const chatId = [teacherEmail, studentEmail].sort().join('_');

            const messageDocRef = db.collection("chats").doc(chatId).collection("messages").doc();
            const broadcastDocRef = db.collection("broadcasts").doc(broadcastRef.id);
            const recipientDocRef = broadcastDocRef.collection("recipients").doc(studentEmail);
            const notificationRef = db.collection("notifications").doc(studentEmail);


            batch.set(messageDocRef, {
                text: messageContent,
                sender: teacherEmail,
                recipient: studentEmail,
                timestamp: admin.firestore.Timestamp.now(),
                isBroadcast: true
            });

            batch.set(recipientDocRef, {
                studentEmail,
                studentName,
                timestamp: admin.firestore.Timestamp.now(),
            });


            batch.set(notificationRef, {
                type: "broadcast",
                message: messageContent,
                timestamp: admin.firestore.Timestamp.now(),
                broadcastId: broadcastRef.id
            });

            batch.update(broadcastDocRef, {
                status: "sent",
                [`sentTo.${studentEmail}`]: true
            });

            // Send push notification
            (async () => {
                try {
                    const tokenDoc = await db.collection("pushTokens").doc(studentEmail).get();
                    const token = tokenDoc.exists ? tokenDoc.data().token : null;

                    if (token) {
                        await sendExpoPushNotification(
                            token,
                            "📢 Broadcast Message",
                            messageContent.slice(0, 100)
                        );
                    }
                } catch (err) {
                    console.error(`Failed to send push to ${studentEmail}:`, err?.response?.data || err.message);
                }
            })();

        };
        await batch.commit();
        return res.status(200).json({ type: "success" });
    } catch (err) {
        console.error("❌ Error inserting broadcast message:", err);
    }

    return res.status(500).json({ type: "error", message: "Server error" });
})






module.exports = router;
