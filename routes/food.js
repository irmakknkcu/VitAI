const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const [rows] = await db.query(
            'SELECT * FROM food_log WHERE user_id = ? AND log_date = ? ORDER BY created_at ASC',
            [req.userId, date]
        );
        res.json(rows);
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
        res.json({ success: true });
    } catch (err) {
        console.error('Clear food log error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
