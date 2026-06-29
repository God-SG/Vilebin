import { createPool } from 'mysql2/promise';

const pool = createPool({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '',
  database: 'vilebin',
  waitForConnections: true,
  charset: 'utf8mb4'
});

export default pool;