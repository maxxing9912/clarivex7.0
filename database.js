// database.js
require('dotenv').config();

const { Pool } = require('pg');

let pool = null;

if (process.env.DATABASE_URL) {
    const connStr = process.env.DATABASE_URL;
    // Crea un pool temporaneo
    const tempPool = new Pool({
        connectionString: connStr,
        ssl: {
            rejectUnauthorized: false
        }
    });

    // Proviamo subito a connetterci: se fallisce, annulliamo pool
    tempPool.connect()
        .then(client => {
            client.release();
            console.log('database.js: Connessione a PostgreSQL riuscita, pool attivo');
            pool = tempPool;
            // Gestione errori runtime
            pool.on('error', (err) => {
                console.error('database.js: Errore non gestito sul client PostgreSQL:', err);
            });
        })
        .catch(err => {
            console.warn('database.js: Impossibile connettersi a PostgreSQL, pool disabilitato:', err.code || err.message);
            // Chiudiamo tempPool
            tempPool.end().catch(() => { });
            pool = null;
        });
} else {
    console.log('database.js: DATABASE_URL non impostato, nessuna connessione DB verrà effettuata');
}

module.exports = {
    query: async (text, params) => {
        if (!pool) {
            throw new Error('DB non configurato o non raggiungibile: query ignorata');
        }
        return pool.query(text, params);
    },
    get pool() {
        return pool;
    }
};