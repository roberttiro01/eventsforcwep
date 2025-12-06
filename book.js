const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

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
    // Ensure Payment_status column exists (best-effort)
    try {
        const alterSql = "ALTER TABLE book ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NULL";
        con.query(alterSql, (aErr) => {
            if (aErr) {
                console.warn('Payment_status column check warning:', aErr.message);
            }
        });
    } catch (schemaErr) {
        console.warn('Payment_status column initialization skipped:', schemaErr.message);
    }
});

// (Removed) Secondary payments database connection

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

// (Removed) Downpayment column management

// In-memory store for booking status (for demo purposes)
const bookingStatusStore = new Map();

// In-memory store for pending email verifications
const pendingVerifications = new Map();
// In-memory store for packages OTP verifications
const pendingPackageOtps = new Map();

// (Removed) in-memory store for downpayment amounts awaiting DB row creation

// History module (records deletions of pending clients)
const history = require('./history');
// Ensure history table and routes are set up
history.ensureHistoryTable(con);
history.attachHistoryRoutes(app, con);

// Email configuration
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 15000,
    socketTimeout: 30000,
    auth: {
        user: process.env.SMTP_USER || 'your-email@gmail.com',
        pass: process.env.SMTP_PASS || 'your-app-password'
    }
});

// Email templates
const emailTemplates = {
    emailVerification: (bookingData, verificationToken) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px;">Email Verification Required</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                <h2 style="color: #7d0d24; margin-top: 0;">Hello ${bookingData.fullname}!</h2>
                
                <p>We received a booking request with your email address. Please confirm that this booking is from you:</p>
                
                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7d0d24;">
                    <h3 style="color: #7d0d24; margin-top: 0;">Booking Details:</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; font-weight: bold;">Event Type:</td><td style="padding: 8px 0;">${bookingData.eventtype || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Date:</td><td style="padding: 8px 0;">${bookingData.date}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td style="padding: 8px 0;">${bookingData.time}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Theme:</td><td style="padding: 8px 0;">${bookingData.theme || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Budget:</td><td style="padding: 8px 0;">₱${parseFloat(bookingData.budget).toLocaleString()}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Guests:</td><td style="padding: 8px 0;">${bookingData.guests || 'N/A'}</td></tr>
                    </table>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <p style="font-size: 18px; font-weight: bold; color: #7d0d24;">Is this booking from you?</p>
                    
                    <div style="margin: 20px 0;">
                        <a href="http://localhost:4400/verify-booking?token=${verificationToken}&action=confirm" 
                           style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; font-size: 16px;">
                             YES, IT'S ME
                        </a>
                    </div>                    
                    <div style="margin: 20px 0;">
                        <a href="http://localhost:4400/verify-booking?token=${verificationToken}&action=deny" 
                           style="display: inline-block; background: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; font-size: 16px;">
                             NO, IT'S NOT ME
                        </a>
                    </div>
                </div>
                
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffeaa7;">
                    <p style="margin: 0; color: #856404;"><strong>⚠️ Important:</strong></p>
                    <p style="margin: 5px 0 0 0; color: #856404;">This verification link will expire in 24 hours. If you don't confirm, the booking will be automatically cancelled.</p>
                </div>
                
                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #1565c0;"><strong>Contact Information:</strong></p>
                    <p style="margin: 5px 0 0 0; color: #1565c0;">Phone: 09876356425 | Email: cwep@example.com</p>
                </div>
                
                <p style="color: #666; font-size: 14px;">Thank you for choosing CWEP Event Planning!</p>
            </div>
        </div>
    `,
    
    bookingConfirmation: (bookingData) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px;">Booking Confirmation</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                <h2 style="color: #7d0d24; margin-top: 0;">Hello ${bookingData.fullname}!</h2>
                
                <p>Thank you for choosing CWEP for your event planning needs. We have received your booking request and it is currently <strong style="color: #2c62d6;">PENDING APPROVAL</strong>.</p>
                
                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7d0d24;">
                    <h3 style="color: #7d0d24; margin-top: 0;">Booking Details:</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; font-weight: bold;">Event Type:</td><td style="padding: 8px 0;">${bookingData.eventtype || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Date:</td><td style="padding: 8px 0;">${bookingData.date}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td style="padding: 8px 0;">${bookingData.time}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Theme:</td><td style="padding: 8px 0;">${bookingData.theme || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Budget:</td><td style="padding: 8px 0;">₱${parseFloat(bookingData.budget).toLocaleString()}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Guests:</td><td style="padding: 8px 0;">${bookingData.guests || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 0; font-weight: bold;">Reception:</td><td style="padding: 8px 0;">${bookingData.reception || 'N/A'}</td></tr>
                    </table>
                </div>
                
                <p><strong>What happens next?</strong></p>
                <ul style="color: #666;">
                    <li>Our team will review your booking request</li>
                    <li>You will receive an email confirmation once approved</li>
                    <li>We may contact you for additional details if needed</li>
                </ul>
                
                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #1565c0;"><strong>Contact Information:</strong></p>
                    <p style="margin: 5px 0 0 0; color: #1565c0;">Phone: 09876356425 | Email: cwep@example.com</p>
                </div>
                
                <p style="color: #666; font-size: 14px;">Thank you for choosing CWEP Event Planning!</p>
            </div>
        </div>
    `,
    
    statusUpdate: (bookingData, newStatus) => {
        const statusColors = {
            'accepted': '#168a3b',
            'cancelled': '#dc2626',
            'pending': '#2c62d6'
        };
        
        const statusMessages = {
            'accepted': 'Your booking is accepted. For more information and updates, please visit us at our location or contact us via call/text/email/Messenger.',
            'cancelled': 'Your booking has been cancelled. Please contact us if you have any questions.',
            'pending': 'Your booking status has been updated to pending.'
        };
        
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">Booking Status Update</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #7d0d24; margin-top: 0;">Hello ${bookingData.fullname}!</h2>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <h3 style="color: ${statusColors[newStatus]}; margin-top: 0; text-transform: uppercase;">Status: ${newStatus}</h3>
                        <p style="color: #666;">${statusMessages[newStatus]}</p>
                    </div>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7d0d24;">
                        <h3 style="color: #7d0d24; margin-top: 0;">Booking Details:</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr><td style="padding: 8px 0; font-weight: bold;">Event Type:</td><td style="padding: 8px 0;">${bookingData.eventtype || 'N/A'}</td></tr>
                            <tr><td style="padding: 8px 0; font-weight: bold;">Date:</td><td style="padding: 8px 0;">${bookingData.date}</td></tr>
                            <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td style="padding: 8px 0;">${bookingData.time}</td></tr>
                            <tr><td style="padding: 8px 0; font-weight: bold;">Budget:</td><td style="padding: 8px 0;">₱${parseFloat(bookingData.budget).toLocaleString()}</td></tr>
                        </table>
                    </div>
                    
                    ${String(newStatus) === 'accepted' ? `
                    <div style="background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e9ecef;">
                        <h3 style="color: #168a3b; margin-top: 0;">Next steps</h3>
                        <p style="color: #444;">Your booking is accepted. For more information and updates, please visit us or reach out through any of the following:</p>
                        <ul style="color: #444; line-height: 1.6; padding-left: 18px;">
                            <li><strong>Visit us:</strong> CWEP Office, 123 Event Ave, City</li>
                            <li><strong>Call/Text:</strong> 0987 635 6425</li>
                            <li><strong>Email:</strong> cwep@example.com</li>
                            <li><strong>Messenger:</strong> facebook.com/messages/t/cwep (CWEP Event Planning)</li>
                        </ul>
                    </div>
                    ` : ''}
                    
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #1565c0;"><strong>Contact Information:</strong></p>
                        <p style="margin: 5px 0 0 0; color: #1565c0;">Phone: 09876356425 | Email: cwep@example.com</p>
                    </div>
                    
                    <p style="color: #666; font-size: 14px;">Thank you for choosing CWEP Event Planning!</p>
                </div>
            </div>
        `;
    }
};

// Packages-specific verification email template
emailTemplates.packagesVerification = (bookingData, verificationToken) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Verify Your Package Selection</p>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #7d0d24; margin-top: 0;">Hello ${bookingData.fullname}!</h2>
            <p>We received a package booking request with the details below. Please confirm to proceed.</p>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7d0d24;">
                <h3 style="color: #7d0d24; margin-top: 0;">Package Booking Details:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px 0; font-weight: bold;">Package:</td><td style="padding: 8px 0;">${bookingData.eventtype || 'N/A'}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Venue:</td><td style="padding: 8px 0;">${bookingData.reception || 'N/A'}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Date:</td><td style="padding: 8px 0;">${bookingData.date}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td style="padding: 8px 0;">${bookingData.time}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Budget:</td><td style="padding: 8px 0;">₱${parseFloat(bookingData.budget).toLocaleString()}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Downpayment:</td><td style="padding: 8px 0;">${bookingData.downpayment ? '₱' + parseFloat(bookingData.downpayment).toLocaleString() : 'N/A'}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Guests:</td><td style="padding: 8px 0;">${bookingData.guests || 'N/A'}</td></tr>
                </table>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <p style="font-size: 18px; font-weight: bold; color: #7d0d24;">Confirm this package booking?</p>
                <div style="margin: 20px 0;">
                    <a href="http://localhost:4400/verify-booking?token=${verificationToken}&action=confirm" 
                       style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; font-size: 16px;">
                         YES, CONFIRM
                    </a>
                </div>
                <div style="margin: 20px 0;">
                    <a href="http://localhost:4400/verify-booking?token=${verificationToken}&action=deny" 
                       style="display: inline-block; background: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; font-size: 16px;">
                         DENY REQUEST
                    </a>
                </div>
            </div>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffeaa7;">
                <p style="margin: 0; color: #856404;"><strong>⚠️ Note:</strong> This link expires in 24 hours.</p>
            </div>
        </div>
    </div>
`;

// Packages OTP email template
emailTemplates.packageOtp = (bookingData, otpCode) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px;">
            <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Your One-Time Verification Code</p>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${bookingData.fullname || 'Guest'},</p>
            <p>Use the following code to verify your package booking:</p>
            <div style="text-align:center; margin: 20px 0;">
                <div style="display:inline-block; font-size: 30px; letter-spacing: 6px; font-weight: 800; color: #7d0d24; background:#fff; padding: 12px 18px; border: 1px solid #e9ecef; border-radius: 8px;">${otpCode}</div>
            </div>
            <p style="color:#666;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
    </div>
`;

// Function to verify email configuration
async function verifyEmailConfig() {
    try {
        await emailTransporter.verify();
        console.log('Email configuration verified successfully');
        return { success: true, message: 'Email configuration is valid' };
    } catch (error) {
        console.error('Email configuration verification failed:', error);
        return { success: false, error: error.message };
    }
}

// Function to send email
async function sendEmail(to, subject, htmlContent) {
    try {
        // First verify the email configuration
        const verification = await verifyEmailConfig();
        if (!verification.success) {
            console.error('Email configuration verification failed, cannot send email');
            return { success: false, error: 'Email configuration invalid: ' + verification.error };
        }

        const mailOptions = {
            from: process.env.SMTP_USER || 'your-email@gmail.com',
            to: to,
            subject: subject,
            html: htmlContent
        };
        
        const info = await emailTransporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
}

function buildBookingKey(booking) {
    const { Full_name, Email, Date, Time } = booking;
    return `${Full_name}-${Email}-${Date}-${Time}`;
}

function parseBookingKey(key) {
    // Split by the pattern that separates the main components
    // The key format is: "FullName-Email-Date-Time"
    // We need to be careful about dashes in names, so we'll use a more robust approach
    
    // Find the last 3 dashes (separating email, date, time)
    const lastDashIndex = key.lastIndexOf('-');
    const secondLastDashIndex = key.lastIndexOf('-', lastDashIndex - 1);
    const thirdLastDashIndex = key.lastIndexOf('-', secondLastDashIndex - 1);
    
    if (thirdLastDashIndex === -1) {
        // Fallback: try to split by common patterns
        const parts = key.split('-');
        if (parts.length >= 4) {
            // Take the last 3 parts as time, date, email, and everything else as name
            const time = parts[parts.length - 1];
            const date = parts[parts.length - 2];
            const email = parts[parts.length - 3];
            const name = parts.slice(0, parts.length - 3).join('-');
            return { email, date, time, name };
        }
        throw new Error('Invalid key format');
    }
    
    const time = key.substring(lastDashIndex + 1);
    const date = key.substring(secondLastDashIndex + 1, lastDashIndex);
    const email = key.substring(thirdLastDashIndex + 1, secondLastDashIndex);
    const name = key.substring(0, thirdLastDashIndex);
    
    return { email, date, time, name };
}

app.post('/book', async (req, res) => {
    const { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, contact, guests, type, packages , status, paymentmethod } = req.body;
    
    // Validate required fields
    if (!fullname || !email || !date || !budget) {
        return res.status(400).json({ error: 'Missing required fields: fullname, email, date, and budget are required' });
    }
    
    // Verify email configuration first before creating booking
    console.log('Verifying email configuration before booking...');
    const emailVerification = await verifyEmailConfig();
    
    if (!emailVerification.success) {
        console.error('Email configuration verification failed:', emailVerification.error);
        return res.status(500).json({ 
            error: 'Email system is not properly configured. Please contact administrator.',
            details: emailVerification.error,
            emailConfigValid: false
        });
    }
    
    console.log('Email configuration verified successfully, proceeding with email verification...');
    
    // Generate verification token
    const verificationToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    // Store booking data temporarily for verification
    const bookingData = {
        fullname,
        couplename,
        email,
        reception,
        eventtype,
        theme,
        time,
        date,
        budget,
        contact,
        guests,
        downpayment,
        // For customized bookings (book.html), leave type empty when no payment method provided
        type: (paymentmethod && String(paymentmethod).trim() !== '') ? paymentmethod : (type && String(type).trim() !== '' ? type : null),
        token: verificationToken,
        createdAt: new Date()
    };
    
    pendingVerifications.set(verificationToken, bookingData);
    
    // Send email verification
    try {
        const emailResult = await sendEmail(
            email,
            'Email Verification Required - CWEP Event Planning',
            emailTemplates.emailVerification(bookingData, verificationToken)
        );
        
        if (emailResult.success) {
            console.log('Verification email sent successfully to:', email);
            res.json({ 
                message: 'Please check your email and click the verification link to confirm your booking.',
                verificationSent: true,
                email: email
            });
        } else {
            console.error('Failed to send verification email:', emailResult.error);
            pendingVerifications.delete(verificationToken);
            res.status(500).json({ 
                error: 'Failed to send verification email. Please try again.',
                details: emailResult.error
            });
        }
    } catch (emailError) {
        console.error('Error sending verification email:', emailError);
        pendingVerifications.delete(verificationToken);
        res.status(500).json({ 
            error: 'Failed to send verification email. Please try again.',
            details: emailError.message
        });
    }
});

// Packages-specific verification endpoint
app.post('/book/package-verify', async (req, res) => {
    try {
        const { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, guests } = req.body;

        if (!fullname || !email || !date || !budget) {
            return res.status(400).json({ error: 'Missing required fields: fullname, email, date, and budget are required' });
        }

        const emailVerification = await verifyEmailConfig();
        if (!emailVerification.success) {
            return res.status(500).json({ 
                error: 'Email system is not properly configured. Please contact administrator.',
                details: emailVerification.error,
                emailConfigValid: false
            });
        }

        const verificationToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const bookingData = {
            fullname,
            couplename,
            email,
            reception,
            eventtype,
            theme,
            time,
            date,
            budget,
            downpayment,
            guests,
            type: 'package',
            token: verificationToken,
            createdAt: new Date()
        };

        pendingVerifications.set(verificationToken, bookingData);

        const emailResult = await sendEmail(
            email,
            'Verify Your Package Booking - CWEP',
            emailTemplates.packagesVerification(bookingData, verificationToken)
        );

        if (!emailResult.success) {
            pendingVerifications.delete(verificationToken);
            return res.status(500).json({ error: 'Failed to send packages verification email', details: emailResult.error });
        }

        return res.json({ ok: true, verificationSent: true });
    } catch (e) {
        console.error('package-verify error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Request OTP for packages flow
app.post('/book/package-otp', async (req, res) => {
    try {
        const { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, guests, contact, paymentmethod } = req.body;
        if (!fullname || !email || !date || !budget) {
            return res.status(400).json({ error: 'Missing required fields: fullname, email, date, and budget are required' });
        }
        // Enforce contact presence and 11 digits to ensure it shows in dashboard later
        const contactStr = typeof contact === 'string' ? contact.trim() : '';
        if (!/^\d{11}$/.test(contactStr)) {
            return res.status(400).json({ error: 'Contact number must be exactly 11 digits' });
        }

        const emailVerification = await verifyEmailConfig();
        if (!emailVerification.success) {
            return res.status(500).json({ error: 'Email system is not properly configured.', details: emailVerification.error });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const record = {
            otp,
            createdAt: Date.now(),
            expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
            attempts: 0,
            maxAttempts: 5,
            payload: { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, guests, contact: contactStr, paymentmethod }
        };

        pendingPackageOtps.set(String(email).toLowerCase(), record);

        const emailResult = await sendEmail(
            email,
            'Your CWEP Package Verification Code',
            emailTemplates.packageOtp(record.payload, otp)
        );
        if (!emailResult.success) {
            pendingPackageOtps.delete(String(email).toLowerCase());
            return res.status(500).json({ error: 'Failed to send OTP email', details: emailResult.error });
        }
        return res.json({ ok: true, sent: true, ttlSeconds: 600 });
    } catch (e) {
        console.error('package-otp error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify OTP for packages flow
app.post('/book/package-otp/verify', (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }
        const key = String(email).toLowerCase();
        const record = pendingPackageOtps.get(key);
        if (!record) {
            return res.status(404).json({ error: 'No OTP request found for this email' });
        }
        if (Date.now() > record.expiresAt) {
            pendingPackageOtps.delete(key);
            return res.status(410).json({ error: 'OTP expired' });
        }
        if (record.attempts >= record.maxAttempts) {
            pendingPackageOtps.delete(key);
            return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
        }
        record.attempts += 1;
        if (String(code).trim() !== record.otp) {
            return res.status(401).json({ error: 'Invalid code' });
        }
        // Successful verification -> Return booking data for payment page (DO NOT create booking yet)
        const b = record.payload || {};
        
        // Clear OTP to prevent reuse
        pendingPackageOtps.delete(key);
        
        // Return booking data without creating the booking in database
        // Booking will be created only after successful payment
        return res.json({ 
            ok: true, 
            verified: true, 
            bookingData: {
                fullname: b.fullname || null,
                couplename: b.couplename || null,
                email: b.email,
                reception: b.reception || null,
                eventtype: b.eventtype || null,
                theme: b.theme || null,
                time: b.time || null,
                date: b.date,
                budget: b.budget,
                contact: b.contact || null,
                guests: b.guests || null,
                downpayment: b.downpayment || null,
                type: (b.paymentmethod && String(b.paymentmethod).trim() !== '') ? b.paymentmethod : (b.type && String(b.type).trim() !== '' ? b.type : null)
            }
        });
    } catch (e) {
        console.error('package-otp/verify error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Create package booking after successful payment
app.post('/book/package-after-payment', (req, res) => {
    try {
        const { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, contact, guests, type, paymentIntentId, paymentmethod } = req.body;

        if (!fullname || !email || !date || !budget) {
            return res.status(400).json({ error: 'Missing required fields: fullname, email, date, and budget are required' });
        }

        // Compute balance = Budget - Downpayment (null-safe)
        const numericBudget = budget !== undefined && budget !== null && String(budget).trim() !== '' ? parseFloat(budget) : null;
        const hasDownpayment = downpayment !== undefined && downpayment !== null && String(downpayment).trim() !== '';
        const numericDown = hasDownpayment ? parseFloat(downpayment) : null;
        const numericBalance = (numericBudget !== null && !isNaN(numericBudget) && numericDown !== null && !isNaN(numericDown)) 
            ? (numericBudget - numericDown) 
            : null;

        const insertSql = `INSERT INTO book (\`Full_name\`, \`Couple_name\`, \`Email\`, \`Reception\`, \`Choose_your_event\`, \`Theme\`, \`Time\`, \`Date\`, \`Budget\`, \`Contact_number\`, \`Number_of_Guest\`, \`Downpayment\`, \`Balance\`, \`Type\`, \`Status\`, \`payment_status\`)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'pending'), 'succeeded')`;

        // Determine the payment method - prefer from request, then from payments table
        let finalPaymentMethod = null;
        if (paymentmethod && String(paymentmethod).trim() !== '') {
            finalPaymentMethod = paymentmethod;
        } else if (type && String(type).trim() !== '') {
            finalPaymentMethod = type;
        }

        // If we have a paymentIntentId but no payment method, try to get it from payments table
        if (!finalPaymentMethod && paymentIntentId) {
            const paymentQuery = "SELECT payment_method FROM payments WHERE paymongo_payment_id = ? LIMIT 1";
            con.query(paymentQuery, [paymentIntentId], (paymentErr, paymentResult) => {
                if (!paymentErr && paymentResult && paymentResult.length > 0) {
                    finalPaymentMethod = paymentResult[0].payment_method;
                }
                
                // Now proceed with the booking creation
                createBooking();
            });
        } else {
            // Proceed directly if we already have the payment method
            createBooking();
        }

        function createBooking() {
            const insertValues = [
                fullname,
                couplename || null,
                email,
                (reception && String(reception).trim() !== '') ? reception : 'To be determined',
                (eventtype && String(eventtype).trim() !== '') ? eventtype : 'Wedding Package',
                theme || null,
                time || null,
                date,
                budget,
                contact || null,
                guests || null,
                hasDownpayment ? downpayment : null,
                (numericBalance === null || isNaN(numericBalance)) ? null : numericBalance,
                finalPaymentMethod || 'package-downpayment',
                'pending'
            ];

            console.log('📝 Inserting package booking with values:', insertValues);
            console.log('📝 Package booking request body:', req.body);
            console.log('📝 Final payment method:', finalPaymentMethod);
            
            con.query(insertSql, insertValues, (err, result) => {
            if (err) {
                console.error('❌ Package booking insert after payment failed:', err);
                return res.status(500).json({ error: 'Failed to save booking after payment', details: err.message });
            }
            console.log('Package booking created after successful payment:', { id: result.insertId, email, paymentIntentId });
            
            // Verify the booking was created by querying it back
            const verifyQuery = "SELECT * FROM book WHERE id = ?";
            con.query(verifyQuery, [result.insertId], (verifyErr, verifyResult) => {
                if (verifyErr) {
                    console.error('Failed to verify package booking creation:', verifyErr);
                } else {
                    console.log(' Package booking verification - created record:', verifyResult[0]);
                }
            });
            
            return res.json({ ok: true, id: result.insertId, message: 'Package booking created successfully after payment' });
            });
        }
    } catch (e) {
        console.error('Package booking after payment error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Direct booking insert without email verification
app.post('/book/direct', (req, res) => {
    try {
        const { fullname, couplename, email, reception, eventtype, theme, time, date, budget, downpayment, contact, guests, type, status, paymentmethod } = req.body;

        if (!fullname || !email || !date || !budget) {
            return res.status(400).json({ error: 'Missing required fields: fullname, email, date, and budget are required' });
        }

        // Compute balance = Budget - Downpayment (null-safe)
        const numericBudget = budget !== undefined && budget !== null && String(budget).trim() !== '' ? parseFloat(budget) : null;
        const hasDownpayment = downpayment !== undefined && downpayment !== null && String(downpayment).trim() !== '';
        const numericDown = hasDownpayment ? parseFloat(downpayment) : null;
        const numericBalance = (numericBudget !== null && !isNaN(numericBudget) && numericDown !== null && !isNaN(numericDown)) 
            ? (numericBudget - numericDown) 
            : null;

        const insertSql = `INSERT INTO book (\`Full_name\`, \`Couple_name\`, \`Email\`, \`Reception\`, \`Choose_your_event\`, \`Theme\`, \`Time\`, \`Date\`, \`Budget\`, \`Contact_number\`, \`Number_of_Guest\`, \`Downpayment\`, \`Balance\`, \`Type\`, \`Status\`)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'pending'))`;

        const insertValues = [
            fullname,
            couplename || null,
            email,
            reception || null,
            eventtype || null,
            theme || null,
            time || null,
            date,
            budget,
            contact || null,
            guests || null,
            hasDownpayment ? downpayment : null,
            (numericBalance === null || isNaN(numericBalance)) ? null : numericBalance,
            // Prefer provided type (e.g., 'full-payment'); fallback to paymentmethod, else null
            (type && String(type).trim() !== '') ? type : ((paymentmethod && String(paymentmethod).trim() !== '') ? paymentmethod : null),
            status || 'pending'
        ];

        con.query(insertSql, insertValues, (err, result) => {
            if (err) {
                console.error('Direct booking insert failed:', err);
                return res.status(500).json({ error: 'Failed to save booking' });
            }
            return res.json({ ok: true, id: result.insertId, message: 'Booking saved successfully' });
        });
    } catch (e) {
        console.error('Direct booking error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

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

// GET request for status page (matching the expected format)
app.get('/api/book', (req, res) => {
    const query = "SELECT id as id, \`Full_name\` as full_name, \`Couple_name\` as couple_name, \`Email\` as email, \`Reception\` as reception, \`Choose_your_event\` as event_type, \`Theme\` as theme, \`Time\` as time_slot, \`Date\` as event_date, \`Budget\` as budget, \`Contact_number\` as phone, \`Number_of_Guest\` as guests, \`Downpayment\` as downpayment, \`Balance\` as balance, \`Type\` as type, COALESCE(\`Status\`,'pending') as status, CASE WHEN (\`Type\` IS NULL OR TRIM(\`Type\`) = '') THEN NULL ELSE \`payment_status\` END as payment_status FROM book";

    con.query(query, (err, result) => {
        if (!err) {
            // Provide a stable key even if there's no numeric id column
            const bookingsWithStatus = result.map(booking => {
                const status = (booking.status || 'pending');
                const computedKey = [
                    String(booking.full_name || '').trim(),
                    String(booking.email || '').trim(),
                    String(booking.event_date || '').trim(),
                    String(booking.time_slot || '').trim()
                ].join('-');
                return { ...booking, key: computedKey, status };
            });
            res.json({ bookings: bookingsWithStatus });
        } else {
            res.status(500).json({ error: err.message });
        }
    });
});

// Update booking status and persist to DB
app.post('/api/book/status', async (req, res) => {
    const { id, key, status, full_name: bodyFullName, email: bodyEmail, event_date: bodyEventDate, time_slot: bodyTimeSlot } = req.body;
    
    console.log('Received status update request:', { key, status, bodyFullName, bodyEmail, bodyEventDate, bodyTimeSlot });
    
    if ((id === undefined && !key && !(bodyFullName && bodyEmail && bodyEventDate)) || !status) {
        console.log('Missing key or status:', { key, status });
        return res.status(400).json({ error: 'Key and status are required' });
    }
    
    // Verify email configuration, but do NOT block status update if it fails
    console.log('Verifying email configuration before status update (non-blocking)...');
    const emailVerification = await verifyEmailConfig().catch(err => ({ success: false, error: err?.message || 'verify failed' }));
    if (!emailVerification.success) {
        console.warn('Email configuration verification failed; proceeding without sending email:', emailVerification.error);
    } else {
        console.log('Email configuration verified successfully, status update may send email notification.');
    }
    
    // If id or key is numeric, update directly by id
    const numericCandidate = id !== undefined && id !== null ? id : key;
    if (numericCandidate !== undefined && /^\d+$/.test(String(numericCandidate))) {
        const updateById = 'UPDATE book SET Status = ? WHERE id = ?';
        const updateByIdValues = [status, Number(numericCandidate)];
        return con.query(updateById, updateByIdValues, (err, result) => {
            if (err) {
                console.error('Database error (by id):', err);
                return res.status(500).json({ error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            return res.json({ message: 'Status updated successfully', affectedRows: result.affectedRows });
        });
    }

    // Store in memory for immediate access
    bookingStatusStore.set(key, status);
    console.log('Stored in memory cache:', key, '->', status);
    // Note: defer caching amount until after we resolve name/email/date/time below
    
    // Prefer explicit fields from body to avoid key parsing issues
    let name = bodyFullName;
    let email = bodyEmail;
    let date = bodyEventDate;
    let time = bodyTimeSlot;
    if (!name || !email || !date) {
        const parsed = parseBookingKey(key);
        name = name || parsed.name;
        email = email || parsed.email;
        date = date || parsed.date;
        time = time || parsed.time;
    }
    console.log('Parsed key components:', { name, email, date, time });

    // Downpayment caching removed
    
    // Update database - handle time format conversion
    // The database stores Time as integer (like 23 for 11 PM), but frontend sends string (like "2:00PM")
    // We need to convert the time string to integer for database comparison
    let timeForDB = time;
    
    // Try to convert time string to integer (24-hour format)
    if (typeof time === 'string') {
        // Handle formats like "2:00PM", "14:00", "2PM", etc.
        const timeStr = time.toLowerCase().trim();
        
        // Check for AM/PM format
        if (timeStr.includes('am') || timeStr.includes('pm')) {
            const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
            if (match) {
                let hour = parseInt(match[1]);
                const period = match[3];
                
                if (period === 'pm' && hour !== 12) {
                    hour += 12;
                } else if (period === 'am' && hour === 12) {
                    hour = 0;
                }
                timeForDB = hour;
            }
        } else {
            // Handle 24-hour format like "14:00" or just "14"
            const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?/);
            if (match) {
                timeForDB = parseInt(match[1]);
            }
        }
    }
    
    // Try to match Time in multiple common formats to avoid mismatch issues
    const updateQuery = `
        UPDATE book 
        SET \`Status\` = ?
        WHERE TRIM(LOWER(\`Full_name\`)) = TRIM(LOWER(?))
          AND TRIM(LOWER(\`Email\`)) = TRIM(LOWER(?))
          AND (
                \`Date\` = ?
             OR STR_TO_DATE(\`Date\`, '%Y-%m-%d') = STR_TO_DATE(?, '%Y-%m-%d')
          )
          AND (
                TRIM(\`Time\`) = ? 
             OR  TRIM(\`Time\`) = LPAD(?, 2, '0')
             OR  TRIM(\`Time\`) = CONCAT(LPAD(?, 2, '0'), ':00')
             OR  TRIM(\`Time\`) = CONCAT(LPAD(?, 2, '0'), ':00:00')
             OR  TRIM(\`Time\`) LIKE CONCAT(LPAD(?, 2, '0'), ':%')
          )`;
    const hourParam = typeof timeForDB === 'number' ? timeForDB : parseInt(timeForDB, 10);
    const values = [status, name, email, date, date, hourParam, hourParam, hourParam, hourParam, hourParam];
    console.log('Executing query with normalized matching. Values:', { status, name, email, date, hourParam, originalTime: time });
    
    con.query(updateQuery, values, (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: err.message });
        }

        console.log('Database update successful:', result);
        console.log('Affected rows:', result.affectedRows);

        if (result.affectedRows > 0) {
            // Fetch the updated row to confirm DB state and get full booking details
            const verifyQuery = `SELECT \`Full_name\` as full_name, \`Couple_name\` as couple_name, \`Email\` as email, \`Reception\` as reception, 
                                        \`Choose_your_event\` as eventtype, \`Theme\` as theme, \`Date\` as event_date, \`Time\` as time_slot, 
                                        \`Budget\` as budget, \`Contact_number\` as contact, \`Number_of_Guest\` as guests, 
                                        COALESCE(\`Status\`,'pending') as status
                                 FROM book
                                 WHERE TRIM(LOWER(\`Full_name\`)) = TRIM(LOWER(?))
                                   AND TRIM(LOWER(\`Email\`)) = TRIM(LOWER(?))
                                   AND (\`Date\` = ? OR STR_TO_DATE(\`Date\`, '%Y-%m-%d') = STR_TO_DATE(?, '%Y-%m-%d'))`;
            con.query(verifyQuery, [name, email, date, date], async (vErr, rows) => {
                if (vErr) {
                    console.warn('Verify select failed:', vErr.message);
                    return res.json({ message: 'Status updated successfully', affectedRows: result.affectedRows });
                }
                const updated = rows && rows[0] ? rows[0] : null;
                
                // Send status update email automatically (only if email config is valid)
                if (emailVerification.success && updated && updated.email) {
                    try {
                        const bookingData = {
                            fullname: updated.full_name,
                            couplename: updated.couple_name,
                            email: updated.email,
                            reception: updated.reception,
                            eventtype: updated.eventtype,
                            theme: updated.theme,
                            time: updated.time_slot,
                            date: updated.event_date,
                            budget: updated.budget,
                            contact: updated.contact,
                            guests: updated.guests
                        };
                        
                        const emailResult = await sendEmail(
                            updated.email,
                            `Booking Status Update - ${status.toUpperCase()} - CWEP Event Planning`,
                            emailTemplates.statusUpdate(bookingData, status)
                        );
                        
                        if (emailResult.success) {
                            console.log('Status update email sent successfully to:', updated.email);
                        } else {
                            console.error('Failed to send status update email:', emailResult.error);
                        }
                    } catch (emailError) {
                        console.error('Error sending status update email:', emailError);
                        // Don't fail the status update if email fails
                    }
                }
                
                return res.json({ 
                    message: 'Status updated successfully', 
                    affectedRows: result.affectedRows, 
                    updated,
                    emailSent: true
                });
            });
            return; // ensure no double send
        }

        console.warn('No rows updated with time condition. Retrying without time match...');

        // Second attempt: ignore Time condition (names/emails/dates normalized)
        const fallbackUpdateQuery = `
            UPDATE book 
            SET \`Status\` = ?
            WHERE TRIM(LOWER(\`Full_name\`)) = TRIM(LOWER(?))
              AND TRIM(LOWER(\`Email\`)) = TRIM(LOWER(?))
              AND (\`Date\` = ? OR STR_TO_DATE(\`Date\`, '%Y-%m-%d') = STR_TO_DATE(?, '%Y-%m-%d'))`;
        const fallbackValues = [status, name, email, date, date];
        console.log('Executing fallback update (without time). Values:', { status, name, email, date });

        con.query(fallbackUpdateQuery, fallbackValues, (fbErr, fbResult) => {
            if (fbErr) {
                console.error('Database error on fallback:', fbErr);
                return res.status(500).json({ error: fbErr.message });
            }

            console.log('Fallback update result:', fbResult);
            if (fbResult.affectedRows === 0) {
                console.warn('Fallback also updated 0 rows. Investigating candidates...');
                const debugQuery = `SELECT \`Full_name\`, \`Email\`, \`Date\`, \`Time\`, \`Status\` FROM book 
                                    WHERE TRIM(LOWER(\`Email\`)) = TRIM(LOWER(?))
                                      AND (\`Date\` = ? OR STR_TO_DATE(\`Date\`, '%Y-%m-%d') = STR_TO_DATE(?, '%Y-%m-%d'))`;
                con.query(debugQuery, [email, date, date], (selErr, rows) => {
                    if (selErr) {
                        console.warn('Debug select failed:', selErr.message);
                    } else {
                        console.log('Debug candidate rows for email/date:', rows);
                    }
                    return res.json({ message: 'No exact match found; see server logs for candidates', affectedRows: 0 });
                });
            } else {
                // Verify row after fallback and send email
                const verifyQuery = `SELECT \`Full_name\` as full_name, \`Couple_name\` as couple_name, \`Email\` as email, \`Reception\` as reception, 
                                            \`Choose_your_event\` as eventtype, \`Theme\` as theme, \`Date\` as event_date, \`Time\` as time_slot, 
                                            \`Budget\` as budget, \`Contact_number\` as contact, \`Number_of_Guest\` as guests, 
                                            COALESCE(\`Status\`,'pending') as status
                                     FROM book
                                     WHERE TRIM(LOWER(\`Full_name\`)) = TRIM(LOWER(?))
                                       AND TRIM(LOWER(\`Email\`)) = TRIM(LOWER(?))
                                       AND (\`Date\` = ? OR STR_TO_DATE(\`Date\`, '%Y-%m-%d') = STR_TO_DATE(?, '%Y-%m-%d'))`;
                con.query(verifyQuery, [name, email, date, date], async (vErr, rows) => {
                    if (vErr) {
                        console.warn('Verify select failed (fallback):', vErr.message);
                        return res.json({ message: 'Status updated via fallback (time ignored)', affectedRows: fbResult.affectedRows });
                    }
                    const updated = rows && rows[0] ? rows[0] : null;
                    
                // Send status update email automatically for fallback (only if email config is valid)
                if (emailVerification.success && updated && updated.email) {
                        try {
                            const bookingData = {
                                fullname: updated.full_name,
                                couplename: updated.couple_name,
                                email: updated.email,
                                reception: updated.reception,
                                eventtype: updated.eventtype,
                                theme: updated.theme,
                                time: updated.time_slot,
                                date: updated.event_date,
                                budget: updated.budget,
                                contact: updated.contact,
                                guests: updated.guests
                            };
                            
                            const emailResult = await sendEmail(
                                updated.email,
                                `Booking Status Update - ${status.toUpperCase()} - CWEP Event Planning`,
                                emailTemplates.statusUpdate(bookingData, status)
                            );
                            
                            if (emailResult.success) {
                                console.log('Status update email sent successfully to:', updated.email);
                            } else {
                                console.error('Failed to send status update email:', emailResult.error);
                            }
                        } catch (emailError) {
                            console.error('Error sending status update email:', emailError);
                            // Don't fail the status update if email fails
                        }
                    }
                    
                    return res.json({ 
                        message: 'Status updated via fallback (time ignored)', 
                        affectedRows: fbResult.affectedRows, 
                        updated,
                        emailSent: true
                    });
                });
            }
        });
    });
});

// (Removed) Downpayment persistence endpoint

// Delete booking by numeric id or composite key
app.post('/api/book/delete', (req, res) => {
    try {
        const { id, key } = req.body;

        // Support both explicit id and legacy numeric key
        const candidate = id !== undefined && id !== null ? id : key;
        const idStr = String(candidate !== undefined && candidate !== null ? candidate : '').trim();

        console.log('Delete request received. Raw candidate:', candidate, 'Parsed idStr:', idStr);

        if (!/^\d+$/.test(idStr)) {
            return res.status(400).json({ error: 'Numeric id is required' });
        }

        const idNum = parseInt(idStr, 10);

        // First record the deletion into history, then delete
        history.recordDeletionById(con, idNum, (recErr) => {
            if (recErr) {
                console.warn('Failed to record deletion to history:', recErr.message);
            }
        });

        con.query('DELETE FROM book WHERE id = ?', [idNum], (err, result) => {
            if (err) {
                console.error('Failed to delete booking by id:', err);
                return res.status(500).json({ error: 'Failed to delete booking' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            return res.json({ ok: true, deleted: result.affectedRows, message: 'Booking deleted successfully' });
        });
    } catch (e) {
        console.error('Delete error:', e);
        return res.status(500).json({ error: 'Delete error' });
    }
});

// Email verification endpoint
app.get('/verify-email', async (req, res) => {
    try {
        const verification = await verifyEmailConfig();
        if (verification.success) {
            res.json({ 
                success: true, 
                message: 'Email configuration is valid and ready to send emails',
                config: {
                    user: process.env.SMTP_USER || 'your-email@gmail.com',
                    service: 'gmail'
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Email configuration verification failed',
                error: verification.error
            });
        }
    } catch (error) {
        console.error('Email verification endpoint error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Email verification failed',
            error: error.message
        });
    }
});

// Email verification endpoint
app.get('/verify-booking', async (req, res) => {
    const { token, action } = req.query;
    
    if (!token || !action) {
        return res.status(400).send(`
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <h2 style="color: #dc3545;">Invalid verification link</h2>
                <p>This verification link is invalid or has expired.</p>
                <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
            </div>
        `);
    }
    
    const bookingData = pendingVerifications.get(token);
    
    if (!bookingData) {
        return res.status(404).send(`
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <h2 style="color: #dc3545;">Verification expired</h2>
                <p>This verification link has expired. Please submit a new booking request.</p>
                <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
            </div>
        `);
    }
    
    // Check if verification is older than 24 hours
    const now = new Date();
    const verificationAge = now - bookingData.createdAt;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    if (verificationAge > twentyFourHours) {
        pendingVerifications.delete(token);
        return res.status(410).send(`
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <h2 style="color: #dc3545;">Verification expired</h2>
                <p>This verification link has expired (24 hours). Please submit a new booking request.</p>
                <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
            </div>
        `);
    }
    
    if (action === 'confirm') {
        // User confirmed - create the booking
        try {
            // Compute balance for verified booking
            const numericBudget = bookingData.budget !== undefined && bookingData.budget !== null && String(bookingData.budget).trim() !== '' ? parseFloat(bookingData.budget) : null;
            const numericDown = bookingData.downpayment !== undefined && bookingData.downpayment !== null && String(bookingData.downpayment).trim() !== '' ? parseFloat(bookingData.downpayment) : 0;
            const numericBalance = (numericBudget !== null && !isNaN(numericBudget)) ? (numericBudget - (isNaN(numericDown) ? 0 : numericDown)) : null;

            const query = `INSERT INTO book (\`Full_name\`, \`Couple_name\`, \`Email\`, \`Reception\`, \`Choose_your_event\`, \`Theme\`, \`Time\`, \`Date\`, \`Budget\`, \`Contact_number\`, \`Number_of_Guest\`, \`Downpayment\`, \`Balance\`, \`Type\`, \`Status\`) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'pending'))`;
            
            const values = [
                bookingData.fullname, 
                bookingData.couplename || null, 
                bookingData.email, 
                bookingData.reception, 
                bookingData.eventtype, 
                bookingData.theme, 
                bookingData.time, 
                bookingData.date, 
                bookingData.budget, 
                bookingData.contact, 
                bookingData.guests, 
                (bookingData.downpayment === undefined || bookingData.downpayment === null || String(bookingData.downpayment).trim() === '') ? null : bookingData.downpayment,
                (numericBalance === null || isNaN(numericBalance)) ? null : numericBalance,
                (bookingData.type && String(bookingData.type).trim() !== '') ? bookingData.type : null, 
                'pending'
            ];
            
            con.query(query, values, async (err, result) => {
                if (!err) {
                    console.log('Booking confirmed and added successfully:', { id: result.insertId, fullname: bookingData.fullname, email: bookingData.email });
                    
                    // Remove from pending verifications
                    pendingVerifications.delete(token);
                    
                    // Link latest payment_method from payments DB (optional)
                    // (Removed) payments DB linkage

                    // Send confirmation email
                    try {
                        const emailResult = await sendEmail(
                            bookingData.email,
                            'Booking Confirmed - CWEP Event Planning',
                            emailTemplates.bookingConfirmation(bookingData)
                        );
                        
                        if (emailResult.success) {
                            console.log('Confirmation email sent successfully to:', bookingData.email);
                        }
                    } catch (emailError) {
                        console.error('Error sending confirmation email:', emailError);
                    }
                    
                    // Check if this is a package booking
                    const isPackageBooking = bookingData.type === 'package';
                    
                    if (isPackageBooking) {
                        // For package bookings, show success page WITHOUT payment option
                        const downpayment = bookingData.downpayment ? parseFloat(bookingData.downpayment) : 0;
                        const budget = parseFloat(bookingData.budget);
                        
                        res.send(`
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                                <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
                                    <h1 style="margin: 0; font-size: 28px;"> Package Booking Confirmed!</h1>
                                </div>
                                <h2 style="color: #28a745;">Thank you for confirming your package booking!</h2>
                                <p>Your package booking has been successfully confirmed and is now <strong>pending approval</strong>.</p>
                                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7d0d24;">
                                    <h3 style="color: #7d0d24; margin-top: 0;">Booking Details:</h3>
                                    <p><strong>Booking ID:</strong> ${result.insertId}</p>
                                    <p><strong>Name:</strong> ${bookingData.fullname}</p>
                                    <p><strong>Package:</strong> ${bookingData.eventtype}</p>
                                    <p><strong>Venue:</strong> ${bookingData.reception}</p>
                                    <p><strong>Event Date:</strong> ${bookingData.date}</p>
                                    <p><strong>Total Budget:</strong> ₱${budget.toLocaleString()}</p>
                                    <p><strong>Downpayment:</strong> ₱${downpayment.toLocaleString()}</p>
                                </div>
                                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                    <p style="margin: 0; color: #1565c0;"><strong>What happens next?</strong></p>
                                    <p style="margin: 5px 0 0 0; color: #1565c0;">Our team will review your package booking and contact you for further details. You will receive an email once your booking is approved.</p>
                                </div>
                                <p>You will receive a confirmation email shortly.</p>
                                <div style="margin: 30px 0;">
                                    <a href="/cllient_dashboard.html" style="display: inline-block; background: #7d0d24; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px;">View Dashboard</a>
                                    <a href="/packages.html" style="display: inline-block; background: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px;">View Packages</a>
                                    <a href="/index.html" style="display: inline-block; background: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px;">Return to Home</a>
                                </div>
                            </div>
                        `);
                    } else {
                        // For regular bookings, show the original success page
                        res.send(`
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                                <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
                                    <h1 style="margin: 0; font-size: 28px;"> Booking Confirmed!</h1>
                                </div>
                                <h2 style="color: #28a745;">Thank you for confirming your booking!</h2>
                                <p>Your booking has been successfully confirmed and is now pending approval.</p>
                                <p><strong>Booking ID:</strong> ${result.insertId}</p>
                                <p><strong>Name:</strong> ${bookingData.fullname}</p>
                                <p><strong>Event Date:</strong> ${bookingData.date}</p>
                                <p><strong>Budget:</strong> ₱${parseFloat(bookingData.budget).toLocaleString()}</p>
                                <p>You will receive a confirmation email shortly.</p>
                                <a href="/book.html" style="display: inline-block; background: #7d0d24; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 20px;">Return to Home</a>
                            </div>
                        `);
                    }
                } else {
                    console.error('Database error:', err);
                    res.status(500).send(`
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                            <h2 style="color: #dc3545;">Error confirming booking</h2>
                            <p>There was an error processing your booking confirmation. Please try again.</p>
                            <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
                        </div>
                    `);
                }
            });
        } catch (error) {
            console.error('Error processing booking confirmation:', error);
            res.status(500).send(`
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                    <h2 style="color: #dc3545;">Error confirming booking</h2>
                    <p>There was an error processing your booking confirmation. Please try again.</p>
                    <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
                </div>
            `);
        }
    } else if (action === 'deny') {
        // User denied - remove from pending verifications
        pendingVerifications.delete(token);
        
        res.send(`
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <div style="background: linear-gradient(135deg, #dc3545, #c82333); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
                    <h1 style="margin: 0; font-size: 28px;"> Booking Denied</h1>
                </div>
                <h2 style="color: #dc3545;">Booking request cancelled</h2>
                <p>You have successfully denied this booking request. No booking has been created.</p>
                <p>If you believe this was an error, please contact us immediately.</p>
                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #1565c0;"><strong>Contact Information:</strong></p>
                    <p style="margin: 5px 0 0 0; color: #1565c0;">Phone: 09876356425 | Email: cwep@example.com</p>
                </div>
                <a href="/book.html" style="display: inline-block; background: #7d0d24; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 20px;">Return to Home</a>
            </div>
        `);
    } else {
        res.status(400).send(`
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <h2 style="color: #dc3545;">Invalid action</h2>
                <p>This verification link is invalid.</p>
                <a href="/book.html" style="color: #7d0d24;">Return to booking form</a>
            </div>
        `);
    }
});

// Test email endpoint
app.post('/test-email', async (req, res) => {
    const { to, subject } = req.body;
    
    if (!to) {
        return res.status(400).json({ 
            success: false, 
            message: 'Recipient email is required' 
        });
    }
    
    try {
        const testHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #7d0d24, #a0152e); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 28px;">CWEP Event Planning</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">Email Test</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #7d0d24; margin-top: 0;">Test Email</h2>
                    <p>This is a test email to verify that your email configuration is working correctly.</p>
                    <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>From:</strong> ${process.env.SMTP_USER || 'your-email@gmail.com'}</p>
                    <p><strong>To:</strong> ${to}</p>
                    
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #1565c0;"><strong> Email system is working!</strong></p>
                        <p style="margin: 5px 0 0 0; color: #1565c0;">Your booking system is ready to send automatic emails.</p>
                    </div>
                </div>
            </div>
        `;
        
        const emailResult = await sendEmail(
            to,
            subject || 'CWEP Email System Test',
            testHtml
        );
        
        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: 'Test email sent successfully',
                messageId: emailResult.messageId
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to send test email',
                error: emailResult.error
            });
        }
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Test email failed',
            error: error.message
        });
    }
});

// (Removed) test endpoints that manipulate downpayment

// Debug endpoint to check what's in the database
app.get('/api/debug-booking/:email', (req, res) => {
    const email = req.params.email;
    const query = "SELECT * FROM book WHERE \`Email\` = ? ORDER BY id DESC LIMIT 5";
    
    con.query(query, [email], (err, result) => {
        if (err) {
            console.error('Debug query error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        console.log(`Debug query for email ${email}:`, result);
        res.json({ 
            message: `Found ${result.length} bookings for ${email}`,
            bookings: result
        });
    });
});

// Debug endpoint to check all bookings in database
app.get('/api/debug-all-bookings', (req, res) => {
    const query = "SELECT id, Full_name, Email, Choose_your_event, Type, Status, payment_status, Date, Time, Budget, Downpayment FROM book ORDER BY id DESC LIMIT 20";
    
    con.query(query, (err, result) => {
        if (err) {
            console.error('Debug all bookings query error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        console.log('Debug all bookings:', result);
        res.json({ 
            message: `Found ${result.length} total bookings`,
            bookings: result
        });
    });
});

// (Removed) test endpoints that manipulate downpayment

const PORT = 4400;
app.listen(PORT, () => {
    console.log(`Book server running on port ${PORT}`);
    console.log(`Email verification endpoint: http://localhost:${PORT}/verify-email`);
    console.log(`Test email endpoint: POST http://localhost:${PORT}/test-email`);
});

module.exports = app;
