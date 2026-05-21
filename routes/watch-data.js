const express = require('express');
const router = express.Router();

function isIsoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoLocalToday() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
}

async function ensureWatchDataTable(db) {
    await db.query(
        `CREATE TABLE IF NOT EXISTS watch_data (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            log_date DATE NOT NULL,
            steps INT NOT NULL DEFAULT 0,
            calories DECIMAL(10,2) NOT NULL DEFAULT 0,
            source VARCHAR(50) NOT NULL DEFAULT 'apple_health',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY uniq_user_date (user_id, log_date)
        )`
    );

    try {
        await db.query('ALTER TABLE watch_data ADD COLUMN IF NOT EXISTS log_date DATE NOT NULL DEFAULT (CURDATE())');
    } catch (_) {
        /* older MySQL/MariaDB may not support IF NOT EXISTS on ALTER */
    }
    try {
        await db.query('ALTER TABLE watch_data ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    } catch (_) {
        /* ignore if unsupported or column exists */
    }
    try {
        await db.query('ALTER TABLE watch_data ADD UNIQUE KEY uniq_user_date (user_id, log_date)');
    } catch (_) {
        // Unique key may already exist; ignore.
    }
    await db.query('UPDATE watch_data SET log_date = CURDATE() WHERE log_date IS NULL');
    try {
        await db.query('ALTER TABLE watch_data DROP INDEX user_id');
    } catch (_) {
        // Old unique index may not exist; ignore.
    }
}

async function ensureExerciseLogColumns(db) {
    await db.query('ALTER TABLE exercise_log MODIFY calories DECIMAL(10,2) NOT NULL');
    await db.query('ALTER TABLE exercise_log ADD COLUMN IF NOT EXISTS steps INT NOT NULL DEFAULT 0');
    await db.query('ALTER TABLE exercise_log ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL');
}

function parseNonNegativeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

async function findUserByEmail(db, email) {
    const [rows] = await db.query('SELECT id, email FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
}

router.post('/', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email, steps, calories, source } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email is required' });
        }

        const parsedSteps = parseNonNegativeNumber(steps);
        const parsedCalories = parseNonNegativeNumber(calories);
        if (parsedSteps === null || parsedCalories === null) {
            return res.status(400).json({ error: 'Steps and calories must be non-negative numbers' });
        }

        await ensureWatchDataTable(db);
        await ensureExerciseLogColumns(db);

        const user = await findUserByEmail(db, email);
        if (!user) {
            return res.status(404).json({ error: 'User not found for given email' });
        }

        const finalSource = (typeof source === 'string' && source.trim()) ? source.trim() : 'apple_health';

        const logDateStr = isIsoDate(req.body.log_date) ? req.body.log_date : isoLocalToday();

        await db.query(
            `INSERT INTO watch_data (user_id, log_date, steps, calories, source)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               steps = VALUES(steps),
               calories = VALUES(calories),
               source = VALUES(source),
               updated_at = CURRENT_TIMESTAMP`,
            [user.id, logDateStr, Math.round(parsedSteps), parsedCalories, finalSource]
        );

        const [existingExercise] = await db.query(
            `SELECT id
             FROM exercise_log
             WHERE user_id = ? AND log_date = ? AND source = 'apple_health'
             ORDER BY id DESC
             LIMIT 1`,
            [user.id, logDateStr]
        );

        let exerciseId;
        if (existingExercise.length > 0) {
            exerciseId = existingExercise[0].id;
            await db.query(
                `UPDATE exercise_log
                 SET type = 'Walking - Apple Health',
                     duration = 0,
                     calories = ?,
                     steps = ?,
                     source = 'apple_health'
                 WHERE id = ?`,
                [parsedCalories, Math.round(parsedSteps), exerciseId]
            );
        } else {
            const [insertExercise] = await db.query(
                `INSERT INTO exercise_log (user_id, type, duration, calories, steps, source, log_date)
                 VALUES (?, 'Walking - Apple Health', 0, ?, ?, 'apple_health', ?)`,
                [user.id, parsedCalories, Math.round(parsedSteps), logDateStr]
            );
            exerciseId = insertExercise.insertId;
        }

        const [watchRows] = await db.query(
            `SELECT steps, calories, source, DATE_FORMAT(log_date, '%Y-%m-%d') AS log_date, updated_at
             FROM watch_data
             WHERE user_id = ? AND log_date = ?
             LIMIT 1`,
            [user.id, logDateStr]
        );
        const [exerciseRows] = await db.query(
            `SELECT id, type, duration, calories, steps, source, DATE_FORMAT(log_date, '%Y-%m-%d') AS date
             FROM exercise_log
             WHERE id = ?
             LIMIT 1`,
            [exerciseId]
        );

        res.json({
            steps: Number(watchRows[0].steps),
            calories: Number(watchRows[0].calories),
            source: watchRows[0].source,
            log_date: watchRows[0].log_date,
            updatedAt: watchRows[0].updated_at,
            exercise: {
                ...exerciseRows[0],
                calories: Number(exerciseRows[0].calories),
                steps: Number(exerciseRows[0].steps),
                caloriesBurned: Number(exerciseRows[0].calories),
                exerciseType: 'Walking - Apple Health',
                source: watchRows[0].source
            }
        });
    } catch (err) {
        console.error('Post watch data error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email } = req.query;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({
                error: 'Query param "email" is required',
                hint: 'Browser GET is for reading saved data. Example: /api/watch-data?email=user@example.com — The iOS app uses POST with a JSON body (no email in the URL). For a simple connectivity check, open GET / (home page) in Safari.'
            });
        }

        await ensureWatchDataTable(db);
        await ensureExerciseLogColumns(db);

        const user = await findUserByEmail(db, email);
        if (!user) {
            return res.status(404).json({ error: 'User not found for given email' });
        }

        const logDateStr = isIsoDate(req.query.date) ? req.query.date : isoLocalToday();

        const [watchRows] = await db.query(
            `SELECT steps, calories, source, DATE_FORMAT(log_date, '%Y-%m-%d') AS log_date, updated_at
             FROM watch_data
             WHERE user_id = ? AND log_date = ?
             LIMIT 1`,
            [user.id, logDateStr]
        );
        if (watchRows.length === 0) {
            return res.status(404).json({ error: 'No watch data found for this user' });
        }

        const [exerciseRows] = await db.query(
            `SELECT id, type, duration, calories, steps, source, DATE_FORMAT(log_date, '%Y-%m-%d') AS date
             FROM exercise_log
             WHERE user_id = ? AND log_date = ? AND source = 'apple_health'
             ORDER BY id DESC
             LIMIT 1`,
            [user.id, logDateStr]
        );

        const exercise = exerciseRows[0]
            ? {
                ...exerciseRows[0],
                calories: Number(exerciseRows[0].calories),
                steps: Number(exerciseRows[0].steps),
                caloriesBurned: Number(exerciseRows[0].calories),
                exerciseType: 'Walking - Apple Health',
                source: exerciseRows[0].source || watchRows[0].source
            }
            : null;

        res.json({
            steps: Number(watchRows[0].steps),
            calories: Number(watchRows[0].calories),
            source: watchRows[0].source,
            log_date: watchRows[0].log_date,
            updatedAt: watchRows[0].updated_at,
            exercise
        });
    } catch (err) {
        console.error('Get watch data error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
