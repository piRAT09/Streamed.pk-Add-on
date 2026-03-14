#!/usr/bin/env node

'use strict';

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const PORT = parseInt(process.env.PORT || '7000', 10);

// When deployed, set PUBLIC_URL to your HTTPS domain, e.g.:
//   https://my-addon.railway.app
// This is only used for display purposes in the console.
const PUBLIC_URL = process.env.PUBLIC_URL
  ? process.env.PUBLIC_URL.replace(/\/$/, '')
  : `http://127.0.0.1:${PORT}`;

serveHTTP(addonInterface, { port: PORT });

console.log(`\n🎬 Streamed.pk Stremio Addon`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅  Server running on port ${PORT}`);
console.log(`📡  Manifest:     ${PUBLIC_URL}/manifest.json`);
console.log(`🔗  Install URL:  stremio://${PUBLIC_URL.replace(/^https?:\/\//, '')}/manifest.json`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
