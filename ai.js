const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGenAI() {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

async function getProfileContext(db, userId) {
    const [profiles] = await db.query(
        `SELECT u.name, u.surname,
                p.age, p.gender, p.height, p.weight,
                p.hemoglobin, p.glucose, p.cholesterol, p.vitamin_d,
                p.goal, p.activity,
                p.daily_calories_taken, p.daily_calories_required
         FROM users u 
         JOIN profiles p ON u.id = p.user_id 
         WHERE u.id = ?`,
        [userId]
    );

    if (profiles.length === 0) return '';

    const p = profiles[0];

    const age = Number(p.age) || 0;
    const height = Number(p.height) || 0;
    const weight = Number(p.weight) || 0;
    const goal = Number(p.goal) || 0;
    const activity = Number(p.activity) || 1.2;

    const takenCalories = Number(p.daily_calories_taken) || 0;
    const requiredCalories = Number(p.daily_calories_required) || 0;

    let bmi = 'N/A';
    let bmr = 'N/A';
    let tdee = 'N/A';

    if (weight > 0 && height > 0) {
        const heightM = height / 100;
        bmi = (weight / (heightM * heightM)).toFixed(1);
    }

    if (weight > 0 && height > 0 && age > 0) {
        bmr = (p.gender === 'male'
            ? (10 * weight + 6.25 * height - 5 * age + 5)
            : (10 * weight + 6.25 * height - 5 * age - 161)).toFixed(0);

        tdee = (Number(bmr) * activity).toFixed(0);
    }

    return `
User profile:
Name: ${p.name || ''} ${p.surname || ''}
Age: ${age}
Gender: ${p.gender || 'female'}
Height: ${height} cm
Weight: ${weight} kg
Goal: ${goal} kg

Health metrics:
BMI: ${bmi}
BMR: ${bmr} kcal
TDEE: ${tdee} kcal

Daily calories:
Taken: ${takenCalories} kcal
Required: ${requiredCalories} kcal

Lab values:
Hemoglobin: ${p.hemoglobin || 0}
Glucose: ${p.glucose || 0}
Cholesterol: ${p.cholesterol || 0}
Vitamin D: ${p.vitamin_d || 0}
`.replace(/\s+/g, ' ').trim();
}

// AI Chat
router.post('/chat', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Message required' });

        const profileContext = await getProfileContext(db, req.userId);

        const [history] = await db.query(
            'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [req.userId]
        );

        history.reverse();

        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const systemPrompt = `
You are VitAI Diet Coach, a professional AI dietitian.

Rules:
- Always personalize using user's health data
- If glucose > 100 → warn about sugar
- If cholesterol high → suggest low-fat diet
- If vitamin D low → suggest sunlight/foods
- If calories taken > required → warn user
- Be short (2-4 sentences)
- Be supportive

${profileContext}
`.replace(/\s+/g, ' ').trim();

        let chatHistory = history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(h.content || '').trim() }]
        }));

        while (chatHistory.length > 0 && chatHistory[0].role === 'model') {
            chatHistory = chatHistory.slice(1);
        }

        const chat = model.startChat({
            history: chatHistory,
            systemInstruction: { parts: [{ text: systemPrompt }] }
        });

        const result = await chat.sendMessage(message);
        const aiResponse = result.response.text();

        await db.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?), (?, ?, ?)',
            [req.userId, 'user', message, req.userId, 'assistant', aiResponse]
        );

        res.json({ response: aiResponse });

    } catch (err) {
        console.error('AI Chat error:', err);
        res.status(500).json({ error: 'AI service error: ' + err.message });
    }
});