async function run() {
  const url = "https://otcktbyxaptxjnkxyili.supabase.co/rest/v1/";
  const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90Y2t0Ynl4YXB0eGpua3h5aWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0MjA4NywiZXhwIjoyMDk1OTE4MDg3fQ.HUBSDRvPc7FG8XgbluqQ862ncZH-2oeRaIFxjwhqGPI";
  
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const spec = await res.json();
    console.log('OpenAPI Paths:');
    const paths = Object.keys(spec.paths || {});
    const rpcPaths = paths.filter(p => p.startsWith('/rpc/'));
    console.log('RPC Functions:', rpcPaths);
    
    // Также выведем все таблицы
    const tables = paths.filter(p => !p.startsWith('/rpc/'));
    console.log('Tables:', tables);
  } catch (e) {
    console.error('Error fetching spec:', e.message);
  }
}
run();
