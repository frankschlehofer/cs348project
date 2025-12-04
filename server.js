const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// app and database setup
const app = express();
app.use(cors()); 
app.use(express.json()); 

const PORT = 3000;
// create db:  'inventory.db'
const db = new sqlite3.Database('./inventory.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the inventory database.');
});

db.serialize(() => {
    console.log('Initializing database.');
    
    // Categories Table (Existing)
    db.run(`
        CREATE TABLE IF NOT EXISTS Categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_name TEXT NOT NULL UNIQUE
        )
    `, (err) => ifExists(err, 'Categories'));

    // Products Table (Existing)
    db.run(`
        CREATE TABLE IF NOT EXISTS Products (
            product_id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            price REAL NOT NULL,
            stock_quantity INTEGER NOT NULL,
            category_id INTEGER,
            FOREIGN KEY (category_id) REFERENCES Categories (category_id)
        )
    `, (err) => ifExists(err, 'Products'));

    // Index 1: Supports sorting by product name in the report.
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_product_name ON Products (product_name);
    `, (err) => ifExists(err, 'Index on Products(product_name)'));

    // Index 2: Supports the range filtering on price and quantity in the report.
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_price_qty ON Products (price, stock_quantity);
    `, (err) => ifExists(err, 'Index on Products(price, stock_quantity)'));
});

// Helper for cleaner startup logging
function ifExists(err, tableName) {
    if (err && err.message.includes('already exists')) {
    } else if (err) {
        console.error(err.message);
    } else {
        console.log(`Table/Data '${tableName}' is ready.`);
    }
}


// API

// Get all categories to build the dynamic UI
app.get('/api/categories', (req, res) => {
    const sql = "SELECT * FROM Categories ORDER BY category_name";
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get all products with filtering
app.get('/api/products', (req, res) => {
    const { minPrice, maxPrice, minQty, maxQty } = req.query;
    
    let sql = `
        SELECT p.product_id, p.product_name, p.price, p.stock_quantity, c.category_name 
        FROM Products p
        JOIN Categories c ON p.category_id = c.category_id
    `;
    const params = [];
    const whereClauses = [];

    if (minPrice) {
        whereClauses.push("p.price >= ?");
        params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
        whereClauses.push("p.price <= ?");
        params.push(parseFloat(maxPrice));
    }
    if (minQty) {
        whereClauses.push("p.stock_quantity >= ?");
        params.push(parseInt(minQty));
    }
    if (maxQty) {
        whereClauses.push("p.stock_quantity <= ?");
        params.push(parseInt(maxQty));
    }

    if (whereClauses.length > 0) {
        sql += " WHERE " + whereClauses.join(" AND ");
    }
    sql += " ORDER BY p.product_name";

    // Use db.all for parameterized queries to prevent SQL injection (Stage 3a)
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Insert/create a new category
app.post('/api/categories', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ message: "Category name is required" });
    }
    const sql = "INSERT INTO Categories (category_name) VALUES (?)";
    db.run(sql, [name], function(err) {
        if (err && err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ message: "Category already exists." });
        }
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // Respond with the newly created category
        res.status(201).json({ 
            id: this.lastID, 
            name: name 
        });
    });
});

// Insert/create a new product
app.post('/api/products', (req, res) => {
    const { name, price, quantity, category_id } = req.body;
    const sql = "INSERT INTO Products (product_name, price, stock_quantity, category_id) VALUES (?, ?, ?, ?)";
    const params = [name, price, quantity, category_id];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID });
    });
});

//  Update a product
app.put('/api/products/:id', (req, res) => {
    const { name, price, quantity, category_id } = req.body;
    const id = req.params.id;
    const sql = `
        UPDATE Products 
        SET product_name = ?, price = ?, stock_quantity = ?, category_id = ?
        WHERE product_id = ?
    `;
    const params = [name, price, quantity, category_id, id];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: "Product not found" });
        res.json({ message: "Updated successfully", changes: this.changes });
    });
});

// Delete a product
app.delete('/api/products/:id', (req, res) => {
    const id = req.params.id;
    const sql = "DELETE FROM Products WHERE product_id = ?";
    
    db.run(sql, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: "Product not found" });
        res.json({ message: "Deleted successfully", changes: this.changes });
    });
});

app.post('/api/inventory/adjust', (req, res) => {
    const { from_product_id, to_product_id, quantity } = req.body;
    
    // Start Transaction
    db.run('BEGIN TRANSACTION;', (err) => {
        if (err) return res.status(500).json({ error: "Failed to begin transaction: " + err.message });

        // Operation 1: Decrease stock from the source product. 
        // The WHERE clause checks if there is sufficient stock to ensure integrity.
        const sql1 = "UPDATE Products SET stock_quantity = stock_quantity - ? WHERE product_id = ? AND stock_quantity >= ?";
        db.run(sql1, [quantity, from_product_id, quantity], function (err) {
            if (err || this.changes === 0) {
                // Rollback if there's an error or if not enough stock was available
                return db.run('ROLLBACK;', () => res.status(400).json({ 
                    message: "Transaction rolled back: Insufficient stock or source product not found.",
                    error: err ? err.message : "No changes made (Check stock and product ID)"
                }));
            }

            // Operation 2: Increase stock in the destination product.
            const sql2 = "UPDATE Products SET stock_quantity = stock_quantity + ? WHERE product_id = ?";
            db.run(sql2, [quantity, to_product_id], function (err) {
                if (err || this.changes === 0) {
                    // Rollback if there's an error in the second query or if the destination product is invalid
                    return db.run('ROLLBACK;', () => res.status(400).json({ 
                        message: "Transaction rolled back: Destination product not found.",
                        error: err ? err.message : "No changes made to destination product"
                    }));
                }
                
                // If both operations succeed, commit the transaction
                db.run('COMMIT;', (err) => {
                    if (err) {
                        // This handles a rare case where commit fails, logging an inconsistency risk.
                        return res.status(500).json({ message: "Commit failed (data consistency risk).", error: err.message });
                    }
                    res.json({ message: "Inventory adjustment successful (Atomic Transaction)." });
                });
            });
        });
    });
});


// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
