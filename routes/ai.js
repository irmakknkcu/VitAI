const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGenAI() {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

async function getProfileContext(db, userId) {
    const [profiles] = await db.query(
        `SELECT u.name, u.surname, p.age, p.gender, p.height, p.weight, p.goal, p.activity
         FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.id = ?`,
        [userId]
    );
    if (profiles.length === 0) return '';

    const p = profiles[0];
    const age = Number(p.age) || 0;
    const height = Number(p.height) || 0;
    const weight = Number(p.weight) || 0;
    const goal = Number(p.goal) || 0;
    const activity = Number(p.activity) || 1.2;

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

    return `User profile: ${p.name || ''} ${p.surname || ''}, Age: ${age}, Gender: ${p.gender || 'female'}, ` +
           `Height: ${height}cm, Weight: ${weight}kg, Goal: ${goal}kg, ` +
           `BMI: ${bmi}, BMR: ${bmr} kcal, TDEE: ${tdee} kcal, Activity: ${activity}`;
}

// AI Chat
router.post('/chat', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        const profileContext = await getProfileContext(db, req.userId);

        const [history] = await db.query(
            'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 6',
            [req.userId]
        );
        history.reverse();

        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const systemPrompt = `
You are VitAI Diet Coach, a professional AI dietitian and health coach.
You provide personalized nutrition advice, meal suggestions, and health tips.
Always be encouraging, knowledgeable, and supportive.

CRITICAL RULES:
- ONLY answer the user's LAST question.
- DO NOT repeat previous responses or summarize conversation history.
- Focus exclusively on the current user request.
- Respond in the same language the user writes in.
- Keep responses concise (2-4 sentences) unless the user asks for detailed information.

PERSONALIZATION:
Use the user's profile and latest lab results (hemoglobin, glucose, cholesterol, vitamin D) to tailor advice.
- High glucose → reduce sugar and carbs.
- High cholesterol → reduce fats and fried foods.
- Low hemoglobin → include iron-rich foods.
- Low vitamin D → include vitamin D-rich foods (fish, eggs, dairy).

WEEKLY DIET PLANS:
If the user requests a weekly plan:
- Generate a 7-day plan (Monday to Sunday) with breakfast, lunch, and dinner.
- Include portion sizes for each meal (e.g., 1 bowl, 150g, 1 serving).
- Ensure variety in cuisine and ingredients.
- Do NOT repeat meals from previous plans.

${profileContext}
`.replace(/\s+/g, ' ').trim();

        let chatHistory = history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(h.content || '').trim() }]
        }));

        // Gemini requires the first message in history to be from 'user', not 'model'
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

// Food Image Analysis
router.post('/analyze-food', auth, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: 'Image data required (base64)' });

        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        const prompt = `Analyze this food image and provide:
1. Food name/description
2. Estimated total calories (kcal)
3. Macronutrients breakdown (protein, carbs, fat in grams)
4. Key vitamins/minerals
5. Health rating (1-10)
6. Brief dietary advice

Respond in JSON format:
{
  "name": "food name",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "vitamins": ["list"],
  "healthRating": number,
  "advice": "brief advice"
}`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: base64Data, mimeType } }
        ]);

        let text = result.response.text();
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const parsed = JSON.parse(text);
            res.json(parsed);
        } catch {
            res.json({ raw: text });
        }
    } catch (err) {
        console.error('Food analysis error:', err);
        res.status(500).json({ error: 'AI analysis error: ' + err.message });
    }
});

