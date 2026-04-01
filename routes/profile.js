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
        const {
            name,
            surname,
            age,
            gender,
            height,
            weight,
            goal,
            activity,
            diet_type,
            allergies,
            dislikes,
            budget_level,
            cook_time_pref,
            avatar
        } = req.body;

        await db.query(
            'UPDATE users SET name = ?, surname = ? WHERE id = ?',
            [name || '', surname || '', req.userId]
        );

        if (avatar !== undefined) {
            await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.userId]);
        }

        // Backward-compatible upsert: if the DB hasn't been migrated yet, fall back to the old column set.
        try {
            await db.query(
                `INSERT INTO profiles (user_id, age, gender, height, weight, goal, activity, diet_type, allergies, dislikes, budget_level, cook_time_pref)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     age=VALUES(age),
                     gender=VALUES(gender),
                     height=VALUES(height),
                     weight=VALUES(weight),
                     goal=VALUES(goal),
                     activity=VALUES(activity),
                     diet_type=VALUES(diet_type),
                     allergies=VALUES(allergies),
                     dislikes=VALUES(dislikes),
                     budget_level=VALUES(budget_level),
                     cook_time_pref=VALUES(cook_time_pref)`,
                [
                    req.userId,
                    age || 0,
                    gender || 'female',
                    height || 0,
                    weight || 0,
                    goal || 0,
                    activity || 1.2,
                    diet_type || '',
                    allergies ?? null,
                    dislikes ?? null,
                    budget_level || 'medium',
                    Number.isFinite(Number(cook_time_pref)) ? Number(cook_time_pref) : 30
                ]
            );
        } catch (e) {
            await db.query(
                `INSERT INTO profiles (user_id, age, gender, height, weight, goal, activity) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE age=VALUES(age), gender=VALUES(gender), height=VALUES(height), 
                 weight=VALUES(weight), goal=VALUES(goal), activity=VALUES(activity)`,
                [req.userId, age || 0, gender || 'female', height || 0, weight || 0, goal || 0, activity || 1.2]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Save profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
