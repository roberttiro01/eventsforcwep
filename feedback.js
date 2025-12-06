const express = require('express');
const { pool } = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads (store under uploads/feedback)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../uploads/feedback');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'feedback-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Ensure feedback table exists with extended fields
const createFeedbackTable = () => {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS feedback (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NULL,
            phone VARCHAR(64) NULL,
            feedback_type VARCHAR(64) NULL,
            description TEXT NOT NULL,
            rating TINYINT NULL,
            recommend ENUM('yes','no') DEFAULT 'yes',
            contact_consent BOOLEAN DEFAULT FALSE,
            photo_path VARCHAR(500) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT FALSE,
            status ENUM('new', 'read', 'replied') DEFAULT 'new'
        )
    `;

    pool.query(createTableSQL, (err) => {
        if (err) {
            console.error('Error creating feedback table:', err);
        } else {
            console.log('Feedback table ready');
        }
    });
};

createFeedbackTable();

// POST /api/feedback - Submit a new feedback
const submitFeedback = (req, res) => {
    const {
        name,
        email = null,
        phone = null,
        feedbackType = null,
        description,
        rating = null,
        recommend = 'yes',
        contactConsent = 'false'
    } = req.body || {};

    if (!name || !description) {
        return res.status(400).json({ error: 'Name and description are required' });
    }

    let photoPath = null;
    if (req.file) {
        photoPath = `/uploads/feedback/${req.file.filename}`;
    }

    const query = `
        INSERT INTO feedback (name, email, phone, feedback_type, description, rating, recommend, contact_consent, photo_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Parse rating robustly: allow 0-5, preserve 0 if provided, null if empty
    let ratingVal = null;
    if (rating !== undefined && rating !== null && String(rating).trim() !== '') {
        const parsed = parseInt(String(rating), 10);
        if (!Number.isNaN(parsed)) {
            ratingVal = Math.max(0, Math.min(5, parsed));
        }
    }
    const consentVal = String(contactConsent).toLowerCase() === 'true';

    pool.query(
        query,
        [name, email, phone, feedbackType, description, ratingVal, recommend === 'no' ? 'no' : 'yes', consentVal, photoPath],
        (err, result) => {
            if (err) {
                console.error('Error saving feedback:', err);
                return res.status(500).json({ error: 'Failed to save feedback' });
            }
            return res.json({ success: true, message: 'Feedback submitted successfully', id: result.insertId });
        }
    );
};

// GET /api/feedback - Get all feedback (admin only)
const getFeedback = (req, res) => {
    const query = `
        SELECT 
            f.id, f.name, f.email, f.phone, f.feedback_type, f.description, f.rating, f.recommend, f.contact_consent, f.photo_path, f.created_at, f.is_read, f.status,
            EXISTS(SELECT 1 FROM testimonials t WHERE t.source_feedback_id = f.id) AS is_posted
        FROM feedback f
        ORDER BY f.created_at DESC
    `;
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching feedback:', err);
            return res.status(500).json({ error: 'Failed to fetch feedback' });
        }
        return res.json({ success: true, feedback: result });
    });
};

// GET /api/feedback/count - Get unread feedback count
const getFeedbackCount = (req, res) => {
    const query = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread
        FROM feedback
    `;
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching feedback count:', err);
            return res.status(500).json({ error: 'Failed to fetch feedback count' });
        }
        return res.json({ success: true, total: result[0].total, unread: result[0].unread });
    });
};

// PUT /api/feedback/:id/read - Mark feedback as read
const markAsRead = (req, res) => {
    const id = req.params.id;
    const query = `UPDATE feedback SET is_read = TRUE, status = 'read' WHERE id = ?`;
    pool.query(query, [id], (err, result) => {
        if (err) {
            console.error('Error marking feedback as read:', err);
            return res.status(500).json({ error: 'Failed to mark feedback as read' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        return res.json({ success: true, message: 'Feedback marked as read' });
    });
};

// PUT /api/feedback/read-all - Mark all feedback as read
const markAllAsRead = (req, res) => {
    const query = `UPDATE feedback SET is_read = TRUE, status = 'read' WHERE is_read = FALSE`;
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error marking all feedback as read:', err);
            return res.status(500).json({ error: 'Failed to mark all feedback as read' });
        }
        return res.json({ success: true, message: `${result.affectedRows} feedback marked as read` });
    });
};

// DELETE /api/feedback/:id - Delete a feedback (and any linked testimonials)
const deleteFeedback = (req, res) => {
    const id = req.params.id;
    const selectQuery = 'SELECT photo_path FROM feedback WHERE id = ?';
    pool.query(selectQuery, [id], (err, result) => {
        if (err) {
            console.error('Error fetching feedback for deletion:', err);
            return res.status(500).json({ error: 'Failed to fetch feedback' });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        const row = result[0];

        // First delete any testimonials linked to this feedback
        const deleteTestimonialsSql = 'DELETE FROM testimonials WHERE source_feedback_id = ?';
        pool.query(deleteTestimonialsSql, [id], (delTestErr) => {
            if (delTestErr) {
                console.error('Error deleting linked testimonials:', delTestErr);
                return res.status(500).json({ error: 'Failed to delete linked testimonials' });
            }

            // Then delete the feedback itself
            const deleteQuery = 'DELETE FROM feedback WHERE id = ?';
            pool.query(deleteQuery, [id], (delErr) => {
                if (delErr) {
                    console.error('Error deleting feedback:', delErr);
                    return res.status(500).json({ error: 'Failed to delete feedback' });
                }
                if (row.photo_path) {
                    const photoPath = path.join(__dirname, '..', row.photo_path);
                    fs.unlink(photoPath, (unlinkErr) => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                            console.error('Error deleting photo file:', unlinkErr);
                        }
                    });
                }
                return res.json({ success: true, message: 'Feedback and linked testimonials deleted successfully' });
            });
        });
    });
};

module.exports = {
    upload,
    submitFeedback,
    getFeedback,
    getFeedbackCount,
    markAsRead,
    markAllAsRead,
    deleteFeedback
};


