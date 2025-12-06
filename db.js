const mysql = require('mysql');

// Centralized database configuration (env overrides, with sensible defaults)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'capstone',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || ''
};

// Create a shared connection pool for reuse across modules
const pool = mysql.createPool({
    host: dbConfig.host,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

module.exports = { pool, dbConfig };
