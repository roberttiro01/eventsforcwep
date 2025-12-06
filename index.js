const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
// Note: dependent modules are required AFTER exporting the shared DB pool

// Database configuration
const dbConfig = {
    host: 'localhost',
    database: 'capstone',
    user: 'root',
    password: ''
};

// Create MySQL connection
const con = mysql.createConnection(dbConfig);

// Create a shared MySQL pool for this file (routes import from db.js to avoid cycles)
const pool = mysql.createPool({
    host: dbConfig.host,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

// Create event emitter for application events
const appEvents = new EventEmitter();

// Test database connection
con.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        appEvents.emit('db:error', err);
        return;
    }
    console.log('Connected to MySQL database successfully!');
    appEvents.emit('db:connected');
});

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_local_secret_change_me';

// Middleware
app.use(cors());
// Increase body size limits to allow larger page override payloads
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// After app and pool are initialized, require dependent route modules
// Legacy messages module no longer used
const feedback = require('./feedback');
const testimonials = require('./testimonials');
const pageOverrides = require('./page_overrides');
const packages = require('./packages');
const organizers = require('./organizers');

// Routes

// Home route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// --- Admin Authentication ---
// For demo purposes, use env or defaults. In production, store and hash in DB.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Check credentials against database
        const query = 'SELECT id, username, password FROM admin WHERE username = ?';
        
        con.query(query, [username], async (err, result) => {
            if (err) {
                console.error('Database error during login:', err);
                return res.status(500).json({ error: 'Login failed' });
            }

            if (result.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const admin = result[0];
            
            // Verify password using bcrypt
            const isPasswordValid = await bcrypt.compare(password, admin.password);
            
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Generate JWT token
            const expiresIn = rememberMe ? '7d' : '1d';
            const expiresAt = Date.now() + (rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);

            const token = jwt.sign({ sub: 'admin', username: admin.username, id: admin.id }, JWT_SECRET, { expiresIn });
            return res.json({ token, expiresAt, username: admin.username });
        });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Login failed' });
    }
});

