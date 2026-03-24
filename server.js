require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// XAMPP: localhost yerine 127.0.0.1 kullan (socket sorununu önler)
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'vitai',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.locals.db = pool;

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const foodRoutes = require('./routes/food');
const exerciseRoutes = require('./routes/exercise');
const weightRoutes = require('./routes/weight');
const labRoutes = require('./routes/lab');
const aiRoutes = require('./routes/ai');

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/exercise', exerciseRoutes);
app.use('/api/weight', weightRoutes);
app.use('/api/lab', labRoutes);
app.use('/api/ai', aiRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
    try {
        const conn = await pool.getConnection();
        console.log('MySQL connected successfully');
        conn.release();
    } catch (err) {
        console.error('MySQL connection failed:', err.message);
        console.error('Make sure MySQL is running and the database "vitai" exists.');
        console.error('Run: mysql -u root -p < db/schema.sql');
    }
    console.log(`VitAI server running at http://localhost:${PORT}`);
});
