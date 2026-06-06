const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Чтение .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseServiceKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Ошибка: не найдены NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const action = process.argv[2];
const email = 'temp_manager_test@daraclean.ru';
const password = 'TempPassword123!';

async function run() {
  if (action === 'create') {
    console.log(`Создание временного пользователя ${email}...`);
    // Сначала удалим, если он уже существует, чтобы избежать конфликтов
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error('Ошибка при получении списка пользователей:', listError.message);
      process.exit(1);
    }
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      console.log(`Пользователь ${email} уже существует. Удаляем перед пересозданием...`);
      await supabase.auth.admin.deleteUser(existingUser.id);
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'manager' }
    });

    if (error) {
      console.error('Ошибка при создании пользователя:', error.message);
      process.exit(1);
    }

    console.log('Пользователь успешно создан:', data.user.id);
    console.log('JSON:', JSON.stringify(data.user));
  } else if (action === 'delete') {
    console.log(`Удаление временного пользователя ${email}...`);
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error('Ошибка при получении списка пользователей:', listError.message);
      process.exit(1);
    }
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      const { error } = await supabase.auth.admin.deleteUser(existingUser.id);
      if (error) {
        console.error('Ошибка при удалении пользователя:', error.message);
        process.exit(1);
      }
      console.log('Пользователь успешно удален.');
    } else {
      console.log('Пользователь не найден, удаление не требуется.');
    }
  } else {
    console.error('Неверное действие. Используйте "create" или "delete".');
    process.exit(1);
  }
}

run();
