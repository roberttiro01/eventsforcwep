// Reset Admin Password Server
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');

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

// Serve static files so the HTML can be opened via http://localhost:3301/reset_password.html
app.use(express.static(path.join(__dirname, '..')));

// Admin credentials (matching the main index.js)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// GET route to serve the reset password page
app.get('/reset_password', (req, res) => {
    res.sendFile(path.join(__dirname, '../reset_password.html'));
});

// POST route to handle password reset
app.post('/api/reset-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate input
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ 
                error: 'All fields are required' 
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                error: 'New password and confirm password do not match' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                error: 'New password must be at least 6 characters long' 
            });
        }

        // Get current admin password from database
        const getCurrentPasswordQuery = 'SELECT password FROM admin WHERE username = ?';
        
        con.query(getCurrentPasswordQuery, [ADMIN_USERNAME], async (err, result) => {
            if (err) {
                console.error('Error fetching current password:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (result.length === 0) {
                return res.status(404).json({ error: 'Admin not found' });
            }

            const storedPassword = result[0].password;

            // Verify current password
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, storedPassword);
            
            if (!isCurrentPasswordValid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Hash new password
            const saltRounds = 10;
            const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

            // Update password in database
            const updatePasswordQuery = 'UPDATE admin SET password = ? WHERE username = ?';
            
            con.query(updatePasswordQuery, [hashedNewPassword, ADMIN_USERNAME], (err, result) => {
                if (err) {
                    console.error('Error updating password:', err);
                    return res.status(500).json({ error: 'Failed to update password' });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Admin not found' });
                }

                return res.json({ 
                    success: true, 
                    message: 'Password updated successfully' 
                });
            });
        });

    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET route to check if admin exists (for testing)
app.get('/api/admin-exists', (req, res) => {
    const query = 'SELECT id, username FROM admin WHERE username = ?';
    
    con.query(query, [ADMIN_USERNAME], (err, result) => {
        if (err) {
            console.error('Error checking admin:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.length === 0) {
            return res.json({ exists: false, message: 'No admin found' });
        }

        return res.json({ 
            exists: true, 
            admin: { id: result[0].id, username: result[0].username },
            message: 'Admin user found in database'
        });
    });
});

// Start server
const PORT = 3301;
app.listen(PORT, () => {
    console.log(`Reset Password Server running on port ${PORT}`);
    console.log(`Access the reset password page at: http://localhost:${PORT}/reset_password`);
});

module.exports = app;
