import { spawn } from 'child_process';
import path from 'path';

// Parse command-line args for `-o <mode>`
const args = process.argv.slice(2);
let appMode = '1'; // Default is old layout

const modeIndex = args.indexOf('-o');
if (modeIndex !== -1 && args[modeIndex + 1]) {
    appMode = args[modeIndex + 1];
}

console.log(`\n🚀 Starting Nu7 Studio in Mode: ${appMode} 🚀\n`);

const env = {
    ...process.env,
    VITE_APP_MODE: appMode
};

// 1. Run Database setup synchronously
console.log('📦 Setting up database...');
const dbSetup = spawn('npm run db:up && npm run db:push', {
    stdio: 'inherit',
    shell: true,
    env: env
});

dbSetup.on('close', (code) => {
    if (code !== 0) {
        console.error(`❌ Database setup failed with code ${code}`);
        process.exit(code);
    }

    console.log('🚀 Database ready. Starting dev servers...\n');

    // 2. Start Dev Servers concurrently
    const commands = [
        `"npm run dev:backend"`,
        `"npm run dev:frontend"`
    ];

    const commandStr = `npx concurrently ${commands.join(' ')}`;

    const runner = spawn(commandStr, {
        stdio: 'inherit',
        shell: true,
        env: env
    });

    runner.on('close', (exitCode) => {
        process.exit(exitCode);
    });
});
