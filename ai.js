const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGenAI() {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// 1. KULLANICI PROFILI VE EN GÜNCEL TAHLİLLERİ BİRLEŞTİREN FONKSİYON
async function getProfileContext(db, userId) {
    try {
        // En güncel lab sonucunu lab_results tablosundan alıp profile ile birleştiriyoruz
        const [rows] = await db.query(
            `SELECT u.name, u.surname, p.*, 
                    l.hemoglobin, l.glucose, l.cholesterol, l.vitamin_d
             FROM users u 
             JOIN profiles p ON u.id = p.user_id 
             LEFT JOIN (
                SELECT * FROM lab_results 
                WHERE user_id = ? 
                ORDER BY log_date DESC LIMIT 1
             ) l ON u.id = l.user_id
             WHERE u.id = ?`,
            [userId, userId]
        );

        if (rows.length === 0) return 'No profile found.';
        const p = rows[0];

        // AI'nın tüm opsiyonlarını ve tahlillerini metne döküyoruz
        return `
        User: ${p.name} ${p.surname}, Age: ${p.age}, Gender: ${p.gender}, Weight: ${p.weight}kg, Goal: ${p.goal}kg.
        STRICT DIET TYPE: ${p.diet_type || 'none'}
        Allergies: ${p.allergies || 'none'}, Dislikes: ${p.dislikes || 'none'}.
        Latest Lab Results: Hemoglobin=${p.hemoglobin || 'N/A'}, Glucose=${p.glucose || 'N/A'}, Cholesterol=${p.cholesterol || 'N/A'}, Vitamin D=${p.vitamin_d || 'N/A'}.
        `.replace(/\s+/g, ' ').trim();
    } catch (err) {
        console.error('Context Error:', err);
        return 'Profile access error.';
    }
}

// 2. AI DIET PLAN (DİYET PLANI OLUŞTURMA)
router.post('/diet-plan', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const profileContext = await getProfileContext(db, req.userId);
        const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        User Context: ${profileContext}

        STRICT DIETARY RULES BASED ON SELECTION:
        - vegetarian: NO meat, NO chicken, NO fish. Eggs/Dairy OK.
        - vegan: NO animal products at all.
        - keto: Very low carb, high fat. No bread/sugar.
        - glutenfree: No wheat/barley/rye.
        - highprotein: Focus on lean protein in every meal.

        TASK: Create a 1-day diet plan (breakfast, lunch, dinner) including calories.
        STRICT: If user is vegetarian, DO NOT suggest chicken or meat.
        
        Return ONLY valid JSON:
        {
          "breakfast": "Meal Name (Portion)", "breakfast_calories": 350,
          "lunch": "Meal Name (Portion)", "lunch_calories": 500,
          "dinner": "Meal Name (Portion)", "dinner_calories": 450
        }`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json\n?|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. AI RECIPES (TARİF ÜRETME)
router.post('/generate-recipes', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const profileContext = await getProfileContext(db, req.userId);
        const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        User Health Context: ${profileContext}
        TASK: Create 2 healthy recipes for Breakfast, Lunch, Dinner, and Snack.
        RULE: If Diet Type is "vegetarian", YOU ARE FORBIDDEN FROM USING MEAT/CHICKEN/FISH.
        Return ONLY valid JSON format with title, description, calories, macros, time, and instructions.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json\n?|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. AI CHAT (SOHBET)
router.post('/chat', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;
        const profileContext = await getProfileContext(db, req.userId);
        const [history] = await db.query('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 6', [req.userId]);
        history.reverse();

        const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash" });
        const systemPrompt = `You are VitAI Diet Coach. User Profile: ${profileContext}. 
        Warn user if Glucose > 100 or Hemoglobin is abnormal. Be supportive and concise.`;

        let chatHistory = history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] }));
        const chat = model.startChat({ history: chatHistory, systemInstruction: { parts: [{ text: systemPrompt }] } });
        const result = await chat.sendMessage(message);
        const aiResponse = result.response.text();

        await db.query('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?), (?, ?, ?)', [req.userId, 'user', message, req.userId, 'assistant', aiResponse]);
        res.json({ response: aiResponse });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. FOOD IMAGE ANALYSIS (FOTOĞRAF ANALİZİ)
router.post('/analyze-food', auth, async (req, res) => {
    try {
        const { image } = req.body;
        const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-flash' });
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const prompt = `Analyze this food image. Return JSON: { "name": "", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "healthRating": 0, "advice": "" }`;
        const result = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }]);
        res.json(JSON.parse(result.response.text().replace(/```json\n?|```/g, '').trim()));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;