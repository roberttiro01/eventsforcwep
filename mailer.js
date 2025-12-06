const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql');
const multer = require('multer');

dotenv.config();

// Database connection for attendees
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
    console.log('Connected to MySQL database for attendees!');
});

const app = express();
const PORT = Number(process.env.MAILER_PORT) || 2000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 5MB.'
            });
        }
    }
    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({
            success: false,
            message: 'Only image files are allowed.'
        });
    }
    next(error);
});

// Route to send email (supports both JSON and FormData)
app.post('/send-email', upload.single('image'), async (req, res) => {
    const { to, subject, text, rsvpUrl } = req.body;
    const imageFile = req.file;

    try {
        // Validate required fields
        if (!to || !subject) {
            return res.status(400).json({ 
                success: false, 
                message: 'To and Subject are required' 
            });
        }
        // Prefer explicit SMTP settings via environment variables
        // If SMTP_SERVICE is provided (e.g., 'gmail'), service-based transport is used.
        // Otherwise, host/port/secure configuration is used.
        const {
            SMTP_SERVICE,
            SMTP_HOST,
            SMTP_PORT,
            SMTP_SECURE,
            SMTP_USER,
            SMTP_PASS,
            MAIL_FROM
        } = process.env;

        const useService = Boolean(SMTP_SERVICE);
        const transporter = nodemailer.createTransport(
            useService
                ? {
                    service: SMTP_SERVICE,
                    pool: true,
                    maxConnections: 5,
                    maxMessages: 100,
                    connectionTimeout: 15000,
                    socketTimeout: 30000,
                    auth: { user: SMTP_USER, pass: SMTP_PASS }
                }
                : {
                    host: SMTP_HOST || 'smtp.gmail.com',
                    port: SMTP_PORT ? Number(SMTP_PORT) : 465,
                    secure: typeof SMTP_SECURE === 'string' ? SMTP_SECURE === 'true' : true,
                    pool: true,
                    maxConnections: 5,
                    maxMessages: 100,
                    connectionTimeout: 15000,
                    socketTimeout: 30000,
                    auth: { user: SMTP_USER, pass: SMTP_PASS }
                }
        );

        // Verify SMTP connectivity proactively to avoid ECONNRESET mid-send
        await transporter.verify();

        // Email options
        const mailOptions = {
            from: MAIL_FROM || SMTP_USER,
            to,
            subject,
            text
        };

        // Add image attachment if provided
        if (imageFile) {
            mailOptions.attachments = [{
                filename: imageFile.originalname,
                content: imageFile.buffer,
                contentType: imageFile.mimetype
            }];
        }

        // Send mail
        const info = await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Email sent!', info });
    } catch (error) {
        console.error(error);
        const message =
            error && error.code === 'EAUTH'
                ? 'SMTP authentication failed. Check SMTP_USER/SMTP_PASS or use an app password.'
                : 'Failed to send email';
        res.status(500).json({ success: false, message, error: String(error && error.message || error) });
    }
});

// Route to verify SMTP configuration without sending an email
app.get('/verify-smtp', async (_req, res) => {
	try {
		const {
			SMTP_SERVICE,
			SMTP_HOST,
			SMTP_PORT,
			SMTP_SECURE,
			SMTP_USER,
			SMTP_PASS
		} = process.env;

		const useService = Boolean(SMTP_SERVICE);
		const transporter = nodemailer.createTransport(
			useService
				? { service: SMTP_SERVICE, auth: { user: SMTP_USER, pass: SMTP_PASS } }
				: {
					host: SMTP_HOST || 'smtp.gmail.com',
					port: SMTP_PORT ? Number(SMTP_PORT) : 465,
					secure: typeof SMTP_SECURE === 'string' ? SMTP_SECURE === 'true' : true,
					auth: { user: SMTP_USER, pass: SMTP_PASS }
				}
		);

		await transporter.verify();
		res.json({ success: true, message: 'SMTP configuration verified' });
	} catch (error) {
		console.error(error);
		res.status(500).json({ success: false, message: 'SMTP verification failed', error: String(error && error.message || error) });
	}
});

