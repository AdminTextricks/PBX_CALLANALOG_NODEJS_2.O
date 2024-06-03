// src/index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);


db.connect(err => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to database.');
});

io.on('connection', (socket) => {
    console.log('A user connected.');

    // Handle user login
    socket.on('login', (userId) => {
        console.log(`User ${userId} logged in.`);
        socket.userId = userId;

        // Fetch the user's initial balance from the database
        db.query('SELECT balance FROM users WHERE id = ?', [userId], (error, results) => {
            if (error) {
                console.error('Error fetching balance:', error);
                socket.emit('error', 'Error fetching balance');
                return;
            }
            const balance = results.length > 0 ? results[0].balance : 0;
            socket.emit('balance', balance);
        });

        // Listen for balance changes
        const balanceCheckInterval = setInterval(() => {
            db.query('SELECT balance FROM users WHERE id = ?', [userId], (error, results) => {
                if (error) {
                    console.error('Error fetching balance:', error);
                    return;
                }
                const balance = results.length > 0 ? results[0].balance : 0;
                socket.emit('balance', balance);
            });
        }, 5000); // Check every 5 seconds

        socket.balanceCheckInterval = balanceCheckInterval;
    });

    // Handle user logout
    socket.on('logout', (userId) => {
        console.log(`User ${userId} logged out.`);
        if (socket.balanceCheckInterval) {
            clearInterval(socket.balanceCheckInterval);
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected.');
        if (socket.balanceCheckInterval) {
            clearInterval(socket.balanceCheckInterval);
        }
    });
});

server.listen(3000, () => {
    console.log('Server is listening on port 3000');
});
