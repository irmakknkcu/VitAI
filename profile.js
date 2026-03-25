const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

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

router.put('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, surname, age, gender, height, weight, goal, activity, avatar } = req.body;

        await db.query(
            'UPDATE users SET name = ?, surname = ? WHERE id = ?',
            [name || '', surname || '', req.userId]
        );

        if (avatar !== undefined) {
            await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.userId]);
        }

        // Kalori hedefini (TDEE) hesapla ve kaydet
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

        await db.query(
            `INSERT INTO profiles (user_id, age, gender, height, weight, goal, activity, daily_calories_goal) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE age=VALUES(age), gender=VALUES(gender), height=VALUES(height), 
             weight=VALUES(weight), goal=VALUES(goal), activity=VALUES(activity),
             daily_calories_goal=VALUES(daily_calories_goal)`,
            [req.userId, age || 0, gender || 'female', height || 0, weight || 0, goal || 0, activity || 1.2, dailyCaloriesGoal]
        );

        res.json({ success: true, dailyCaloriesGoal });
    } catch (err) {
        console.error('Save profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