// Route to fetch attendees data
app.get('/api/attendees', (req, res) => {
    const query = 'SELECT Name, Email, Type FROM Fill_up_attendees ORDER BY Type, Name';

    con.query(query, (err, result) => {
        if (!err) {
            res.json({ data: result });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

// Route to send RSVP invitation email (supports both JSON and FormData)
app.post('/send-rsvp-invitation', upload.single('image'), async (req, res) => {
    const { to, subject, customMessage, rsvpUrl } = req.body;
    const imageFile = req.file;

    try {
        // Validate required fields
        if (!to || !subject) {
            return res.status(400).json({ 
                success: false, 
                message: 'To and Subject are required' 
            });
        }
        // Generate HTML email content
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Wedding RSVP Invitation</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9f9f9;
                }
                .container {
                    background: white;
                    border-radius: 12px;
                    padding: 30px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .header h1 {
                    color: #667eea;
                    font-size: 28px;
                    margin-bottom: 10px;
                    font-family: 'Playfair Display', serif;
                }
                .header p {
                    color: #666;
                    font-size: 16px;
                }
                .message {
                    margin-bottom: 30px;
                    font-size: 16px;
                    line-height: 1.8;
                }
                .cta-button {
                    display: inline-block;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 15px 30px;
                    text-decoration: none;
                    border-radius: 25px;
                    font-weight: 600;
                    font-size: 16px;
                    text-align: center;
                    margin: 20px 0;
                    transition: transform 0.3s ease;
                }
                .cta-button:hover {
                    transform: translateY(-2px);
                }
                .details {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .details h3 {
                    color: #667eea;
                    margin-bottom: 15px;
                }
                .footer {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                    color: #666;
                    font-size: 14px;
                }
                .rsvp-link {
                    word-break: break-all;
                    background: #f0f0f0;
                    padding: 10px;
                    border-radius: 5px;
                    font-family: monospace;
                    font-size: 12px;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>💒 Wedding RSVP</h1>
                    <p>You're invited to our special day!</p>
                </div>
                
                <div class="message">
                    ${customMessage || 'We would be honored to have you join us for our wedding celebration. Please RSVP using the form below to let us know if you\'ll be attending.'}
                </div>
                
                <div style="text-align: center;">
                    <a href="${rsvpUrl || 'http://localhost:5000/fill_up_attendees.html'}" class="cta-button">
                        RSVP Now
                    </a>
                </div>
                
                <div class="details">
                    <h3>RSVP Information</h3>
                    <p>Please click the button above or use the link below to access our RSVP form. You'll be able to:</p>
                    <ul>
                        <li>Enter your name and address</li>
                        <li>Select your guest type (Guest, VIP, Bridesmaid, Groomsmen, etc.)</li>
                        <li>Submit your attendance confirmation</li>
                    </ul>
                    
                    <div class="rsvp-link">
                        ${rsvpUrl || 'http://localhost:5000/fill_up_attendees.html'}
                    </div>
                </div>
                
                <div class="footer">
                    <p>Thank you for being part of our special day!</p>
                    <p><em>This is an automated invitation from our wedding RSVP system.</em></p>
                </div>
            </div>
        </body>
        </html>
        `;

        // Generate plain text version
        const textContent = `
Wedding RSVP Invitation

${customMessage || 'We would be honored to have you join us for our wedding celebration. Please RSVP using the form below to let us know if you\'ll be attending.'}

RSVP Link: ${rsvpUrl || 'http://localhost:5000/fill_up_attendees.html'}

RSVP Information:
- Enter your name and address
- Select your guest type (Guest, VIP, Bridesmaid, Groomsmen, etc.)
- Submit your attendance confirmation

Thank you for being part of our special day!

This is an automated invitation from our wedding RSVP system.
        `;

        // SMTP configuration
        const {
            SMTP_SERVICE,
            SMTP_HOST,
            SMTP_PORT,
            SMTP_SECURE,
            SMTP_USER,
            SMTP_PASS,
            MAIL_FROM
        } = process.env;

        const useService = Boolean(SMTP_SERVICE);
        const transporter = nodemailer.createTransport(
            useService
                ? {
                    service: SMTP_SERVICE,
                    pool: true,
                    maxConnections: 5,
                    maxMessages: 100,
                    connectionTimeout: 15000,
                    socketTimeout: 30000,
                    auth: { user: SMTP_USER, pass: SMTP_PASS }
                }
                : {
                    host: SMTP_HOST || 'smtp.gmail.com',
                    port: SMTP_PORT ? Number(SMTP_PORT) : 465,
                    secure: typeof SMTP_SECURE === 'string' ? SMTP_SECURE === 'true' : true,
                    pool: true,
                    maxConnections: 5,
                    maxMessages: 100,
                    connectionTimeout: 15000,
                    socketTimeout: 30000,
                    auth: { user: SMTP_USER, pass: SMTP_PASS }
                }
        );

        await transporter.verify();

        // Email options
        const mailOptions = {
            from: MAIL_FROM || SMTP_USER,
            to,
            subject: subject || 'Wedding RSVP Invitation',
            text: textContent,
            html: htmlContent
        };

        // Add image attachment if provided
        if (imageFile) {
            mailOptions.attachments = [{
                filename: imageFile.originalname,
                content: imageFile.buffer,
                contentType: imageFile.mimetype
            }];
        }

        // Send email
        const info = await transporter.sendMail(mailOptions);
        res.json({ 
            success: true, 
            message: 'RSVP invitation sent successfully!', 
            info 
        });

    } catch (error) {
        console.error(error);
        const message =
            error && error.code === 'EAUTH'
                ? 'SMTP authentication failed. Check SMTP_USER/SMTP_PASS or use an app password.'
                : 'Failed to send RSVP invitation';
        res.status(500).json({ success: false, message, error: String(error && error.message || error) });
    }
});

// Route to send attendees list via email
app.post('/send-attendees-email', async (req, res) => {
    const { to, subject, customMessage } = req.body;

    try {
        // Fetch attendees from database
        const query = 'SELECT Name, Email, Type FROM Fill_up_attendees ORDER BY Type, Name';
        
        con.query(query, async (err, attendees) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Failed to fetch attendees', error: err.message });
            }

            // Categorize attendees
            const categories = {
                'guest': 'Guests',
                'vip': 'VIPs',
                'flower_girl': 'Flower Girls',
                'bridesmaid': 'Bridesmaids',
                'groomsmen': 'Groomsmen',
                'maid_of_honor': 'Maid of Honor',
                'best_man': 'Best Man'
            };

            const categorized = {};
            Object.keys(categories).forEach(type => {
                categorized[type] = [];
            });

            attendees.forEach(attendee => {
                if (categorized[attendee.Type]) {
                    categorized[attendee.Type].push(attendee);
                }
            });

            // Generate email content
            let emailContent = customMessage || 'Here is the complete list of wedding attendees:\n\n';
            
            Object.keys(categories).forEach(type => {
                if (categorized[type].length > 0) {
                    emailContent += `\n${categories[type].toUpperCase()} (${categorized[type].length}):\n`;
                    emailContent += '='.repeat(categories[type].length + 10) + '\n';
                    
                    categorized[type].forEach(attendee => {
                        emailContent += `• ${attendee.Name} - ${attendee.Email}\n`;
                    });
                    emailContent += '\n';
                }
            });

            emailContent += `\nTotal Attendees: ${attendees.length}\n`;
            emailContent += '\n---\n';
            emailContent += 'This list was generated automatically from the wedding RSVP system.';

            // SMTP configuration
            const {
                SMTP_SERVICE,
                SMTP_HOST,
                SMTP_PORT,
                SMTP_SECURE,
                SMTP_USER,
                SMTP_PASS,
                MAIL_FROM
            } = process.env;

            const useService = Boolean(SMTP_SERVICE);
            const transporter = nodemailer.createTransport(
                useService
                    ? {
                        service: SMTP_SERVICE,
                        pool: true,
                        maxConnections: 5,
                        maxMessages: 100,
                        connectionTimeout: 15000,
                        socketTimeout: 30000,
                        auth: { user: SMTP_USER, pass: SMTP_PASS }
                    }
                    : {
                        host: SMTP_HOST || 'smtp.gmail.com',
                        port: SMTP_PORT ? Number(SMTP_PORT) : 465,
                        secure: typeof SMTP_SECURE === 'string' ? SMTP_SECURE === 'true' : true,
                        pool: true,
                        maxConnections: 5,
                        maxMessages: 100,
                        connectionTimeout: 15000,
                        socketTimeout: 30000,
                        auth: { user: SMTP_USER, pass: SMTP_PASS }
                    }
            );

            await transporter.verify();

            // Email options
            const mailOptions = {
                from: MAIL_FROM || SMTP_USER,
                to,
                subject: subject || 'Wedding Attendees List',
                text: emailContent
            };

            // Send email
            const info = await transporter.sendMail(mailOptions);
            res.json({ 
                success: true, 
                message: 'Attendees list sent successfully!', 
                attendeesCount: attendees.length,
                info 
            });
        });

    } catch (error) {
        console.error(error);
        const message =
            error && error.code === 'EAUTH'
                ? 'SMTP authentication failed. Check SMTP_USER/SMTP_PASS or use an app password.'
                : 'Failed to send attendees list';
        res.status(500).json({ success: false, message, error: String(error && error.message || error) });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
