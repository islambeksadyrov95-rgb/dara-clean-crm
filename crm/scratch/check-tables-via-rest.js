async function checkTable(tableName) {
  const url = `https://otcktbyxaptxjnkxyili.supabase.co/rest/v1/${tableName}?select=*`;
  const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90Y2t0Ynl4YXB0eGpua3h5aWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0MjA4NywiZXhwIjoyMDk1OTE4MDg3fQ.HUBSDRvPc7FG8XgbluqQ862ncZH-2oeRaIFxjwhqGPI";
  
  console.log(`Checking table ${tableName} via REST...`);
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const body = await res.json();
    console.log(`Status for ${tableName}:`, res.status);
    console.log(`Response for ${tableName}:`, body);
  } catch (e) {
    console.error(`Error checking ${tableName}:`, e.message);
  }
}

async function run() {
  await checkTable('broadcast_templates');
  await checkTable('broadcast_logs');
}

run();
