import sqlite3 from 'sqlite3';
import { join } from 'node:path';

const dbPath = join(process.cwd(), 'samara.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        pincode TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Orders table
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        items TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        utr TEXT,
        status TEXT DEFAULT 'Pending',
        delivery_slot TEXT NOT NULL,
        total_amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create Subscriptions table
    db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        schedule TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create Batches table
    db.run(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        date TEXT NOT NULL,
        fat REAL NOT NULL,
        snf REAL NOT NULL,
        antibiotics INTEGER DEFAULT 0, -- 0 = Clear, 1 = Detected
        quality_score INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, () => {
      // Seed some test quality batches
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO batches (id, product_name, date, fat, snf, antibiotics, quality_score)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const todayStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
      const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

      stmt.run('B2026-0712', 'Organic A2 Milk', todayStr, 5.8, 9.2, 0, 98);
      stmt.run('B2026-0711', 'Organic A2 Milk', yesterdayStr, 5.7, 9.1, 0, 97);
      stmt.run('G2026-0701', 'Bilona Desi Ghee', '01/07/2026', 99.6, 0.2, 0, 99);
      stmt.finalize();
      
      console.log('Database tables successfully initialized.');
    });
  });
}

// Helper methods to wrap SQLite callbacks in Promises
export const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

export const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export default db;
