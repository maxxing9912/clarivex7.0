// deploy-commands.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const clientId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID; // optional: test guild ID
const nodeEnv = process.env.NODE_ENV || 'production'; // 'development' for guild-only, else global

if (!clientId || !token) {
    console.error('❌ You must set DISCORD_CLIENT_ID and DISCORD_TOKEN in .env');
    process.exit(1);
}

// Quick DNS check
(async () => {
    try {
        await dns.lookup('discord.com');
    } catch (err) {
        console.error('❌ DNS lookup failed:', err.message);
        process.exit(1);
    }
})();

const commandsDir = path.join(__dirname, 'commands');
const commands = [];

for (const file of fs.readdirSync(commandsDir)) {
    if (!file.endsWith('.js')) continue;
    const cmd = require(path.join(commandsDir, file));
    if (cmd.data?.toJSON) {
        commands.push(cmd.data.toJSON());
        console.log(`✅ Loaded command: ${cmd.data.name}`);
    } else {
        console.warn(`⚠️ Skipping ${file}: no data.toJSON()`);
    }
}

if (commands.length === 0) {
    console.warn('⚠️ No commands to register.');
    process.exit(0);
}

const rest = new REST({ version: '10', requestTimeout: 60_000 }).setToken(token);

(async () => {
    try {
        // Determine scope: if in development mode and guildId provided, register to guild only.
        // Otherwise, register globally.
        if (nodeEnv === 'development' && guildId) {
            // 1) Replace guild commands:
            console.log(`🚀 [DEV] Registering ${commands.length} commands to guild ${guildId} (immediate)…`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands }
            );
            console.log('✅ Guild commands registered successfully.');
            // Optionally: clean up global commands if they exist and you want no duplicates globally:
            // Fetch global commands and delete those not in current list.
            const existingGlobal = await rest.get(Routes.applicationCommands(clientId));
            const currentNames = new Set(commands.map(c => c.name));
            for (const cmd of existingGlobal) {
                if (!currentNames.has(cmd.name)) {
                    await rest.delete(Routes.applicationCommand(clientId, cmd.id));
                    console.log(`🗑️ Deleted global command not in source: ${cmd.name}`);
                }
            }
            console.log('ℹ️ Cleaned up global commands not in current folder (if any).');
        } else {
            // 2) Register global commands:
            console.log(`🚀 Registering ${commands.length} global commands…`);
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            console.log('✅ Global commands registered successfully. Note: propagation can take up to 1 hour.');
            // Optionally: clean up test-guild commands if guildId is set:
            if (guildId) {
                const existingGuild = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
                const currentNames = new Set(commands.map(c => c.name));
                for (const cmd of existingGuild) {
                    if (!currentNames.has(cmd.name)) {
                        await rest.delete(Routes.applicationCommand(clientId, guildId, cmd.id));
                        console.log(`🗑️ Deleted guild command not in source: ${cmd.name}`);
                    }
                }
                console.log('ℹ️ Cleaned up guild commands not in current folder (if any).');
            }
        }
    } catch (err) {
        console.error('❌ Failed to register/cleanup commands:', err);
        process.exit(1);
    }
})();