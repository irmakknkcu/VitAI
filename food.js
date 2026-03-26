const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET - Günlük yemekleri getir
router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [foods] = await db.query(
            `SELECT * FROM food_log 
             WHERE user_id = ? 
             ORDER BY created_at DESC`,
            [req.userId]
        );

        res.json(foods);

    } catch (err) {
        console.error('Get food error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST - YEMEK EKLE 
router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const {
            food_name,
            calories,
            protein,
            carbs,
            fat,
            meal_type // breakfast | lunch | dinner
        } = req.body;

        const date = new Date().toISOString().split('T')[0];

        //  1. food_log’a kaydet (history)
        await db.query(
            `INSERT INTO food_log 
            (user_id, food_name, calories, protein, carbs, fat, meal_type, log_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.userId,
                food_name || 'Unknown food',
                calories || 0,
                protein || 0,
                carbs || 0,
                fat || 0,
                meal_type || 'other',
                date
            ]
        );

        // 2. profiles → günlük kalori artır 🔥
        await db.query(
            `UPDATE profiles 
             SET daily_calories_taken = daily_calories_taken + ?
             WHERE user_id = ?`,
            [calories || 0, req.userId]
        );

        res.json({ success: true });

    } catch (err) {
        console.error('Add food error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;