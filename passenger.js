#!/usr/bin/env node
// Passenger.js for Hostinger Node.js hosting
// This file tells Hostinger how to start your Node.js app

const { exec } = require('child_process');
const path = require('path');

// Set production environment
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

// Start the app
require('./app.js');