// Diet Plan Generation
router.post('/diet-plan', auth, async (req, res) => {
    try {
        const { currentPlan } = req.body || {};
        const db = req.app.locals.db;
        const [profiles] = await db.query(
            `SELECT p.age, p.gender, p.height, p.weight FROM profiles p WHERE p.user_id = ?`,
            [req.userId]
        );
        if (profiles.length === 0 || !profiles[0].weight || !profiles[0].height || !profiles[0].age) {
            return res.status(400).json({ error: 'Tam profil bilgisi (Yaş, Boy, Kilo) gereklidir.' });
        }

        const profile = profiles[0];
        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0.8,
                topK: 40,
                topP: 0.95
            }
        });

        const avoidSection = (currentPlan && (currentPlan.breakfast || currentPlan.lunch || currentPlan.dinner))
            ? `\n\nCRITICAL - DO NOT REPEAT: The user already has this plan. You MUST give something COMPLETELY DIFFERENT:\n- Current breakfast: ${currentPlan.breakfast || 'none'}\n- Current lunch: ${currentPlan.lunch || 'none'}\n- Current dinner: ${currentPlan.dinner || 'none'}\n\nAvoid these exact meals and similar combinations. Create a totally new menu.\n`
            : '';

        const promptContext = `User profile: 
Age: ${profile.age}
Gender: ${profile.gender === 'female' ? 'Female' : 'Male'}
Height: ${profile.height} cm
Weight: ${profile.weight} kg
${avoidSection}
The user clicked REFRESH - they want a NEW, DIFFERENT menu. Be creative. Vary the cuisine, ingredients, and meal types.

RULES - MUST FOLLOW:
1. ALWAYS include PORTION for every meal. Write portion in parentheses: (1 bowl), (150g), (1 serving), (2 slices), (4 tbsp).
2. Multiple items: write portion for each. Example: "Oatmeal with berries (1 bowl) + Whole wheat toast (1 slice)" or "Grilled chicken (150g) + Green salad (1 bowl)" or "Lentil soup (1 bowl) + Rice pilaf (4 tbsp)".
3. No preparation details, only meal name and portion.
4. Respond in ENGLISH.

Return ONLY valid JSON:
{
  "breakfast": "Meal name (portion) + ...",
  "lunch": "Meal name (portion) + ...",
  "dinner": "Meal name (portion) + ..."
}`;

        const result = await model.generateContent(promptContext);
        let text = result.response.text();
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const parsed = JSON.parse(text);
            res.json(parsed);
        } catch {
            res.json({
                breakfast: 'AI önerisi yükleniyor...',
                lunch: 'AI önerisi yükleniyor...',
                dinner: 'AI önerisi yükleniyor...'
            });
        }
    } catch (err) {
        console.error('Diet plan error:', err);
        res.status(500).json({ error: 'AI diet plan error: ' + err.message });
    }
});

// Recipe Generation (4 categories, 2 recipes each)
router.post('/generate-recipes', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [profiles] = await db.query(
            `SELECT p.age, p.gender, p.height, p.weight, p.goal, p.activity FROM profiles p WHERE p.user_id = ?`,
            [req.userId]
        );
        if (profiles.length === 0) {
            return res.status(400).json({ error: 'Profil bilgisi gereklidir.' });
        }

        const profile = profiles[0];
        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0.8
            }
        });

        const promptContext = `Kullanıcı profili: 
Yaş: ${profile.age}, Cinsiyet: ${profile.gender === 'female' ? 'Kadın' : 'Erkek'}, 
Boy: ${profile.height} cm, Kilo: ${profile.weight} kg, Hedef kilo: ${profile.goal || '-'} kg, Aktivite: ${profile.activity || 1.2}

Bu kullanıcı için hedefine uygun, sağlıklı ve pratik tarifler oluştur. Her kategoride 2 farklı tarif ver (toplam 8 tarif).
Lütfen her seferinde TAMAMEN FARKLI malzemeler kullanan yepyeni dünya mutfağı veya yerel tarifler üret. Aynı tarifleri tekrar verme.

Kesinlikle JSON formatında döndür:
{
  "breakfast": [
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." },
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." }
  ],
  "lunch": [
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." },
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." }
  ],
  "dinner": [
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." },
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." }
  ],
  "snack": [
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." },
    { "title": "...", "description": "...", "calories": "...", "macros": "...", "time": "...", "instructions": "..." }
  ]
}`;

        const result = await model.generateContent(promptContext);
        let text = result.response.text();
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const parsed = JSON.parse(text);
            res.json(parsed);
        } catch {
            res.json({
                breakfast: [{ title: 'Tarif yüklenemedi', description: '', calories: '-', macros: '-', time: '-', instructions: '' }],
                lunch: [{ title: 'Tarif yüklenemedi', description: '', calories: '-', macros: '-', time: '-', instructions: '' }],
                dinner: [{ title: 'Tarif yüklenemedi', description: '', calories: '-', macros: '-', time: '-', instructions: '' }],
                snack: [{ title: 'Tarif yüklenemedi', description: '', calories: '-', macros: '-', time: '-', instructions: '' }]
            });
        }
    } catch (err) {
        console.error('Recipe generation error:', err);
        res.status(500).json({ error: err.message || 'Tarifler oluşturulamadı.' });
    }
});

module.exports = router;
