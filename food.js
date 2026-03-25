const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// YARDIMCI FONKSİYON: Profildeki toplam kaloriyi günceller
async function syncProfileCalories(db, userId) {
    const date = new Date().toISOString().split('T')[0];
    
    // 1. O günkü toplam kaloriyi hesapla
    const [rows] = await db.query(
        'SELECT SUM(calories) as total FROM food_log WHERE user_id = ? AND log_date = ?',
        [userId, date]
    );
    const totalCalories = rows[0].total || 0;

    // 2. Kalori hedefini TDEE'den hesapla (profile'da daily_calories_goal yoksa güncelle)
    const [profiles] = await db.query(
        `SELECT p.weight, p.height, p.age, p.gender, p.activity, p.daily_calories_goal
         FROM profiles p WHERE p.user_id = ?`,
        [userId]
    );
    if (profiles.length > 0) {
        const p = profiles[0];
        let caloriesGoal = Number(p.daily_calories_goal) || 0;
        // Eğer hedef hiç set edilmemişse TDEE'yi hesaplayıp kaydet
        if (caloriesGoal === 0 && p.weight && p.height && p.age) {
            const bmr = p.gender === 'male'
                ? (10 * p.weight + 6.25 * p.height - 5 * p.age + 5)
                : (10 * p.weight + 6.25 * p.height - 5 * p.age - 161);
            caloriesGoal = Math.round(bmr * (Number(p.activity) || 1.2));
        }

        // 3. profiles tablosunu güncelle
        await db.query(
            'UPDATE profiles SET daily_calories_taken = ?, daily_calories_goal = ? WHERE user_id = ?',
            [totalCalories, caloriesGoal, userId]
        );
    } else {
        await db.query(
            'UPDATE profiles SET daily_calories_taken = ? WHERE user_id = ?',
            [totalCalories, userId]
        );
    }
}

router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const [rows] = await db.query(
            'SELECT * FROM food_log WHERE user_id = ? AND log_date = ? ORDER BY created_at ASC',
            [req.userId, date]
        );

        // Öğün bazında kalori özeti
        const mealSummary = {};
        for (const row of rows) {
            const meal = row.meal_type || 'Other';
            if (!mealSummary[meal]) mealSummary[meal] = 0;
            mealSummary[meal] += Number(row.calories) || 0;
        }

        // Toplam kalori ve hedef
        const totalTaken = Object.values(mealSummary).reduce((a, b) => a + b, 0);
        const [profileRows] = await db.query(
            'SELECT daily_calories_goal FROM profiles WHERE user_id = ?',
            [req.userId]
        );
        const caloriesGoal = profileRows.length > 0 ? (Number(profileRows[0].daily_calories_goal) || 0) : 0;

        res.json({
            items: rows,
            mealSummary,            // { Breakfast: 450, Lunch: 600, ... }
            totalCalories: totalTaken,
            caloriesGoal
        });
    } catch (err) {
        console.error('Get food log error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, calories, meal_type } = req.body;
        if (!name || !calories) return res.status(400).json({ error: 'Name and calories required' });

        const date = new Date().toISOString().split('T')[0];
        const [result] = await db.query(
            'INSERT INTO food_log (user_id, name, calories, meal_type, log_date) VALUES (?, ?, ?, ?, ?)',
            [req.userId, name, calories, meal_type || 'Breakfast', date]
        );

        // KRİTİK HAMLE: Kaloriyi profile işle
        await syncProfileCalories(db, req.userId);

        res.json({ id: result.insertId, name, calories, meal_type, log_date: date });
    } catch (err) {
        console.error('Add food error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.query('DELETE FROM food_log WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        
        // KRİTİK HAMLE: Silme işleminden sonra kalori güncelle
        await syncProfileCalories(db, req.userId);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Delete food error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const date = new Date().toISOString().split('T')[0];
        await db.query('DELETE FROM food_log WHERE user_id = ? AND log_date = ?', [req.userId, date]);
        
        // KRİTİK HAMLE: Temizlikten sonra kaloriyi 0'a çek
        await syncProfileCalories(db, req.userId);

        res.json({ success: true });
    } catch (err) {
        console.error('Clear food log error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;