function authenticateBearer(req, res, next) {
    const header = req.headers.authorization || '';
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = parts[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

app.get('/api/admin/me', authenticateBearer, (req, res) => {
    return res.json({ username: req.user.username, role: 'admin' });
});

// Messages API removed (migrated to Feedback)

// --- Feedback API ---
// Submit new feedback (public)
app.post('/api/feedback', feedback.upload.single('photo'), feedback.submitFeedback);
// Get all feedback (admin)
app.get('/api/feedback', authenticateBearer, feedback.getFeedback);
// Get feedback count (admin)
app.get('/api/feedback/count', authenticateBearer, feedback.getFeedbackCount);
// Mark as read (admin)
app.put('/api/feedback/:id/read', authenticateBearer, feedback.markAsRead);
// Mark all as read (admin)
app.put('/api/feedback/read-all', authenticateBearer, feedback.markAllAsRead);
// Delete feedback (admin)
app.delete('/api/feedback/:id', authenticateBearer, feedback.deleteFeedback);

// --- Testimonials API ---
// Post a message to testimonials (admin only)
app.post('/api/testimonials', authenticateBearer, testimonials.postToTestimonials);
// Post directly from feedback (admin only)
app.post('/api/testimonials/from-feedback', authenticateBearer, testimonials.postFromFeedback);

// Get all approved testimonials (public endpoint)
app.get('/api/testimonials', testimonials.getTestimonials);

// Get all testimonials for admin (admin only)
app.get('/api/testimonials/admin', authenticateBearer, testimonials.getTestimonialsAdmin);

// Approve a testimonial (admin only)
app.put('/api/testimonials/:id/approve', authenticateBearer, testimonials.approveTestimonial);

// Reject a testimonial (admin only)
app.put('/api/testimonials/:id/reject', authenticateBearer, testimonials.rejectTestimonial);

// Delete a testimonial (admin only)
app.delete('/api/testimonials/:id', authenticateBearer, testimonials.deleteTestimonial);

// Delete testimonials by names (admin only)
app.delete('/api/testimonials/by-name', authenticateBearer, testimonials.deleteByNames);

// Events summary: Month (derived), Date, Event_type, Couple_name
app.get('/api/events/summary', (req, res) => {
    const sql = `
        SELECT 
            Date AS event_date,
            MONTHNAME(STR_TO_DATE(Date, '%Y-%m-%d')) AS month_name,
            Choose_your_event AS event_type,
            Couple_name AS couple_name
        FROM book
        ORDER BY STR_TO_DATE(Date, '%Y-%m-%d') ASC
    `;

    con.query(sql, (err, result) => {
        if (err) {
            console.error('Failed to fetch events summary:', err);
            return res.status(500).json({ error: 'Failed to fetch events summary' });
        }

        const events = result.map(r => ({
            Month: r.month_name,
            Date: r.event_date,
            Event_type: r.event_type,
            Couple_name: r.couple_name
        }));

        return res.json({ events });
    });
});

// --- Packages API ---
// Get all packages (public endpoint)
app.get('/api/packages', packages.getAllPackages);

// Specific routes MUST come before the dynamic :id route
// Get active packages only (public endpoint)
app.get('/api/packages/active', packages.getActivePackages);

// Search packages (public endpoint)
app.get('/api/packages/search', packages.searchPackages);

// Get packages by price range (public endpoint)
app.get('/api/packages/price-range', packages.getPackagesByPriceRange);

// Get package statistics (public endpoint)
app.get('/api/packages/stats', packages.getPackageStats);

// Delete packages by exact price (admin only) - MUST COME BEFORE dynamic :id route
app.delete('/api/packages/by-price', authenticateBearer, packages.deletePackageByPrice);

// Get single package by ID (public endpoint)
app.get('/api/packages/:id', packages.getPackageById);

// Create new package (admin only)
app.post('/api/packages', authenticateBearer, packages.createPackage);

// Update package (admin only)
app.put('/api/packages/:id', authenticateBearer, packages.updatePackage);

// Delete package (admin only)
app.delete('/api/packages/:id', authenticateBearer, packages.deletePackage);

// --- Organizers API ---
// Public list
app.get('/api/organizers', organizers.listOrganizers);
// Admin mutations
app.post('/api/organizers', authenticateBearer, organizers.createOrganizer);
app.put('/api/organizers/:index', authenticateBearer, organizers.updateOrganizer);
app.delete('/api/organizers/:index', authenticateBearer, organizers.deleteOrganizer);
app.delete('/api/organizers/by-name', authenticateBearer, organizers.deleteByName);

// --- Page Overrides API (admin only for mutations) ---
app.get('/api/page-overrides/:page', pageOverrides.getOverride);
app.put('/api/page-overrides/:page', authenticateBearer, pageOverrides.setOverride);
app.delete('/api/page-overrides/:page', authenticateBearer, pageOverrides.clearOverride);
app.post('/api/page-overrides/upload', authenticateBearer, pageOverrides.upload.single('image'), pageOverrides.uploadImageHandler);

// GET request to fetch attendees
app.get('/api/attendees', (req, res) => {
    const query = 'SELECT Name, Email, Type FROM Fill_up_attendees';

    con.query(query, (err, result) => {
        if (!err) {
            appEvents.emit('attendee:fetched', { count: result.length });
            res.json({ data: result });
        } else {
            appEvents.emit('attendee:error', { error: err.message, action: 'fetch' });
            res.status(500).json({ error: err.message });
        }
    });
});

// POST request to save new attendee
app.post('/api/attendees', (req, res) => {
    const { name, email, type } = req.body;
    
    if (!name || !email || !type) {   
        appEvents.emit('attendee:validation_error', { missing: { name: !name, email: !email, type: !type } });
        return res.status(400).json({ error: 'Name, email and type are required' });
    }
    
    const query = 'INSERT INTO Fill_up_attendees (Name, Email, Type) VALUES (?, ?, ?)';
    const values = [name, email, type];
    
    con.query(query, values, (err, result) => {
        if (!err) {
            appEvents.emit('attendee:created', { id: result.insertId, name, type });
            res.json({  
                message: 'Attendee added successfully',
                id: result.insertId
            });
        } else {
            appEvents.emit('attendee:error', { error: err.message, action: 'create', data: { name, type } });
            res.status(500).json({ error: err.message });
        }
    });
});

// Legacy route for backward compatibility
app.get('/Fill_up_attendees', (req, res) => {
    const query = 'SELECT Name, Email, Type FROM Fill_up_attendees';

    con.query(query, (err, result) => {
        if (!err) {
            appEvents.emit('attendee:fetched_legacy', { count: result.length });
            res.json({ data: result });
        } else {
            appEvents.emit('attendee:error', { error: err.message, action: 'fetch_legacy' });
            res.status(500).json({ error: err.message });
        }
    });
});

app.post('/Fill_up_attendees', (req, res) => {
    const { name, email, type } = req.body;
    
    if (!name || !email || !type) {   
        appEvents.emit('attendee:validation_error_legacy', { missing: { name: !name, email: !email, type: !type } });
        return res.status(400).json({ error: 'Name, email and type are required' });
    }
    
    const query = 'INSERT INTO Fill_up_attendees (Name, Email, Type) VALUES (?, ?, ?)';
    const values = [name, email, type];
    
    con.query(query, values, (err, result) => {
        if (!err) {
            appEvents.emit('attendee:created_legacy', { id: result.insertId, name, type });
            res.json({  
                message: 'Attendee added successfully',
            });
        } else {
            appEvents.emit('attendee:error', { error: err.message, action: 'create_legacy', data: { name, type } });
            res.status(500).json({ error: err.message });
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    appEvents.emit('health:check', { timestamp: new Date().toISOString() });
    // Try a lightweight pool getConnection to infer status
    pool.getConnection((err, connection) => {
        const dbStatus = err ? 'disconnected' : 'connected';
        if (connection) connection.release();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: dbStatus
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    appEvents.emit('error:unhandled', { error: err.message, stack: err.stack, url: req.url });
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    appEvents.emit('error:not_found', { url: req.url, method: req.method });
    res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
    appEvents.emit('server:started', { port: PORT, timestamp: new Date().toISOString() });
});

// Event listeners for application monitoring
appEvents.on('db:connected', () => {
    console.log('✅ Database connection established');
});

appEvents.on('db:error', (err) => {
    console.error('❌ Database connection error:', err.message);
});

appEvents.on('attendee:created', (data) => {
    console.log(`✅ Attendee created: ${data.name} (ID: ${data.id})`);
});

appEvents.on('attendee:fetched', (data) => {
    console.log(`📋 Fetched ${data.count} attendees`);
});

appEvents.on('attendee:error', (data) => {
    console.error(`❌ Attendee operation error (${data.action}):`, data.error);
});

appEvents.on('attendee:validation_error', (data) => {
    console.warn(`⚠️ Validation error: Missing fields:`, data.missing);
});

appEvents.on('health:check', (data) => {
    console.log(`🏥 Health check performed at ${data.timestamp}`);
});

appEvents.on('error:unhandled', (data) => {
    console.error(`💥 Unhandled error on ${data.url}:`, data.error);
});

appEvents.on('error:not_found', (data) => {
    console.warn(`🔍 404 Not Found: ${data.method} ${data.url}`);
});

appEvents.on('server:started', (data) => {
    console.log(`🚀 Server started successfully on port ${data.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    appEvents.emit('server:shutdown', { signal: 'SIGTERM', timestamp: new Date().toISOString() });
    con.end();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    appEvents.emit('server:shutdown', { signal: 'SIGINT', timestamp: new Date().toISOString() });
    con.end();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    appEvents.emit('error:uncaught', { error: err.message, stack: err.stack });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    appEvents.emit('error:unhandled_rejection', { reason: reason.toString(), promise: promise.toString() });
});

module.exports.app = app;
