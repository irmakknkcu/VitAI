const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Tesseract = require('tesseract.js');

const multer = require('multer');
let pdfParse;

try {
    pdfParse = require('pdf-parse');
} catch (err) {
    console.warn("pdf-parse yüklü değil, PDF özelliği kapalı");
}
const upload = multer({ storage: multer.memoryStorage() });

async function extractTextWithOCR(buffer) {
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    return text;
}
// GET: tüm lab sonuçları
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


// POST: manuel giriş
router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { hemoglobin, glucose, cholesterol, vitamin_d } = req.body;

        const date = new Date().toISOString().split('T')[0];

        const [result] = await db.query(
            'INSERT INTO lab_results (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) VALUES (?, ?, ?, ?, ?, ?)',
            [
                req.userId,
                hemoglobin || null,
                glucose || null,
                cholesterol || null,
                vitamin_d || null,
                date
            ]
        );

        res.json({
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


// POST: PDF upload (PATLAMAZ VERSION)
router.post('/upload-pdf', auth, upload.single('labPdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'PDF gerekli' });
        }

        let text = '';

        // 🔴 1. önce pdf-parse dene
        if (pdfParse) {
            try {
                const data = await pdfParse(req.file.buffer);
                text = data.text || '';
            } catch (e) {
                console.warn("pdf-parse başarısız");
            }
        }

        // 🔴 2. eğer text boşsa OCR kullan
        if (!text || text.trim().length < 20) {
            console.log("OCR kullanılıyor...");
            text = await extractTextWithOCR(req.file.buffer);
        }

        console.log("------ PDF TEXT ------");
        console.log(text.substring(0, 500));
        console.log("----------------------");

        // 🔥 güçlü parser
        const getValue = (regex) => {
            const match = text.match(regex);
            return match ? parseFloat(match[1].replace(',', '.')) : null;
        };

        // 🔥 GENİŞ REGEX (senin PDF için)
        // 🔥 e-Nabız PDF'i için güncellenmiş güçlü parser
            const hemoglobin = getValue(/(?:HGB\.|Hemoglobin).*?(\d+[.,]\d+)/i);
            const glucose = getValue(/(?:Glukoz|Glucose).*?(\d+)/i);
            const cholesterol = getValue(/(?:Kolesterol|Cholesterol).*?(\d+)/i);
            const vitaminD = getValue(/(?:Vitamin\s*D).*?(\d+[.,]\d+)/i);
        console.log("------ PARSED ------");
        console.log({ hemoglobin, glucose, cholesterol, vitaminD });
        console.log("--------------------");

        const db = req.app.locals.db;
        const date = new Date().toISOString().split('T')[0];

        await db.query(
            'INSERT INTO lab_results (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, hemoglobin, glucose, cholesterol, vitaminD, date]
        );

        res.json({
            message: 'PDF işlendi',
            hemoglobin,
            glucose,
            cholesterol,
            vitamin_d: vitaminD
        });

    } catch (err) {
        console.error("PDF ERROR:", err);
        res.status(500).json({ error: 'PDF işlenemedi' });
    }
});
module.exports = router;