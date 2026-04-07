const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// PROFIL GETIRME
router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [users] = await db.query('SELECT name, surname, email, avatar FROM users WHERE id = ?', [req.userId]);
        const [profiles] = await db.query('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);

        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        res.json({
            ...users[0],
            ...(profiles[0] || {}),
        });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PROFIL GÜNCELLEME (DIET_TYPE VE LAB SONUÇLARI DAHİL)
router.put('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        // 1. BURASI DEĞİŞTİ: Yeni alanları (diet_type, allergies vb.) buraya ekledik
        const { 
            name, surname, age, gender, height, weight, goal, activity, avatar,
            diet_type, allergies, dislikes, budget_level, cook_time_pref,
            hemoglobin, glucose, cholesterol, vitamin_d 
        } = req.body;

        // Kullanıcı adı ve soyadını güncelle
        await db.query(
            'UPDATE users SET name = ?, surname = ? WHERE id = ?',
            [name || '', surname || '', req.userId]
        );

        if (avatar !== undefined) {
            await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.userId]);
        }

        // Kalori hedefini hesapla
        let dailyCaloriesGoal = 0;
        const w = Number(weight) || 0;
        const h = Number(height) || 0;
        const a = Number(age) || 0;
        const act = Number(activity) || 1.2;
        if (w > 0 && h > 0 && a > 0) {
            const bmr = gender === 'male'
                ? (10 * w + 6.25 * h - 5 * a + 5)
                : (10 * w + 6.25 * h - 5 * a - 161);
            dailyCaloriesGoal = Math.round(bmr * act);
        }

        // 2. BURASI DEĞİŞTİ: INSERT/UPDATE sorgusuna tüm yeni sütunları ekledik
        await db.query(
            `INSERT INTO profiles (
                user_id, age, gender, height, weight, goal, activity, 
                daily_calories_goal, diet_type, allergies, dislikes, 
                budget_level, cook_time_pref, hemoglobin, glucose, cholesterol, vitamin_d
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                age=VALUES(age), gender=VALUES(gender), height=VALUES(height), 
                weight=VALUES(weight), goal=VALUES(goal), activity=VALUES(activity),
                daily_calories_goal=VALUES(daily_calories_goal),
                diet_type=VALUES(diet_type), allergies=VALUES(allergies), 
                dislikes=VALUES(dislikes), budget_level=VALUES(budget_level), 
                cook_time_pref=VALUES(cook_time_pref),
                hemoglobin=VALUES(hemoglobin), glucose=VALUES(glucose),
                cholesterol=VALUES(cholesterol), vitamin_d=VALUES(vitamin_d)`,
            [
                req.userId, age || 0, gender || 'female', height || 0, weight || 0, goal || 0, activity || 1.2, 
                dailyCaloriesGoal, diet_type || '', allergies || '', dislikes || '', 
                budget_level || 'medium', cook_time_pref || 30,
                hemoglobin || 0, glucose || 0, cholesterol || 0, vitamin_d || 0
            ]
        );

        res.json({ success: true, dailyCaloriesGoal });
    } catch (err) {
        console.error('Save profile error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

module.exports = router;