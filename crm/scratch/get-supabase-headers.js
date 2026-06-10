async function run() {
  const url = "https://otcktbyxaptxjnkxyili.supabase.co";
  try {
    const res = await fetch(url);
    console.log('Status:', res.status);
    console.log('Headers:');
    for (const [key, val] of res.headers.entries()) {
      console.log(`  ${key}: ${val}`);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}
run();
