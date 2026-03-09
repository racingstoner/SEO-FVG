const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbDir = process.env.VERCEL ? '/tmp' : __dirname;
const dbPath = path.join(dbDir, 'seo_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.serialize(() => {
            // Tabla original para sitemaps
            db.run(`CREATE TABLE IF NOT EXISTS urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT UNIQUE,
                lastmod TEXT,
                status TEXT,
                inStock TEXT
            )`);

            // Nueva tabla para el spreadsheet simple
            db.run(`CREATE TABLE IF NOT EXISTS spreadsheet_urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
        });
    }
});

module.exports = db;
