async function run() {
  const secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90Y2t0Ynl4YXB0eGpua3h5aWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0MjA4NywiZXhwIjoyMDk1OTE4MDg3fQ.HUBSDRvPc7FG8XgbluqQ862ncZH-2oeRaIFxjwhqGPI";
  const sql = "env";
  const url = `https://crm-roan-ten.vercel.app/api/run-sql?secret=${encodeURIComponent(secret)}&sql=${encodeURIComponent(sql)}`;
  
  try {
    const res = await fetch(url);
    const body = await res.text();
    console.log('Status:', res.status);
    console.log('Body:', body);
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}
run();
