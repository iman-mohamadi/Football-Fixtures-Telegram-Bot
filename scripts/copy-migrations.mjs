import { cpSync } from 'node:fs';
cpSync('src/database/migrations', 'dist/database/migrations', { recursive: true });
