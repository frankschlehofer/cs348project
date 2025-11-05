const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// app and database setup
const app = express();
app.use(cors()); // Allow frontend to call backend
app.use(express.json()); // Parse JSON request bodies

const PORT = 3000;
// create db:  'inventory.db'
const db = new sqlite3.Database('./inventory.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the inventory database.');
});

// Database initialization. Runs once when the server starts.
db.serialize(() => {
    console.log('Initializing database.');
    
    // Categories Table
    db.run(`
        CREATE TABLE IF NOT EXISTS Categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_name TEXT NOT NULL UNIQUE
        )
    `, (err) => ifExists(err, 'Categories'));

    // Products Table
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

    // Some data to have right away in the db for demo
    const seedCategories = 'INSERT OR IGNORE INTO Categories (category_name) VALUES (?), (?), (?)';
    db.run(seedCategories, ['Electronics', 'Books', 'Groceries'], (err) => ifExists(err, 'Seeded Categories'));

    const seedProducts = 'INSERT OR IGNORE INTO Products (product_name, price, stock_quantity, category_id) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)';
    db.run(seedProducts, [
        'Laptop', 699.99, 10, 1,
        'Science Fiction Novel', 14.50, 50, 2,
        'Apples', 0.99, 200, 3
    ], (err) => ifExists(err, 'Seeded Products'));
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


// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
