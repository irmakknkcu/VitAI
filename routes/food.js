const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

function isIsoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoLocalToday() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
}

router.get('/summary', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { from, to } = req.query;

        if (!isIsoDate(from) || !isIsoDate(to)) {
            return res.status(400).json({ error: 'Query params "from" and "to" must be ISO dates (YYYY-MM-DD)' });
        }
        if (from > to) {
            return res.status(400).json({ error: '"from" must be <= "to"' });
        }

        const [rows] = await db.query(
            `SELECT DATE_FORMAT(log_date, '%Y-%m-%d') AS log_date, SUM(calories) AS calories
             FROM food_log
             WHERE user_id = ? AND log_date BETWEEN ? AND ?
             GROUP BY log_date
             ORDER BY log_date ASC`,
            [req.userId, from, to]
        );

        res.json(rows.map((r) => ({ log_date: r.log_date, calories: Number(r.calories) })));
    } catch (err) {
        console.error('Get food summary error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const date = req.query.date || isoLocalToday();
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
        const { name, calories, meal_type, log_date } = req.body;
        if (!name || !calories) return res.status(400).json({ error: 'Name and calories required' });

        const date = (log_date && isIsoDate(log_date)) ? log_date : isoLocalToday();
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
        const q = req.query.date;
        const date = (q && isIsoDate(q)) ? q : isoLocalToday();
        await db.query('DELETE FROM food_log WHERE user_id = ? AND log_date = ?', [req.userId, date]);
        res.json({ success: true });
    } catch (err) {
        console.error('Clear food log error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
