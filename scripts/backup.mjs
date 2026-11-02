import { readFile } from 'node:fs/promises';
import { createBackup, restoreBackup } from '../src/backup.mjs';
const [mode, source, destination] = process.argv.slice(2);
if (!['create','restore'].includes(mode) || !source || !destination || !process.env.FLASHFIRM_BACKUP_KEY_FILE) throw Error('Usage: FLASHFIRM_BACKUP_KEY_FILE=/secure/key node scripts/backup.mjs create|restore source destination');
const key=await readFile(process.env.FLASHFIRM_BACKUP_KEY_FILE);
console.log(JSON.stringify(await (mode==='create'?createBackup:restoreBackup)(source,destination,key)));
