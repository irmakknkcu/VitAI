const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

//  Tüm tahlil geçmişi
router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [rows] = await db.query(
            'SELECT * FROM lab_results WHERE user_id = ? ORDER BY log_date DESC',
            [req.userId]
        );

        res.json(rows);

    } catch (err) {
        console.error('Get lab results error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


//  Yeni tahlil ekleme
router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        let { hemoglobin, glucose, cholesterol, vitamin_d } = req.body;

        const date = new Date().toISOString().split('T')[0];

        //  NULL / STRING / UNDEFINED fix
        hemoglobin = Number(hemoglobin) || 0;
        glucose = Number(glucose) || 0;
        cholesterol = Number(cholesterol) || 0;
        vitamin_d = Number(vitamin_d) || 0;

        // 1. HISTORY (lab_results)
        const [result] = await db.query(
            `INSERT INTO lab_results 
             (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.userId, hemoglobin, glucose, cholesterol, vitamin_d, date]
        );

        // 2. CURRENT (profiles)
        await db.query(
            `UPDATE profiles 
             SET 
               hemoglobin = ?, 
               glucose = ?, 
               cholesterol = ?, 
               vitamin_d = ?
             WHERE user_id = ?`,
            [
                hemoglobin,
                glucose,
                cholesterol,
                vitamin_d,
                req.userId
            ]
        );

        // response
        res.json({
            success: true,
            id: result.insertId,
            hemoglobin,
            glucose,
            cholesterol,
            vitamin_d,
            log_date: date
        });

    } catch (err) {
        console.error('Save lab result error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;