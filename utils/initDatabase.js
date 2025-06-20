// utils/initDatabase.js
const db = require('../database');

async function initDatabase() {
    // Skip se DATABASE_URL non è definito o pool non creato
    if (!process.env.DATABASE_URL) {
        console.log('initDatabase: DATABASE_URL non impostato, skip creazione tabelle');
        return;
    }
    if (!db.pool) {
        console.log('initDatabase: db.pool non definito, skip creazione tabelle');
        return;
    }

    try {
        // settings
        await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    JSONB NOT NULL,
        PRIMARY KEY (guild_id, key)
      );
    `);
        // xp
        await db.query(`
      CREATE TABLE IF NOT EXISTS xp (
        user_id TEXT PRIMARY KEY,
        xp      INTEGER NOT NULL DEFAULT 0
      );
    `);
        // warnings
        await db.query(`
      CREATE TABLE IF NOT EXISTS warnings (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        warning TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id);`);
        // badges
        await db.query(`
      CREATE TABLE IF NOT EXISTS badges (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        badge_name TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id, badge_name)
      );
    `);
        // verif_codes
        await db.query(`
      CREATE TABLE IF NOT EXISTS verif_codes (
        user_id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // temp_users
        await db.query(`
      CREATE TABLE IF NOT EXISTS temp_users (
        user_id TEXT PRIMARY KEY,
        roblox_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // links
        await db.query(`
      CREATE TABLE IF NOT EXISTS links (
        user_id TEXT PRIMARY KEY,
        roblox_name TEXT NOT NULL
      );
    `);
        // xp_configs
        await db.query(`
      CREATE TABLE IF NOT EXISTS xp_configs (
        guild_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
        // premium_users
        await db.query(`
      CREATE TABLE IF NOT EXISTS premium_users (
        user_id TEXT PRIMARY KEY,
        is_premium BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // guild_premiums
        await db.query(`
      CREATE TABLE IF NOT EXISTS guild_premiums (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        is_premium BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, user_id)
      );
    `);
        // setupManager tables
        await db.query(`
      CREATE TABLE IF NOT EXISTS configs (
        guild_id TEXT PRIMARY KEY,
        data     JSONB NOT NULL
      );
    `);
        await db.query(`
      CREATE TABLE IF NOT EXISTS pending_setups (
        guild_id TEXT PRIMARY KEY,
        data     JSONB NOT NULL
      );
    `);
        await db.query(`
      CREATE TABLE IF NOT EXISTS pending_transfers (
        guild_id TEXT PRIMARY KEY,
        data     JSONB NOT NULL
      );
    `);
        // anti-raid
        await db.query(`
      CREATE TABLE IF NOT EXISTS anti_raid_configs (
        guild_id TEXT PRIMARY KEY,
        data     JSONB NOT NULL
      );
    `);
        await db.query(`
      CREATE TABLE IF NOT EXISTS anti_raid_joins (
        guild_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        ts BIGINT NOT NULL,
        PRIMARY KEY (guild_id, member_id, ts)
      );
    `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_anti_raid_joins_guild_ts ON anti_raid_joins(guild_id, ts);`);
        // backups
        await db.query(`
      CREATE TABLE IF NOT EXISTS backups (
        guild_id TEXT NOT NULL,
        backup_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // permManager tables
        await db.query(`
      CREATE TABLE IF NOT EXISTS guild_owners (
        guild_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
    `);
        await db.query(`
      CREATE TABLE IF NOT EXISTS user_ranks (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

        console.log('initDatabase: inizializzazione tabelle completata');
    } catch (err) {
        if (err.code === 'ECONNREFUSED' ||
            (err instanceof AggregateError && err.errors?.some(e => e.code === 'ECONNREFUSED'))) {
            console.warn('initDatabase: connessione DB rifiutata, verifica server/Postgres o DATABASE_URL');
        } else {
            console.error('initDatabase error:', err);
        }
        // Non rilancia: il bot continua comunque
    }
}

module.exports = initDatabase;