require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: parseInt(process.env.EQEMU_PORT || '3307'),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'eqemu',
  });
  const [doors] = await pool.query("SELECT id, doorid, name, triggerdoor FROM doors WHERE zone='gfaydark'");
  
  let noobButtonDown = doors.find(d => d.id === 5045); // Assuming 5045 is Noob down
  console.log("Noob Button Down:", noobButtonDown);
  
  let target1 = doors.find(d => d.doorid === noobButtonDown.triggerdoor);
  console.log("Target for Noob Down:", target1);
  
  let podButtonDown = doors.find(d => d.id === 5038);
  console.log("PoD Button Down:", podButtonDown);
  
  let target2 = doors.find(d => d.doorid === podButtonDown.triggerdoor);
  console.log("Target for PoD Down:", target2);
  
  pool.end();
})();
