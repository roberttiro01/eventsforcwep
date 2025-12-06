// Check and fix admin password in database
const mysql = require('mysql');
const bcrypt = require('bcrypt');

const con = mysql.createConnection({
    host: 'localhost',
    database: 'capstone',
    user: 'root',
    password: ''
});

async function checkAndFixPassword() {
    try {
        console.log('Checking admin password in database...');
        
        // Check current admin data
        const checkQuery = 'SELECT id, username, password FROM admin WHERE username = ?';
        const result = await new Promise((resolve, reject) => {
            con.query(checkQuery, ['admin'], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
        
        if (result.length === 0) {
            console.log('❌ No admin user found');
            return;
        }
        
        const admin = result[0];
        console.log('✅ Admin user found:');
        console.log(`   ID: ${admin.id}`);
        console.log(`   Username: ${admin.username}`);
        console.log(`   Password Hash: ${admin.password.substring(0, 30)}...`);
        
        // Test current password
        const testPassword = 'admin123';
        const isValid = await bcrypt.compare(testPassword, admin.password);
        console.log(`   Current password (admin123) valid: ${isValid ? 'YES' : 'NO'}`);
        
        if (!isValid) {
            console.log('🔧 Fixing password...');
            
            // Create new hash for admin123
            const newHash = await bcrypt.hash('admin123', 10);
            
            // Update password in database
            const updateQuery = 'UPDATE admin SET password = ? WHERE username = ?';
            await new Promise((resolve, reject) => {
                con.query(updateQuery, [newHash, 'admin'], (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            console.log('✅ Password fixed!');
            
            // Verify the fix
            const verifyQuery = 'SELECT password FROM admin WHERE username = ?';
            const verifyResult = await new Promise((resolve, reject) => {
                con.query(verifyQuery, ['admin'], (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            const isNowValid = await bcrypt.compare('admin123', verifyResult[0].password);
            console.log(`✅ Verification: ${isNowValid ? 'PASS' : 'FAIL'}`);
        }
        
        console.log('🎉 Admin password check completed!');
        console.log('');
        console.log('📝 Login credentials:');
        console.log('   Username: admin');
        console.log('   Password: admin123');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        con.end();
    }
}

// Run check
checkAndFixPassword();
