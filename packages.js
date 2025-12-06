const { pool } = require('./db');

// Use shared pool

// Get all packages
const getAllPackages = (req, res) => {
    const query = 'SELECT * FROM packages ORDER BY price ASC';
    
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Failed to fetch packages:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch packages',
                details: err.message 
            });
        }
        
        return res.json({ 
            success: true,
            packages: result,
            count: result.length 
        });
    });
};

// Get single package by ID
const getPackageById = (req, res) => {
    const packageId = req.params.id;
    
    if (!packageId || isNaN(packageId)) {
        return res.status(400).json({ 
            error: 'Invalid package ID',
            message: 'Package ID must be a valid number' 
        });
    }
    
    const query = 'SELECT * FROM packages WHERE id = ?';
    
    pool.query(query, [packageId], (err, result) => {
        if (err) {
            console.error('Failed to fetch package:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch package',
                details: err.message 
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({ 
                error: 'Package not found',
                message: `No package found with ID ${packageId}` 
            });
        }
        
        return res.json({ 
            success: true,
            package: result[0] 
        });
    });
};

// Create new package (Admin only)
const createPackage = (req, res) => {
    const { name, description, price, pax_count, venues, inclusions, image_url, is_active } = req.body;
    
    // Validate required fields
    if (!name || !price) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            message: 'Package name and price are required' 
        });
    }
    
    // Validate price is a number
    if (isNaN(price) || price <= 0) {
        return res.status(400).json({ 
            error: 'Invalid price',
            message: 'Price must be a positive number' 
        });
    }
    
    const query = `
        INSERT INTO packages (title, price, pax, venues, inclusions, image_url, is_active, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    
    const values = [
        name, // map form 'name' -> DB 'title'
        price,
        pax_count || null, // map form 'pax_count' -> DB 'pax'
        venues ? JSON.stringify(venues) : null,
        inclusions ? JSON.stringify(inclusions) : null,
        image_url || null,
        is_active !== undefined ? is_active : true
    ];
    
    pool.query(query, values, (err, result) => {
        if (err) {
            console.error('Failed to create package:', err);
            return res.status(500).json({ 
                error: 'Failed to create package',
                details: err.message 
            });
        }
        
        return res.status(201).json({ 
            success: true,
            message: 'Package created successfully',
            package: {
                id: result.insertId,
                title: name,
                price,
                pax: pax_count || null,
                venues,
                inclusions,
                image_url,
                is_active
            }
        });
    });
};

// Update package (Admin only)
const updatePackage = (req, res) => {
    const packageId = req.params.id;
    const { name, description, price, pax_count, venues, inclusions, image_url, is_active } = req.body;
    
    if (!packageId || isNaN(packageId)) {
        return res.status(400).json({ 
            error: 'Invalid package ID',
            message: 'Package ID must be a valid number' 
        });
    }
    
    // Check if package exists
    const checkQuery = 'SELECT id FROM packages WHERE id = ?';
    pool.query(checkQuery, [packageId], (err, result) => {
        if (err) {
            console.error('Failed to check package existence:', err);
            return res.status(500).json({ 
                error: 'Database error',
                details: err.message 
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({ 
                error: 'Package not found',
                message: `No package found with ID ${packageId}` 
            });
        }
        
        // Build update query dynamically
        const updateFields = [];
        const values = [];
        
        if (name !== undefined) {
            updateFields.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            values.push(description);
        }
        if (price !== undefined) {
            if (isNaN(price) || price <= 0) {
                return res.status(400).json({ 
                    error: 'Invalid price',
                    message: 'Price must be a positive number' 
                });
            }
            updateFields.push('price = ?');
            values.push(price);
        }
        if (pax_count !== undefined) {
            updateFields.push('pax_count = ?');
            values.push(pax_count);
        }
        if (venues !== undefined) {
            updateFields.push('venues = ?');
            values.push(venues ? JSON.stringify(venues) : null);
        }
        if (inclusions !== undefined) {
            updateFields.push('inclusions = ?');
            values.push(inclusions ? JSON.stringify(inclusions) : null);
        }
        if (image_url !== undefined) {
            updateFields.push('image_url = ?');
            values.push(image_url);
        }
        if (is_active !== undefined) {
            updateFields.push('is_active = ?');
            values.push(is_active);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ 
                error: 'No fields to update',
                message: 'At least one field must be provided for update' 
            });
        }
        
        updateFields.push('updated_at = NOW()');
        values.push(packageId);
        
        const updateQuery = `UPDATE packages SET ${updateFields.join(', ')} WHERE id = ?`;
        
        pool.query(updateQuery, values, (err, result) => {
            if (err) {
                console.error('Failed to update package:', err);
                return res.status(500).json({ 
                    error: 'Failed to update package',
                    details: err.message 
                });
            }
            
            return res.json({ 
                success: true,
                message: 'Package updated successfully',
                affectedRows: result.affectedRows 
            });
        });
    });
};

// Delete package (Admin only)
const deletePackage = (req, res) => {
    const packageId = req.params.id;
    
    if (!packageId || isNaN(packageId)) {
        return res.status(400).json({ 
            error: 'Invalid package ID',
            message: 'Package ID must be a valid number' 
        });
    }
    
    // Check if package exists
    const checkQuery = 'SELECT id, name FROM packages WHERE id = ?';
    pool.query(checkQuery, [packageId], (err, result) => {
        if (err) {
            console.error('Failed to check package existence:', err);
            return res.status(500).json({ 
                error: 'Database error',
                details: err.message 
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({ 
                error: 'Package not found',
                message: `No package found with ID ${packageId}` 
            });
        }
        
        const deleteQuery = 'DELETE FROM packages WHERE id = ?';
        
        pool.query(deleteQuery, [packageId], (err, result) => {
            if (err) {
                console.error('Failed to delete package:', err);
                return res.status(500).json({ 
                    error: 'Failed to delete package',
                    details: err.message 
                });
            }
            
            return res.json({ 
                success: true,
                message: 'Package deleted successfully',
                deletedPackage: {
                    id: packageId,
                    name: result[0]?.name
                }
            });
        });
    });
};

// Get packages by price range
const getPackagesByPriceRange = (req, res) => {
    const { min_price, max_price } = req.query;
    
    if (!min_price || !max_price) {
        return res.status(400).json({ 
            error: 'Missing price parameters',
            message: 'Both min_price and max_price are required' 
        });
    }
    
    if (isNaN(min_price) || isNaN(max_price) || min_price < 0 || max_price < 0) {
        return res.status(400).json({ 
            error: 'Invalid price parameters',
            message: 'Price values must be positive numbers' 
        });
    }
    
    if (parseFloat(min_price) > parseFloat(max_price)) {
        return res.status(400).json({ 
            error: 'Invalid price range',
            message: 'min_price cannot be greater than max_price' 
        });
    }
    
    const query = 'SELECT * FROM packages WHERE price BETWEEN ? AND ? ORDER BY price ASC';
    
    pool.query(query, [min_price, max_price], (err, result) => {
        if (err) {
            console.error('Failed to fetch packages by price range:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch packages',
                details: err.message 
            });
        }
        
        return res.json({ 
            success: true,
            packages: result,
            count: result.length,
            priceRange: {
                min: parseFloat(min_price),
                max: parseFloat(max_price)
            }
        });
    });
};

// Get active packages only
const getActivePackages = (req, res) => {
    const query = 'SELECT * FROM packages WHERE is_active = 1 ORDER BY price ASC';
    
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Failed to fetch active packages:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch active packages',
                details: err.message 
            });
        }
        
        return res.json({ 
            success: true,
            packages: result,
            count: result.length 
        });
    });
};

// Search packages by name or description
const searchPackages = (req, res) => {
    const { q } = req.query;
    
    if (!q || q.trim().length === 0) {
        return res.status(400).json({ 
            error: 'Missing search query',
            message: 'Search query (q) parameter is required' 
        });
    }
    
    const searchTerm = `%${q.trim()}%`;
    const query = `
        SELECT * FROM packages 
        WHERE (name LIKE ? OR description LIKE ?) 
        AND is_active = 1 
        ORDER BY price ASC
    `;
    
    pool.query(query, [searchTerm, searchTerm], (err, result) => {
        if (err) {
            console.error('Failed to search packages:', err);
            return res.status(500).json({ 
                error: 'Failed to search packages',
                details: err.message 
            });
        }
        
        return res.json({ 
            success: true,
            packages: result,
            count: result.length,
            searchQuery: q.trim()
        });
    });
};

// Get package statistics
const getPackageStats = (req, res) => {
    const query = `
        SELECT 
            COUNT(*) as total_packages,
            COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_packages,
            COUNT(CASE WHEN is_active = 0 THEN 1 END) as inactive_packages,
            MIN(price) as min_price,
            MAX(price) as max_price,
            AVG(price) as avg_price
        FROM packages
    `;
    
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Failed to fetch package statistics:', err);
            return res.status(500).json({ 
                error: 'Failed to fetch package statistics',
                details: err.message 
            });
        }
        
        return res.json({ 
            success: true,
            statistics: result[0] 
        });
    });
};

// Delete packages by exact price (Admin only)
const deletePackageByPrice = (req, res) => {
    const { price } = req.query;

    if (price === undefined) {
        return res.status(400).json({
            error: 'Missing price parameter',
            message: 'Provide price in query string, e.g., ?price=195000'
        });
    }

    const priceNum = Number(price);
    if (!isFinite(priceNum) || priceNum <= 0) {
        return res.status(400).json({
            error: 'Invalid price',
            message: 'price must be a positive number'
        });
    }

    const query = 'DELETE FROM packages WHERE price = ?';

    pool.query(query, [priceNum], (err, result) => {
        if (err) {
            console.error('Failed to delete packages by price:', err);
            return res.status(500).json({
                error: 'Failed to delete packages by price',
                details: err.message
            });
        }

        return res.json({
            success: true,
            message: 'Delete by price completed',
            affectedRows: result.affectedRows,
            price: priceNum
        });
    });
};

module.exports = {
    getAllPackages,
    getPackageById,
    createPackage,
    updatePackage,
    deletePackage,
    getPackagesByPriceRange,
    getActivePackages,
    searchPackages,
    getPackageStats,
    deletePackageByPrice
};
