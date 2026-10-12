require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('../db/pool');
const { hashPassword } = require('../utils/password');

// Transliteration for generating usernames
const translit = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
  'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
  'ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};

function translitName(str) {
  return str.toLowerCase().split('').map(c => translit[c] ?? (c === ' ' ? '_' : c)).join('');
}

function makeUsername(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts[0] || 'user';
  return translitName(lastName).replace(/[^a-z0-9_]/g, '');
}

async function run() {
  console.log('Importing employees from employees_s...');

  const { rows: oldEmployees } = await pool.query(
    'SELECT id, full_name, department_name, position_name FROM employees_s WHERE active = true ORDER BY full_name'
  );

  console.log(`Found ${oldEmployees.length} employees`);
  const defaultPassword = process.env.SEED_PASSWORD || 'changeme';
  const results = [];

  for (const emp of oldEmployees) {
    try {
      // Insert/update employee
      const empRes = await pool.query(
        `INSERT INTO employees_s (full_name, position)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [emp.full_name, [emp.department_name, emp.position_name].filter(Boolean).join(' · ') || null]
      );

      let empId;
      if (empRes.rows.length > 0) {
        empId = empRes.rows[0].id;
      } else {
        const existing = await pool.query(
          'SELECT id FROM employees_s WHERE full_name = $1', [emp.full_name]
        );
        empId = existing.rows[0]?.id;
      }

      if (!empId) continue;

      // Generate unique username
      let username = makeUsername(emp.full_name);
      const conflict = await pool.query('SELECT id FROM users_s WHERE username = $1', [username]);
      if (conflict.rows.length > 0) {
        username = username + Math.floor(Math.random() * 90 + 10);
      }

      const hash = await hashPassword(defaultPassword);
      const userRes = await pool.query(
        `INSERT INTO users_s (username, password_hash, role, employee_id)
         VALUES ($1, $2, 'employee', $3)
         ON CONFLICT DO NOTHING
         RETURNING id, username`,
        [username, hash, empId]
      );

      results.push({
        full_name: emp.full_name,
        position: emp.position_name || '—',
        username: userRes.rows[0]?.username || '(уже существует)',
        password: defaultPassword,
        employee_id: empId,
      });

      console.log(`✓ ${emp.full_name} → ${userRes.rows[0]?.username || 'exists'}`);
    } catch (err) {
      console.error(`✗ ${emp.full_name}: ${err.message}`);
    }
  }

  console.log('\n=== РЕЗУЛЬТАТ ИМПОРТА ===');
  console.log(`Создано: ${results.filter(r => !r.username.includes('существует')).length}`);
  console.log('\nЛогины и пароли:');
  for (const r of results) {
    console.log(`  ${r.full_name.padEnd(35)} | ${r.username.padEnd(20)} | ${r.password}`);
  }

  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
