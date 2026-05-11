const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');

const ENV_PATH = path.join(__dirname, '.env');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function loadEnv() {
    if (!fs.existsSync(ENV_PATH)) {
        return {};
    }
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const config = {};
    content.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length === 2) {
            config[parts[0].trim()] = parts[1].trim();
        }
    });
    return config;
}

function saveEnv(config) {
    const lines = Object.entries(config).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

async function testConnection(config) {
    console.log('\n[TEST] Attempting to connect to MySQL...');
    try {
        const connection = await mysql.createConnection({
            host: config.EQEMU_HOST || '127.0.0.1',
            port: parseInt(config.EQEMU_PORT) || 3307,
            user: config.EQEMU_USER || 'eqemu',
            password: config.EQEMU_PASSWORD || '',
            database: config.EQEMU_DATABASE || 'peq'
        });
        console.log('✅ Connection Successful!');
        await connection.end();
    } catch (err) {
        console.log('❌ Connection Failed:', err.message);
    }
}

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function mainMenu() {
    const config = loadEnv();

    // Ensure defaults are present if missing
    if (!config.PORT) config.PORT = '3005';
    if (!config.PUBLIC_HOST) config.PUBLIC_HOST = 'localhost';
    if (!config.MARIADB_CONTAINER) config.MARIADB_CONTAINER = 'akk-stack-mariadb-1';

    while (true) {
        console.clear();
        console.log('========================================');
        console.log('      🛠️  EQMUD SERVER TOOLKIT         ');
        console.log('========================================');
        console.log(` 1. Game Port:           ${config.PORT}`);
        console.log(` 2. Public Host:         ${config.PUBLIC_HOST}     (advertised to remote clients)`);
        console.log('----------------------------------------');
        console.log(` 3. DB Host:             ${config.EQEMU_HOST || '127.0.0.1'}`);
        console.log(` 4. DB Port:             ${config.EQEMU_PORT || '3307'}`);
        console.log(` 5. DB User:             ${config.EQEMU_USER || 'eqemu'}`);
        console.log(` 6. DB Password:         ${config.EQEMU_PASSWORD ? '********' : '(empty)'}`);
        console.log(` 7. DB Name:             ${config.EQEMU_DATABASE || 'peq'}`);
        console.log(` 8. MariaDB Container:   ${config.MARIADB_CONTAINER}`);
        console.log('----------------------------------------');
        console.log(' 9. Test DB Connection');
        console.log('10. Save and Exit');
        console.log('11. Exit Without Saving');
        console.log('========================================');

        const choice = (await ask('Choice (1-11): ')).trim();

        switch (choice) {
            case '1':  config.PORT              = await ask(`New Port [${config.PORT}]: `) || config.PORT; break;
            case '2':  config.PUBLIC_HOST       = await ask(`New Public Host [${config.PUBLIC_HOST}]: `) || config.PUBLIC_HOST; break;
            case '3':  config.EQEMU_HOST        = await ask(`New DB Host [${config.EQEMU_HOST}]: `) || config.EQEMU_HOST; break;
            case '4':  config.EQEMU_PORT        = await ask(`New DB Port [${config.EQEMU_PORT}]: `) || config.EQEMU_PORT; break;
            case '5':  config.EQEMU_USER        = await ask(`New DB User [${config.EQEMU_USER}]: `) || config.EQEMU_USER; break;
            case '6':  config.EQEMU_PASSWORD    = await ask(`New DB Password: `); break;
            case '7':  config.EQEMU_DATABASE    = await ask(`New DB Name [${config.EQEMU_DATABASE}]: `) || config.EQEMU_DATABASE; break;
            case '8':  config.MARIADB_CONTAINER = await ask(`New Container Name [${config.MARIADB_CONTAINER}]: `) || config.MARIADB_CONTAINER; break;
            case '9':  await testConnection(config); await ask('\nPress Enter to continue...'); break;
            case '10':
                saveEnv(config);
                console.log('✅ Configuration saved.');
                rl.close();
                return;
            case '11':
                rl.close();
                return;
        }
    }
}

mainMenu();
