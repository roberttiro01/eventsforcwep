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

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

// GET request to fetch attendees
app.get('/api/attendees', (req, res) => {
    const query = 'SELECT Name, Email, Type FROM Fill_up_attendees';

    con.query(query, (err, result) => {
        if (!err) {
            res.json({ data: result });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

// POST request to save new attendee
app.post('/api/attendees', (req, res) => {
    const { name, email, type } = req.body;
    
    if (!name || !email || !type) {   
        return res.status(400).json({ error: 'Name, email and type are required' });
    }
    
    const query = 'INSERT INTO Fill_up_attendees (Name, Email, Type) VALUES (?, ?, ?)';
    const values = [name, email, type];
    
    con.query(query, values, (err, result) => {
        if (!err) {
            res.json({  
                message: 'Attendee added successfully',
                id: result.insertId
            });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

// Legacy route for backward compatibility
app.get('/Fill_up_attendees', (req, res) => {
    const query = 'SELECT Name, Email, Type FROM Fill_up_attendees';

    con.query(query, (err, result) => {
        if (!err) {
            res.json({ data: result });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

app.post('/Fill_up_attendees', (req, res) => {
    const { name, email, type } = req.body;
    
    if (!name || !email || !type) {   
        return res.status(400).json({ error: 'Name, email and type are required' });
    }
    
    const query = 'INSERT INTO Fill_up_attendees (Name, Email, Type) VALUES (?, ?, ?)';
    const values = [name, email, type];
    
    con.query(query, values, (err, result) => {
        if (!err) {
            res.json({  
                message: 'Attendee added successfully',
            });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

const PORT = 4401;
app.listen(PORT, () => {
    console.log(`Attendees server running on port ${PORT}`);
});

module.exports = app;
