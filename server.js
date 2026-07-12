import express from 'express';
import cors from 'cors';
import { dbGet, dbRun, dbAll } from './database.js';

const app = express();
const PORT = process.env.PORT || 4173;

app.use(cors());
app.use(express.json());

// Serve static frontend files from current directory
app.use(express.static('.'));

// Pricing catalog config
const PRODUCTS_INFO = {
  "Organic A2 Milk": { price: 110, unit: "1 L" },
  "Bilona Desi Ghee": { price: 749, unit: "500 ML" },
  "Traditional Dahi": { price: 89, unit: "500 ML" }
};

// API: Batch Traceability Lookup
app.get('/api/batches/:id', async (request, response) => {
  try {
    const batchId = request.params.id.trim();
    const batch = await dbGet('SELECT * FROM batches WHERE id = ?', [batchId]);
    
    if (!batch) {
      return response.status(404).json({ success: false, message: 'Quality batch certificate not found.' });
    }
    
    response.json({ success: true, batch });
  } catch (error) {
    console.error('Error fetching batch quality report:', error);
    response.status(500).json({ success: false, message: 'Server database error.' });
  }
});

// API: Place Order & Create User
app.post('/api/orders', async (request, response) => {
  try {
    const { name, phone, pincode, address, slot, items, payment_method, utr } = request.body;

    if (!name || !phone || !pincode || !address || !slot || !items || !payment_method) {
      return response.status(400).json({ success: false, message: 'Required customer fields are missing.' });
    }

    // 1. Add or Update User Profile
    let user = await dbGet('SELECT id FROM users WHERE phone = ?', [phone]);
    let userId;

    if (user) {
      userId = user.id;
      await dbRun(
        'UPDATE users SET name = ?, pincode = ?, address = ? WHERE id = ?',
        [name, pincode, address, userId]
      );
    } else {
      const result = await dbRun(
        'INSERT INTO users (name, phone, pincode, address) VALUES (?, ?, ?, ?)',
        [name, phone, pincode, address]
      );
      userId = result.lastID;
    }

    // 2. Calculate Total Amount & Process Items
    let totalAmount = 0;
    const orderItemsList = [];

    for (const itemName in items) {
      const { qty, delivery } = items[itemName];
      const product = PRODUCTS_INFO[itemName];
      
      if (product) {
        const itemTotal = product.price * qty;
        totalAmount += itemTotal;
        
        orderItemsList.push({
          name: itemName,
          qty,
          delivery,
          unit: product.unit,
          price: product.price,
          total: itemTotal
        });

        // Save recurring subscriptions if selected
        if (delivery && delivery !== 'one-time') {
          await dbRun(
            'INSERT INTO subscriptions (user_id, product_name, qty, schedule, status) VALUES (?, ?, ?, ?, ?)',
            [userId, itemName, qty, delivery, 'Active']
          );
        }
      }
    }

    // 3. Write Order Registry
    const status = payment_method === 'UPI' ? 'Awaiting Payment Verification' : 'Pending';
    const orderResult = await dbRun(
      'INSERT INTO orders (user_id, items, payment_method, utr, status, delivery_slot, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, JSON.stringify(orderItemsList), payment_method, utr || null, status, slot, totalAmount]
    );

    response.json({
      success: true,
      orderId: orderResult.lastID,
      total: totalAmount,
      message: 'Order created successfully.'
    });

  } catch (error) {
    console.error('Error placing order:', error);
    response.status(500).json({ success: false, message: 'Server database error.' });
  }
});

