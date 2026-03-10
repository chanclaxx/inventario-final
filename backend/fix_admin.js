const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  database: 'inventario_db',
  password: 'root',
  host: 'localhost',
  port: 5432,
});

bcrypt.hash('Caro4499.', 10).then(hash => {
  return pool.query(
    'UPDATE superadmins SET password_hash = $1 WHERE email = $2',
    [hash, 'miguel@angel.com']
  );
}).then(() => {
  console.log('Superadmin actualizado correctamente');
  pool.end();
}).catch(err => {
  console.error('Error:', err.message);
  pool.end();
});