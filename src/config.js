import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  PORT: process.env.PORT || 17890,
  CONFIG_DIR: process.env.CONFIG_DIR || '/config',
  STAGING_DIR: process.env.STAGING_DIR || '/music/_staging',
  LIBRARY_DIR: process.env.LIBRARY_DIR || '/music/Library',
  DEFAULT_SERVICE: process.env.DEFAULT_SERVICE || 'migu',
  DB_PATH: path.join(process.env.CONFIG_DIR || '/config', 'db.sqlite')
};
