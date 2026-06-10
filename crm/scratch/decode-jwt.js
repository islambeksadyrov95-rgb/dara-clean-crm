const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90Y2t0Ynl4YXB0eGpua3h5aWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0MjA4NywiZXhwIjoyMDk1OTE4MDg3fQ.HUBSDRvPc7FG8XgbluqQ862ncZH-2oeRaIFxjwhqGPI";
const payload = jwt.split('.')[1];
const decoded = Buffer.from(payload, 'base64').toString('utf8');
console.log('Decoded payload:', decoded);
