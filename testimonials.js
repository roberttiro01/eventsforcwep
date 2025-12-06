const express = require('express');
const { pool, dbConfig } = require('./db');

// Use shared pool

// Test database connection
pool.getConnection((err, conn) => {
    if (err) {
        console.error('Error connecting to database in testimonials.js:', err);
        return;
    }
    conn.release();
    console.log('Testimonials module connected to MySQL database successfully!');
});

// Create testimonials table if it doesn't exist and ensure schema is up to date
const createTestimonialsTable = () => {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS testimonials (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            photo_path VARCHAR(500) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_approved BOOLEAN DEFAULT TRUE,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved'
        )
    `;
    
    pool.query(createTableSQL, (err) => {
        if (err) {
            console.error('Error creating testimonials table:', err);
        } else {
            console.log('Testimonials table ready');
            // Ensure source_message_id exists for cascading deletes
            const alterSQL = `
                ALTER TABLE testimonials 
                ADD COLUMN IF NOT EXISTS source_message_id INT NULL,
                ADD INDEX IF NOT EXISTS idx_source_message_id (source_message_id)
            `;
            pool.query(alterSQL, (alterErr) => {
                if (alterErr) {
                    // Some older MySQL versions don't support IF NOT EXISTS for ADD COLUMN.
                    // Try a safe fallback: check column existence first.
                    if (alterErr.code === 'ER_PARSE_ERROR') {
                        const checkColSQL = `
                            SELECT COUNT(*) AS cnt 
                            FROM information_schema.COLUMNS 
                            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'testimonials' AND COLUMN_NAME = 'source_message_id'
                        `;
                        pool.query(checkColSQL, [dbConfig.database], (checkErr, rows) => {
                            if (!checkErr && rows && rows[0] && rows[0].cnt === 0) {
                                pool.query('ALTER TABLE testimonials ADD COLUMN source_message_id INT NULL', (addErr) => {
                                    if (addErr) {
                                        console.error('Error adding source_message_id column:', addErr);
                                    }
                                    // attempt backfill after ensuring column
                                    backfillSourceMessageId();
                                });
                            } else {
                                backfillSourceMessageId();
                            }
                        });
                    } else {
                        console.error('Error altering testimonials table:', alterErr);
                        backfillSourceMessageId();
                    }
                } else {
                    // Column and index created; perform backfill
                    backfillSourceMessageId();
                }
            });

            // Ensure rating column exists for star rendering
            const alterRatingSQL = `
                ALTER TABLE testimonials
                ADD COLUMN IF NOT EXISTS rating TINYINT NULL
            `;
            pool.query(alterRatingSQL, (alterErrRating) => {
                if (alterErrRating && alterErrRating.code === 'ER_PARSE_ERROR') {
                    // Fallback for MySQL versions without IF NOT EXISTS support
                    const checkRatingColSQL = `
                        SELECT COUNT(*) AS cnt
                        FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'testimonials' AND COLUMN_NAME = 'rating'
                    `;
                    pool.query(checkRatingColSQL, [dbConfig.database], (checkErrR, rowsR) => {
                        if (!checkErrR && rowsR && rowsR[0] && rowsR[0].cnt === 0) {
                            pool.query('ALTER TABLE testimonials ADD COLUMN rating TINYINT NULL', (addErrR) => {
                                if (addErrR) {
                                    console.error('Error adding rating column:', addErrR);
                                }
                            });
                        }
                    });
                } else if (alterErrRating && alterErrRating.code) {
                    console.warn('Alter rating warning:', alterErrRating.message || alterErrRating.code);
                }
            });

            // Ensure source_feedback_id exists to prevent duplicate posting from feedback
            const alterFeedbackColSQL = `
                ALTER TABLE testimonials 
                ADD COLUMN IF NOT EXISTS source_feedback_id INT NULL,
                ADD INDEX IF NOT EXISTS idx_source_feedback_id (source_feedback_id)
            `;
            pool.query(alterFeedbackColSQL, (alterErr2) => {
                if (alterErr2 && alterErr2.code !== 'ER_PARSE_ERROR') {
                    console.warn('Alter source_feedback_id warning:', alterErr2.message);
                }
                if (alterErr2 && alterErr2.code === 'ER_PARSE_ERROR') {
                    // Fallback for MySQL without IF NOT EXISTS
                    const checkColSQL2 = `
                        SELECT COUNT(*) AS cnt 
                        FROM information_schema.COLUMNS 
                        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'testimonials' AND COLUMN_NAME = 'source_feedback_id'
                    `;
                    pool.query(checkColSQL2, [dbConfig.database], (checkErr2, rows2) => {
                        if (!checkErr2 && rows2 && rows2[0] && rows2[0].cnt === 0) {
                            pool.query('ALTER TABLE testimonials ADD COLUMN source_feedback_id INT NULL', (addErr2) => {
                                if (addErr2) {
                                    console.error('Error adding source_feedback_id column:', addErr2);
                                }
                            });
                        }
                    });
                }
            });
        }
    });
};

// Backfill helper: link existing testimonials to messages by matching name/message/photo
function backfillSourceMessageId() {
    const backfillSQL = `
        UPDATE testimonials t
        JOIN messages m
          ON t.source_message_id IS NULL
         AND t.name = m.name
         AND t.message = m.description
         AND (t.photo_path <=> m.photo_path)
        SET t.source_message_id = m.id
    `;
    pool.query(backfillSQL, (err, result) => {
        if (err) {
            console.warn('Backfill of source_message_id skipped/failed:', err.code || err.message);
            return;
        }
        if (result && typeof result.affectedRows === 'number') {
            console.log(`Backfilled source_message_id for ${result.affectedRows} testimonial(s).`);
        }
    });
}

// Initialize table
createTestimonialsTable();

// POST /api/testimonials - Post a message to testimonials (admin only)
const postToTestimonials = (req, res) => {
    const { messageId } = req.body;
    
    if (!messageId) {
        return res.status(400).json({ 
            error: 'Message ID is required' 
        });
    }

    // First, get the message details
    const getMessageQuery = `
        SELECT name, description, photo_path 
        FROM messages 
        WHERE id = ?
    `;
    
    pool.query(getMessageQuery, [messageId], (err, messageResult) => {
        if (err) {
            console.error('Error fetching message:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch message' 
            });
        }

        if (messageResult.length === 0) {
            return res.status(404).json({ 
                error: 'Message not found' 
            });
        }

        const message = messageResult[0];

        // Insert into testimonials
        const insertTestimonialQuery = `
            INSERT INTO testimonials (name, message, photo_path, source_message_id) 
            VALUES (?, ?, ?, ?)
        `;
        
        pool.query(insertTestimonialQuery, [message.name, message.description, message.photo_path, messageId], (err, result) => {
            if (err) {
                console.error('Error posting to testimonials:', err);
                return res.status(500).json({ 
                    error: 'Failed to post to testimonials' 
                });
            }

            // Mark the original message as read
            const markReadQuery = `
                UPDATE messages 
                SET is_read = TRUE, status = 'read' 
                WHERE id = ?
            `;
            
            pool.query(markReadQuery, [messageId], (err) => {
                if (err) {
                    console.error('Error marking message as read:', err);
                    // Don't fail the request, just log the error
                }
            });

            res.json({
                success: true,
                message: 'Message posted to testimonials successfully',
                testimonialId: result.insertId
            });
        });
    });
};

// GET /api/testimonials - Get all approved testimonials (public endpoint)
const getTestimonials = (req, res) => {
    const query = `
        SELECT id, name, message, photo_path, created_at, rating
        FROM testimonials 
        WHERE (status = 'approved' OR status IS NULL OR is_approved = TRUE)
        ORDER BY created_at DESC
    `;
    
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching testimonials:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch testimonials' 
            });
        }

        res.json({
            success: true,
            testimonials: result
        });
    });
};

// GET /api/testimonials/admin - Get all testimonials for admin (admin only)
const getTestimonialsAdmin = (req, res) => {
    const query = `
        SELECT id, name, message, photo_path, created_at, status, is_approved, rating
        FROM testimonials 
        ORDER BY created_at DESC
    `;
    
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching testimonials for admin:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch testimonials' 
            });
        }

        res.json({
            success: true,
            testimonials: result
        });
    });
};

// PUT /api/testimonials/:id/approve - Approve a testimonial (admin only)
const approveTestimonial = (req, res) => {
    const testimonialId = req.params.id;
    
    const query = `
        UPDATE testimonials 
        SET status = 'approved', is_approved = TRUE 
        WHERE id = ?
    `;
    
    pool.query(query, [testimonialId], (err, result) => {
        if (err) {
            console.error('Error approving testimonial:', err);
            return res.status(500).json({ 
                error: 'Failed to approve testimonial' 
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                error: 'Testimonial not found' 
            });
        }

        res.json({
            success: true,
            message: 'Testimonial approved successfully'
        });
    });
};

// PUT /api/testimonials/:id/reject - Reject a testimonial (admin only)
const rejectTestimonial = (req, res) => {
    const testimonialId = req.params.id;
    
    const query = `
        UPDATE testimonials 
        SET status = 'rejected', is_approved = FALSE 
        WHERE id = ?
    `;
    
    pool.query(query, [testimonialId], (err, result) => {
        if (err) {
            console.error('Error rejecting testimonial:', err);
            return res.status(500).json({ 
                error: 'Failed to reject testimonial' 
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                error: 'Testimonial not found' 
            });
        }

        res.json({
            success: true,
            message: 'Testimonial rejected successfully'
        });
    });
};

// DELETE /api/testimonials/:id - Delete a testimonial (admin only)
const deleteTestimonial = (req, res) => {
    const testimonialId = req.params.id;
    
    const query = 'DELETE FROM testimonials WHERE id = ?';
    
    pool.query(query, [testimonialId], (err, result) => {
        if (err) {
            console.error('Error deleting testimonial:', err);
            return res.status(500).json({ 
                error: 'Failed to delete testimonial' 
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                error: 'Testimonial not found' 
            });
        }

        res.json({
            success: true,
            message: 'Testimonial deleted successfully'
        });
    });
};

module.exports = {
    postToTestimonials,
    // Create a testimonial directly from a feedback row (admin only)
    postFromFeedback: (req, res) => {
        const { feedbackId } = req.body || {};
        if (!feedbackId) {
            return res.status(400).json({ error: 'feedbackId is required' });
        }
        // Prevent duplicates: if there's already a testimonial linked to this feedback, block
        const existsSql = 'SELECT id FROM testimonials WHERE source_feedback_id = ? LIMIT 1';
        pool.query(existsSql, [feedbackId], (existsErr, existing) => {
            if (existsErr) {
                console.error('Error checking existing testimonial:', existsErr);
                return res.status(500).json({ error: 'Failed to check existing testimonial' });
            }
            if (Array.isArray(existing) && existing.length > 0) {
                return res.status(409).json({ error: 'Feedback already posted to testimonials' });
            }

            const getFeedbackSQL = `
                SELECT name, description, photo_path, rating
                FROM feedback
                WHERE id = ?
            `;
            pool.query(getFeedbackSQL, [feedbackId], (err, rows) => {
                if (err) {
                    console.error('Error fetching feedback:', err);
                    return res.status(500).json({ error: 'Failed to fetch feedback' });
                }
                if (!rows || rows.length === 0) {
                    return res.status(404).json({ error: 'Feedback not found' });
                }
                const fb = rows[0];
                const insertSql = `
                    INSERT INTO testimonials (name, message, photo_path, rating, source_feedback_id)
                    VALUES (?, ?, ?, ?, ?)
                `;
                // Normalize rating into 0..5 or null
                let ratingVal = null;
                if (fb.rating !== undefined && fb.rating !== null) {
                    const parsed = parseInt(String(fb.rating), 10);
                    if (!Number.isNaN(parsed)) {
                        ratingVal = Math.max(0, Math.min(5, parsed));
                    }
                }
                pool.query(insertSql, [fb.name, fb.description, fb.photo_path, ratingVal, feedbackId], (insErr, result) => {
                    if (insErr) {
                        console.error('Error creating testimonial from feedback:', insErr);
                        return res.status(500).json({ error: 'Failed to create testimonial' });
                    }
                    return res.json({ success: true, testimonialId: result.insertId });
                });
            });
        });
    },
    getTestimonials,
    getTestimonialsAdmin,
    approveTestimonial,
    rejectTestimonial,
    deleteTestimonial,
    // Admin helper to delete by names (bulk)
    deleteByNames: (req, res) => {
        try {
            const body = req.body || {};
            let names = body.names || body.name || [];
            if (typeof names === 'string') {
                names = [names];
            }
            if (!Array.isArray(names) || names.length === 0) {
                return res.status(400).json({ error: 'Provide names array or name string' });
            }
            const trimmed = names.map(n => String(n).trim()).filter(n => n.length > 0);
            if (trimmed.length === 0) {
                return res.status(400).json({ error: 'No valid names provided' });
            }
            const placeholders = trimmed.map(() => '?').join(',');
            const sql = `DELETE FROM testimonials WHERE name IN (${placeholders})`;
            pool.query(sql, trimmed, (err, result) => {
                if (err) {
                    console.error('Error deleting testimonials by names:', err);
                    return res.status(500).json({ error: 'Failed to delete testimonials by names' });
                }
                return res.json({ success: true, deleted: result.affectedRows });
            });
        } catch (e) {
            console.error('Unhandled error in deleteByNames:', e);
            return res.status(500).json({ error: 'Failed to delete testimonials by names' });
        }
    }
};
