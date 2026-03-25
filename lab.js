const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

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

router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { hemoglobin, glucose, cholesterol, vitamin_d } = req.body;
        const date = new Date().toISOString().split('T')[0];

        // Default değerler: boş/undefined gelirse 0 olarak kaydet (null değil)
        const hgb = hemoglobin !== undefined && hemoglobin !== '' ? Number(hemoglobin) : 0;
        const glc = glucose !== undefined && glucose !== '' ? Number(glucose) : 0;
        const chol = cholesterol !== undefined && cholesterol !== '' ? Number(cholesterol) : 0;
        const vitd = vitamin_d !== undefined && vitamin_d !== '' ? Number(vitamin_d) : 0;

        // 1. ADIM: lab_results tablosuna geçmiş kaydı (History) ekle
        const [result] = await db.query(
            'INSERT INTO lab_results (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, hgb, glc, chol, vitd, date]
        );

        // 2. ADIM (KRİTİK HAMLE): profiles tablosunu canlı değerlerle güncelle (Current)
        // Bu sayede Dashboard ve AI tahlilleri anında görecek
        await db.query(
            `UPDATE profiles 
             SET 
               hemoglobin = ?, 
               glucose = ?, 
               cholesterol = ?, 
               vitamin_d = ?
             WHERE user_id = ?`,
            [hgb, glc, chol, vitd, req.userId]
        );

        res.json({ 
            success: true, 
            id: result.insertId, 
            hemoglobin: hgb, 
            glucose: glc, 
            cholesterol: chol, 
            vitamin_d: vitd, 
            log_date: date 
        });

    } catch (err) {
        console.error('Save lab result error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;