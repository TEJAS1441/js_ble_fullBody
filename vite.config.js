import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        watch: {
            ignored: ['**/s2s/**', '**/s2s /**', '**/node_modules/**', '**/.git/**', '**/.venv/**']
        }
    }
});
