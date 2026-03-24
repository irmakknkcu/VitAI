const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [rows] = await db.query(
            'SELECT * FROM weight_history WHERE user_id = ? ORDER BY log_date ASC, created_at ASC',
            [req.userId]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get weight history error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { weight } = req.body;
        if (!weight) return res.status(400).json({ error: 'Weight value required' });

        const date = new Date().toISOString().split('T')[0];
        const [result] = await db.query(
            'INSERT INTO weight_history (user_id, weight, log_date) VALUES (?, ?, ?)',
            [req.userId, weight, date]
        );

        await db.query(
            'UPDATE profiles SET weight = ? WHERE user_id = ?',
            [weight, req.userId]
        );

        res.json({ id: result.insertId, weight, log_date: date });
    } catch (err) {
        console.error('Record weight error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
