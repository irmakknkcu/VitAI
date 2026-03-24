const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

router.post('/register', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'This email is already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const nameParts = name.trim().split(' ');
        const firstName = nameParts[0];
        const surname = nameParts.slice(1).join(' ') || '';

        const [result] = await db.query(
            'INSERT INTO users (name, surname, email, password_hash) VALUES (?, ?, ?, ?)',
            [firstName, surname, email, passwordHash]
        );

        await db.query(
            'INSERT INTO profiles (user_id) VALUES (?)',
            [result.insertId]
        );

        const token = jwt.sign(
            { userId: result.insertId, email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: result.insertId, name: firstName, surname, email }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Wrong email or password' });
        }

        const user = users[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Wrong email or password' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, name: user.name, surname: user.surname, email: user.email, avatar: user.avatar }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