// API: Save Calendar-Based Subscription
app.post('/api/subscriptions', async (request, response) => {
  try {
    const { name, phone, pincode, address, product_name, qty, schedule, delivery_slot, start_date, custom_dates } = request.body;

    if (!name || !phone || !pincode || !address || !product_name || !qty || !schedule || !delivery_slot) {
      return response.status(400).json({ success: false, message: 'Required subscription fields are missing.' });
    }

    // 1. Add or Update User Profile
    let user = await dbGet('SELECT id FROM users WHERE phone = ?', [phone]);
    let userId;

    if (user) {
      userId = user.id;
      await dbRun(
        'UPDATE users SET name = ?, pincode = ?, address = ? WHERE id = ?',
        [name, pincode, address, userId]
      );
    } else {
      const result = await dbRun(
        'INSERT INTO users (name, phone, pincode, address) VALUES (?, ?, ?, ?)',
        [name, phone, pincode, address]
      );
      userId = result.lastID;
    }

    // 2. Insert Subscription record
    const result = await dbRun(
      'INSERT INTO subscriptions (user_id, product_name, qty, schedule, delivery_slot, start_date, custom_dates, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, product_name, qty, schedule, delivery_slot, start_date || null, custom_dates ? JSON.stringify(custom_dates) : null, 'Active']
    );

    response.json({
      success: true,
      subscriptionId: result.lastID,
      message: 'Subscription created successfully.'
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    response.status(500).json({ success: false, message: 'Server database error.' });
  }
});

// API: Mock Payment Gateway Webhook (Auto-approves orders when UTR is verified)
app.post('/api/webhooks/payment', async (request, response) => {
  try {
    const { utr, status } = request.body;

    if (!utr) {
      return response.status(400).json({ success: false, message: 'Missing transaction details.' });
    }

    const order = await dbGet('SELECT id FROM orders WHERE utr = ?', [utr]);
    
    if (!order) {
      return response.status(404).json({ success: false, message: 'UTR transaction not found.' });
    }

    const newStatus = status === 'success' ? 'Confirmed' : 'Payment Failed';
    await dbRun('UPDATE orders SET status = ? WHERE id = ?', [newStatus, order.id]);

    response.json({ success: true, message: `Order #${order.id} status updated to: ${newStatus}` });
  } catch (error) {
    console.error('Error in payment webhook listener:', error);
    response.status(500).json({ success: false, message: 'Webhook processing error.' });
  }
});

// ADMIN API: Fetch Orders
app.get('/api/admin/orders', async (request, response) => {
  try {
    const query = `
      SELECT orders.*, users.name, users.phone, users.address, users.pincode 
      FROM orders 
      JOIN users ON orders.user_id = users.id 
      ORDER BY orders.created_at DESC
    `;
    const orders = await dbAll(query);
    response.json({ success: true, orders: orders.map(o => ({ ...o, items: JSON.parse(o.items) })) });
  } catch (error) {
    console.error('Error fetching admin orders list:', error);
    response.status(500).json({ success: false, message: 'Database query error.' });
  }
});

// ADMIN API: Update Order Status
app.post('/api/admin/orders/:id/status', async (request, response) => {
  try {
    const orderId = request.params.id;
    const { status } = request.body;

    if (!status) {
      return response.status(400).json({ success: false, message: 'Status field required.' });
    }

    await dbRun('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    response.json({ success: true, message: `Order #${orderId} status changed to ${status}.` });
  } catch (error) {
    console.error('Error changing order status:', error);
    response.status(500).json({ success: false, message: 'Database write error.' });
  }
});

// ADMIN API: Fetch Subscriptions
app.get('/api/admin/subscriptions', async (request, response) => {
  try {
    const query = `
      SELECT subscriptions.*, users.name, users.phone, users.address, users.pincode 
      FROM subscriptions 
      JOIN users ON subscriptions.user_id = users.id 
      ORDER BY subscriptions.created_at DESC
    `;
    const subscriptions = await dbAll(query);
    response.json({ success: true, subscriptions });
  } catch (error) {
    console.error('Error loading admin subscriptions:', error);
    response.status(500).json({ success: false, message: 'Database query error.' });
  }
});

// ADMIN API: Insert Batch Report
app.post('/api/admin/batches', async (request, response) => {
  try {
    const { id, product_name, date, fat, snf, antibiotics, quality_score } = request.body;

    if (!id || !product_name || !date || fat === undefined || snf === undefined || quality_score === undefined) {
      return response.status(400).json({ success: false, message: 'Required fields missing.' });
    }

    await dbRun(
      'INSERT OR REPLACE INTO batches (id, product_name, date, fat, snf, antibiotics, quality_score) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, product_name, date, fat, snf, antibiotics ? 1 : 0, quality_score]
    );

    response.json({ success: true, message: `Batch ${id} added successfully.` });
  } catch (error) {
    console.error('Error adding batch:', error);
    response.status(500).json({ success: false, message: 'Database write error.' });
  }
});

app.listen(PORT, () => {
  console.log(`Samara Full-Stack Server running at: http://127.0.0.1:${PORT}`);
});
