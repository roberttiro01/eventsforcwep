const express = require('express');

// Ensure history table exists
function ensureHistoryTable(con) {
    try {
        const sql = `
            CREATE TABLE IF NOT EXISTS deleted_bookings_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id INT NULL,
                full_name VARCHAR(255) NULL,
                email VARCHAR(255) NULL,
                deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        con.query(sql, (err) => {
            if (err) {
                console.warn('History table ensure warning:', err.message);
            }
        });
    } catch (e) {
        console.warn('History table initialization skipped:', e.message);
    }
}

// Record a deletion event by booking id
function recordDeletionById(con, bookingId, callback) {
    try {
        const selectSql = 'SELECT id, `Full_name` AS full_name, `Email` AS email FROM book WHERE id = ? LIMIT 1';
        con.query(selectSql, [bookingId], (selErr, rows) => {
            if (selErr) {
                if (callback) return callback(selErr);
                return;
            }
            const row = rows && rows[0] ? rows[0] : null;
            const fullName = row ? row.full_name : null;
            const email = row ? row.email : null;

            const insertSql = 'INSERT INTO deleted_bookings_history (booking_id, full_name, email) VALUES (?, ?, ?)';
            con.query(insertSql, [bookingId || null, fullName || null, email || null], (insErr) => {
                if (callback) return callback(insErr, { booking_id: bookingId, full_name: fullName, email });
            });
        });
    } catch (e) {
        if (callback) return callback(e);
    }
}

// Attach GET /api/history route to list deletions
function attachHistoryRoutes(app, con) {
    const router = express.Router();

    router.get('/', (req, res) => {
        const sql = 'SELECT id, booking_id, full_name, email, deleted_at FROM deleted_bookings_history ORDER BY id DESC LIMIT 200';
        con.query(sql, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to fetch history' });
            }
            return res.json({ history: rows || [] });
        });
    });

    // Delete single history record by id
    router.delete('/:id', (req, res) => {
        const { id } = req.params;
        if (!id || !/^\d+$/.test(String(id))) {
            return res.status(400).json({ error: 'Valid numeric id is required' });
        }
        const delSql = 'DELETE FROM deleted_bookings_history WHERE id = ?';
        con.query(delSql, [Number(id)], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete history item' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'History item not found' });
            }
            return res.json({ ok: true, deleted: result.affectedRows });
        });
    });

    // Optional: clear all history items (use with caution)
    router.delete('/', (req, res) => {
        const confirm = String(req.query.confirm || '').toLowerCase();
        if (confirm !== 'yes') {
            return res.status(400).json({ error: 'Confirmation required. Pass ?confirm=yes to proceed.' });
        }
        con.query('TRUNCATE TABLE deleted_bookings_history', (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to clear history' });
            }
            return res.json({ ok: true, cleared: true });
        });
    });

    // Fallback: POST delete endpoint for environments where DELETE may be blocked
    router.post('/delete', (req, res) => {
        try {
            const id = req.body && req.body.id;
            if (!id || !/^\d+$/.test(String(id))) {
                return res.status(400).json({ error: 'Valid numeric id is required' });
            }
            const delSql = 'DELETE FROM deleted_bookings_history WHERE id = ?';
            con.query(delSql, [Number(id)], (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete history item' });
                }
                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'History item not found' });
                }
                return res.json({ ok: true, deleted: result.affectedRows });
            });
        } catch (e) {
            return res.status(500).json({ error: 'Delete error' });
        }
    });

    app.use('/api/history', router);
}

module.exports = {
    ensureHistoryTable,
    recordDeletionById,
    attachHistoryRoutes
};


