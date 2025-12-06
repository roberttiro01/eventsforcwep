// Collect month, day of month, choose_event, and couple_name
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');

const con = mysql.createConnection({
    host: 'localhost',
    database: 'capstone',
    user: 'root',
    password: ''
});

// Test database connection
con.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to MySQL database successfully!');
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files so the HTML can be opened via http://localhost:3300/event_this_month.html
app.use(express.static(path.join(__dirname, '..')));

app.listen(3300, () => {
    console.log('Server running on port 3300');
});
// GET events from capstone.event_this_month table (all rows)
// Returns: Date, Event_type, Couple_name
app.get('/api/event_this_month', (req, res) => {
    const sql = `
        SELECT 
            Date AS Date,
            Choose_your_event AS Event_type,
            Couple_name AS Couple_name
        FROM book
        WHERE COALESCE(Status, 'pending') = 'accepted'
        ORDER BY 
            CASE 
                WHEN STR_TO_DATE(Date, '%Y-%m-%d') IS NOT NULL THEN STR_TO_DATE(Date, '%Y-%m-%d')
                WHEN STR_TO_DATE(Date, '%m/%d/%Y') IS NOT NULL THEN STR_TO_DATE(Date, '%m/%d/%Y')
                ELSE STR_TO_DATE(Date, '%d/%m/%Y')
            END ASC
    `;

    con.query(sql, (err, result) => {
        if (err) {
            console.error('Failed to fetch accepted events from book:', err);
            return res.status(500).json({ error: 'Failed to fetch events' });
        }
        return res.json({ events: result });
    });
});

// Import events (Date, Couple_name, optional Event_type) from client dashboard
// Expected body: { events: [ { Date: 'YYYY-MM-DD', Couple_name: '...', Event_type?: '...' } ] }
app.post('/api/event_this_month/import', (req, res) => {
    try {
        const payload = req.body || {};
        const items = Array.isArray(payload.events) ? payload.events : [];
        if (items.length === 0) {
            return res.status(400).json({ error: 'events array is required' });
        }

        const values = items
            .map(e => ({
                Date: String(e.Date || '').trim(),
                Couple_name: String(e.Couple_name || '').trim(),
                Event_type: String(e.Event_type || '').trim()
            }))
            .filter(e => e.Date && e.Couple_name);

        if (values.length === 0) {
            return res.status(400).json({ error: 'No valid events to import' });
        }

        const sql = 'INSERT INTO book (Date, Choose_your_event, Couple_name, Status) VALUES ?';
        const params = [values.map(v => [v.Date, v.Event_type || null, v.Couple_name, 'accepted'])];

        con.query(sql, params, (err, result) => {
            if (err) {
                console.error('Failed to import events into book:', err);
                return res.status(500).json({ error: 'Failed to import events' });
            }
            return res.json({ ok: true, inserted: result.affectedRows });
        });
    } catch (e) {
        console.error('Import error:', e);
        return res.status(500).json({ error: 'Import error' });
    }
});

// DELETE event from book table (where accepted events are stored)
// Expected body: { id: number } or { Date: string, Couple_name: string }
app.delete('/api/event_this_month', (req, res) => {
    try {
        const { id, Date, Couple_name } = req.body;
        
        if (!id && (!Date || !Couple_name)) {
            return res.status(400).json({ 
                error: 'Either id or both Date and Couple_name are required' 
            });
        }

        let sql, params;
        
        if (id) {
            // Delete by ID
            sql = 'DELETE FROM book WHERE id = ? AND COALESCE(Status, \'pending\') = \'accepted\'';
            params = [id];
        } else {
            // Delete by Date and Couple_name
            sql = 'DELETE FROM book WHERE Date = ? AND Couple_name = ? AND COALESCE(Status, \'pending\') = \'accepted\'';
            params = [Date, Couple_name];
        }

        con.query(sql, params, (err, result) => {
            if (err) {
                console.error('Failed to delete event from book:', err);
                return res.status(500).json({ error: 'Failed to delete event' });
            }
            
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Event not found or not accepted' });
            }
            
            return res.json({ 
                ok: true, 
                deleted: result.affectedRows,
                message: 'Event deleted successfully' 
            });
        });
    } catch (e) {
        console.error('Delete error:', e);
        return res.status(500).json({ error: 'Delete error' });
    }
});

// Note: Booking list, status change, and deletion are handled exclusively by the
// book service on port 4400 (see node/book.js). This server only exposes
// event summary/import/delete for the calendar view.

// Optional: direct route helper
app.get('/event_this_month', (req, res) => {
    res.sendFile(path.join(__dirname, '../event_this_month.html'));
});

module.exports = app;

 
