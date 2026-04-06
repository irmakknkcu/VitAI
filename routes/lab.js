const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Tesseract = require('tesseract.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let pdfParseFn;
try {
    pdfParseFn = require('pdf-parse-fork');
} catch (err) {
    try {
        pdfParseFn = require('pdf-parse');
    } catch (err2) {
        console.warn('pdf-parse yüklenemedi:', err2.message);
    }
}

let pdfPopplerConvert;
try {
    pdfPopplerConvert = require('pdf-poppler').convert;
} catch (err) {
    console.warn('pdf-poppler yüklenemedi:', err.message);
}

const upload = multer({ storage: multer.memoryStorage() });
const TESS_LANG = 'eng+tur';

const normalizeValue = (value, type) => {
    if (value === null || value === undefined || value === '') {
        return 0;
    }

    value = String(value).replace(',', '.');

    let num = parseFloat(value);

    if (isNaN(num)) {
        return 0;
    }

    if (type === 'hemoglobin' && num > 50) num /= 10;
    if (type === 'glucose' && num > 300) num /= 10;
    if (type === 'cholesterol' && num > 400) num /= 10;
    if (type === 'vitaminD' && num > 200) num /= 10;

    return num;
};

function foldTurkishToAscii(str) {
    if (!str) return '';
    return str
        .replace(/İ/g, 'I')
        .replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G')
        .replace(/ğ/g, 'g')
        .replace(/Ü/g, 'U')
        .replace(/ü/g, 'u')
        .replace(/Ş/g, 'S')
        .replace(/ş/g, 's')
        .replace(/Ö/g, 'O')
        .replace(/ö/g, 'o')
        .replace(/Ç/g, 'C')
        .replace(/ç/g, 'c');
}

function consolidateKeywords(text) {
    return text
        .replace(/H\s*G\s*B/g, 'HGB')
        .replace(/G\s*L\s*U\s*K\s*O\s*Z/g, 'GLUKOZ')
        .replace(/K\s*O\s*L\s*E\s*S\s*T\s*E\s*R\s*O\s*L/g, 'KOLESTEROL')
        .replace(/25\s*O\s*H/g, '25OH')
        .replace(/H\s*I\s*D\s*R\s*O\s*K\s*S\s*I/g, 'HIDROKSI')
        .replace(/V\s*I\s*T\s*A\s*M\s*I\s*N\s*D\s*3/g, 'VITAMIND3')
        .replace(/V\s*I\s*T\s*A\s*M\s*I\s*N\s*D/g, 'VITAMIND')
        .replace(/V\s*I\s*T\s*D\s*3/g, 'VITD3')
        .replace(/V\s*I\s*T\s*D/g, 'VITD')
        .replace(/D\s*V\s*I\s*T\s*A\s*M\s*I\s*N\s*I/g, 'DVITAMINI');
}

function stripRefRanges(text) {
    return text
        .replace(/(\d+[.,]?\d*)\s*[-–—]\s*(\d+[.,]?\d*)/g, ' ')
        .replace(/[<>≤≥]\s*(\d+[.,]?\d*)/g, ' ');
}

function separateGluedTokens(text) {
    return text
        .replace(/([A-Z%])\.(\d)/g, '$1 $2')
        .replace(/([A-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Z])/g, '$1 $2');
}

function cleanLabText(raw) {
    let text = foldTurkishToAscii(String(raw));
    text = text.toUpperCase();
    text = stripRefRanges(text);
    text = text
        .replace(/\n/g, ' ')
        .replace(/[^A-Z0-9.,% ]/g, ' ');
    text = separateGluedTokens(text);
    text = text.replace(/\s+/g, ' ');
    return consolidateKeywords(text);
}

function cleanSingleLine(rawLine) {
    let line = foldTurkishToAscii(rawLine).toUpperCase();
    line = stripRefRanges(line);
    line = line.replace(/[^A-Z0-9.,% ]/g, ' ');
    line = separateGluedTokens(line);
    line = line.replace(/\s+/g, ' ').trim();
    return consolidateKeywords(line);
}

const METRIC_RANGES = {
    hemoglobin: { min: 3, max: 30 },
    glucose: { min: 40, max: 600 },
    cholesterol: { min: 80, max: 500 },
    vitaminD: { min: 3, max: 250 }
};

function extractNumberAfterKeyword(text, keywordMatch, rangeKey) {
    const { min, max } = METRIC_RANGES[rangeKey] || { min: 0, max: 9999 };
    const afterKeyword = text.substring(keywordMatch.index + keywordMatch[0].length);
    const parts = afterKeyword.split(/\s+/);

    for (const part of parts) {
        if (part.includes('-')) continue;
        const cleanPart = part.replace(',', '.');
        const val = parseFloat(cleanPart);
        if (!isNaN(val) && val >= min && val <= max) {
            return val;
        }
    }
    return null;
}

const LINE_KEYWORDS = {
    hemoglobin: /HGB|HEMOGLOBIN/,
    glucose:    /ACLIK\s*GLUKOZ|GLUKOZU?|GLUCOSE/,
    cholesterol:/TOPLAM\s*KOLESTEROL|KOLESTEROL|CHOLESTEROL/,
    vitaminD:   /25OH\s*VITAMIND3?|HIDROKSI\s*VITAMIND3?|VITAMIND3?|VITD3?|DVITAMINI/
};

function parseLabTextByLines(rawText) {
    if (!rawText) return { hemoglobin: null, glucose: null, cholesterol: null, vitamin_d: null };

    const lines = rawText.split(/\n/);
    const result = { hemoglobin: null, glucose: null, cholesterol: null, vitamin_d: null };

    for (const rawLine of lines) {
        const line = cleanSingleLine(rawLine);
        if (!line || line.length < 3) continue;

        for (const [metric, regex] of Object.entries(LINE_KEYWORDS)) {
            const dbKey = metric === 'vitaminD' ? 'vitamin_d' : metric;
            if (result[dbKey] !== null) continue;

            const match = line.match(regex);
            if (match) {
                if (metric === 'cholesterol' && /HDL|LDL/.test(line) && !/TOPLAM|TOTAL/.test(line)) {
                    continue;
                }
                const val = extractNumberAfterKeyword(line, match, metric);
                if (val !== null) {
                    console.log(`  [LINE] ${metric}: "${match[0]}" → ${val} (line: "${line.substring(0, 70)}")`);
                    result[dbKey] = val;
                }
            }
        }
    }
    return result;
}

function findValue(text, keywords, rangeKey) {
    const { min, max } = METRIC_RANGES[rangeKey] || { min: 0, max: 9999 };

    for (const keyword of keywords) {
        const spacedKeyword = keyword.split('').join('\\s*');
        const regex = new RegExp(`${spacedKeyword}(.{0,80})`, 'i');
        const match = text.match(regex);

        if (match) {
            let area = match[1];
            area = area.replace(/["$]/g, ' ');
            const parts = area.split(/\s+/);

            for (const part of parts) {
                if (part.includes('-')) continue;

                const cleanPart = part.replace(',', '.');
                const val = parseFloat(cleanPart);

                if (!isNaN(val) && val >= min && val <= max) {
                    console.log(`  [KW] ${rangeKey}: "${keyword}" → ${val} (area: "${area.trim().substring(0, 40)}")`);
                    return val;
                }
            }
        }
    }
    return null;
}

function parseCleanedLabText(text) {
    const hemoglobinRaw = findValue(text, [
        'HGB',
        'HEMOGLOBIN',
        'HB',
        'KANHEMOGLOBIN'
    ], 'hemoglobin');

    const glucoseRaw = findValue(text, [
        'ACLIKGLUKOZ',
        'ACLIK GLUKOZ',
        'ACLIKGLUKOZU',
        'GLUKOZ',
        'GLUCOSE',
        'GLU',
        'FASTINGGLUCOSE',
        'KANSEKERI',
        'KAN SEKERI'
    ], 'glucose');

    const cholesterolRaw = findValue(text, [
        'TOPLAMKOLESTEROL',
        'TOPLAM KOLESTEROL',
        'TOTALCHOLESTEROL',
        'TOTAL CHOLESTEROL',
        'KOLESTEROL',
        'CHOLESTEROL',
        'SERUMKOLESTEROL'
    ], 'cholesterol');

    const vitaminDRaw = findValue(text, [
        '25OHVITAMIND3',
        '25OH VITAMIND3',
        '25OHVITAMIND',
        '25OH VITAMIND',
        'HIDROKSIVITAMIND3',
        'HIDROKSI VITAMIND3',
        'HIDROKSIVITAMIND',
        'HIDROKSI VITAMIND',
        'VITAMIND3',
        'VITAMIND',
        'VITD3',
        'VITD',
        'DVITAMINI',
        'D3 VITAMINI',
        'D VITAMINI'
    ], 'vitaminD');

    return {
        hemoglobin: hemoglobinRaw,
        glucose: glucoseRaw,
        cholesterol: cholesterolRaw,
        vitamin_d: vitaminDRaw
    };
}


function findExecutableInPath(name) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const paths = (process.env.PATH || '').split(path.delimiter);
    for (const segment of paths) {
        if (!segment) continue;
        const candidate = path.join(segment, name + ext);
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch (_) { /* ignore */ }
    }
    return null;
}

/**
 * PATH üzerindeki Poppler (Homebrew / Linux paketi) ile PDF → PNG.
 * pdf-poppler’ın paketlediği pdftocairo, macOS’ta /usr/local/opt/cairo aradığı için sık kırılır.
 */
async function renderPdfPagesToPngWithSystemTools(pdfPath, outDir) {
    const baseName = `labpg_${Date.now()}`;
    const outPrefix = path.join(outDir, baseName);

    const pdftoppm = findExecutableInPath('pdftoppm');
    if (pdftoppm) {
        await execFileAsync(pdftoppm, ['-png', '-r', '144', pdfPath, outPrefix], {
            maxBuffer: 100 * 1024 * 1024
        });
        return fs.readdirSync(outDir)
            .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(f => path.join(outDir, f));
    }

    const pdftocairo = findExecutableInPath('pdftocairo');
    if (pdftocairo) {
        await execFileAsync(pdftocairo, ['-png', '-scale-to', '1024', pdfPath, outPrefix], {
            maxBuffer: 100 * 1024 * 1024
        });
        return fs.readdirSync(outDir)
            .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(f => path.join(outDir, f));
    }

    return [];
}

async function extractPdfTextWithPdfParse(buffer) {
    if (!pdfParseFn) return '';
    try {
        if (typeof pdfParseFn === 'function') {
            const data = await pdfParseFn(buffer);
            return (data && data.text) ? String(data.text) : '';
        }
        if (pdfParseFn.PDFParse) {
            const parser = new pdfParseFn.PDFParse({ data: buffer });
            const result = await parser.getText();
            const text = (result && result.text) ? String(result.text) : '';
            if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
            return text;
        }
        return '';
    } catch (e) {
        console.log('pdf-parse başarısız:', e.message || e);
        return '';
    }
}

const OCR_HINT = 'Taranmış PDF için: macOS’ta `brew install poppler` (PATH’e pdftoppm ekler), ardından sunucuyu yeniden başlatın.';

async function extractTextWithOCR(buffer) {
    const dir = path.join(__dirname, '../uploads');

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pdfPath = path.join(dir, `temp_${uniqueId}.pdf`);
    const pagePrefix = `pg_${uniqueId}`;
    fs.writeFileSync(pdfPath, buffer);

    let pngPaths = [];
    try {
        pngPaths = await renderPdfPagesToPngWithSystemTools(pdfPath, dir);

        if (!pngPaths.length && pdfPopplerConvert) {
            try {
                await pdfPopplerConvert(pdfPath, {
                    format: 'png',
                    out_dir: dir,
                    out_prefix: pagePrefix,
                    page: null
                });
                pngPaths = fs.readdirSync(dir)
                    .filter(f => f.startsWith(pagePrefix) && f.endsWith('.png'))
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                    .map(f => path.join(dir, f));
            } catch (popplerErr) {
                console.error('pdf-poppler:', popplerErr.message || popplerErr);
            }
        }

        if (!pngPaths.length) {
            throw new Error(`PDF sayfaları görüntüye çevrilemedi (OCR için gerekli). ${OCR_HINT}`);
        }

        let fullText = '';
        for (const imagePath of pngPaths) {
            const { data: { text } } = await Tesseract.recognize(imagePath, TESS_LANG);
            fullText += `\n${text}`;
        }
        return fullText;
    } finally {
        for (const p of pngPaths) {
            try {
                if (fs.existsSync(p)) fs.unlinkSync(p);
            } catch (_) { /* ignore */ }
        }
        try {
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        } catch (_) { /* ignore */ }
    }
}

async function extractTextFromImageBuffer(buffer, mimetype) {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const ext = (mimetype && mimetype.includes('png')) ? '.png' : '.jpg';
    const imgPath = path.join(dir, `temp_img_${Date.now()}${ext}`);
    fs.writeFileSync(imgPath, buffer);
    try {
        const { data: { text } } = await Tesseract.recognize(imgPath, TESS_LANG);
        return text || '';
    } finally {
        try {
            fs.unlinkSync(imgPath);
        } catch (_) { /* ignore */ }
    }
}

function isPdfBuffer(buffer) {
    return buffer && buffer.length >= 4 && buffer.slice(0, 4).toString() === '%PDF';
}

async function extractRawTextFromLabFile(buffer, mimetype) {
    let text = '';

    if (isPdfBuffer(buffer)) {
        text = await extractPdfTextWithPdfParse(buffer);
        if (!text || text.trim().length < 20) {
            console.log('OCR çalışıyor (PDF)...');
            text = await extractTextWithOCR(buffer);
        }
        return text;
    }

    console.log('OCR çalışıyor (görüntü)...');
    return extractTextFromImageBuffer(buffer, mimetype);
}

async function parseLabPdfBuffer(buffer, mimetype) {
    const raw = await extractRawTextFromLabFile(buffer, mimetype);

    console.log('--- SATIR BAZLI PARSE ---');
    const lineResult = parseLabTextByLines(raw);

    console.log('--- KEYWORD FALLBACK ---');
    const cleaned = cleanLabText(raw);
    console.log('LAB TEXT (ilk 600):', cleaned.substring(0, 600));
    const kwResult = parseCleanedLabText(cleaned);

    const result = {
        hemoglobin: normalizeValue(lineResult.hemoglobin ?? kwResult.hemoglobin, 'hemoglobin'),
        glucose:    normalizeValue(lineResult.glucose    ?? kwResult.glucose, 'glucose'),
        cholesterol:normalizeValue(lineResult.cholesterol ?? kwResult.cholesterol, 'cholesterol'),
        vitamin_d:  normalizeValue(lineResult.vitamin_d   ?? kwResult.vitamin_d, 'vitaminD')
    };

    console.log('FINAL:', JSON.stringify(result));
    return result;
}

/* ================= ROUTES ================= */

router.get('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [rows] = await db.query(
            'SELECT * FROM lab_results WHERE user_id = ? ORDER BY log_date DESC, id DESC',
            [req.userId]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const db = req.app.locals.db;

        const h = normalizeValue(req.body.hemoglobin, 'hemoglobin');
        const g = normalizeValue(req.body.glucose, 'glucose');
        const c = normalizeValue(req.body.cholesterol, 'cholesterol');
        const v = normalizeValue(req.body.vitamin_d, 'vitaminD');

        const date = new Date().toISOString();

        const [result] = await db.query(
            `INSERT INTO lab_results 
            (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [req.userId, h, g, c, v, date]
        );

        res.json({ success: true, id: result.insertId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Insert failed' });
    }
});

router.post('/parse-pdf', auth, upload.single('labPdf'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Dosya gerekli (labPdf)' });
        }

        const parsed = await parseLabPdfBuffer(req.file.buffer, req.file.mimetype);
        res.json({
            success: true,
            hemoglobin: parsed.hemoglobin,
            glucose: parsed.glucose,
            cholesterol: parsed.cholesterol,
            vitamin_d: parsed.vitamin_d
        });
    } catch (err) {
        console.error('parse-pdf ERROR:', err);
        const msg = err.message || 'Dosya okunamadı';
        res.status(500).json({ error: msg });
    }
});

router.post('/upload-pdf', auth, upload.single('labPdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'PDF gerekli' });
        }

        const parsed = await parseLabPdfBuffer(req.file.buffer, req.file.mimetype);

        const db = req.app.locals.db;
        const date = new Date().toISOString();

        const [result] = await db.query(
            `INSERT INTO lab_results 
            (user_id, hemoglobin, glucose, cholesterol, vitamin_d, log_date) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [req.userId, parsed.hemoglobin, parsed.glucose, parsed.cholesterol, parsed.vitamin_d, date]
        );

        const [rows] = await db.query(
            'SELECT * FROM lab_results WHERE user_id = ? ORDER BY log_date DESC, id DESC',
            [req.userId]
        );

        res.json({
            success: true,
            insertedId: result.insertId,
            data: rows,
            parsed
        });

    } catch (err) {
        console.error('PDF ERROR:', err);
        res.status(500).json({ error: err.message || 'PDF işlenemedi' });
    }
});

module.exports = router;