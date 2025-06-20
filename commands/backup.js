// commands/backup.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const backupManager = require('../utils/backupManager');
const keyManager = require('../utils/keyManager');
const xpDb = require('../xpManager');
const noblox = require('noblox.js');
const setupManager = require('../utils/setupManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Server configuration backups')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new backup of this server’s settings')
        ),

    async execute(interaction) {
        const discordId = interaction.user.id;

        // 1️⃣ Check if user has Premium access
        if (!keyManager.isPremium(discordId)) {
            return interaction.reply({
                content: '❌ You need Premium access to use this command.',
                ephemeral: true
            });
        }

        // 2️⃣ Check if user has linked Roblox account
        const robloxName = await xpDb.getLinked(discordId);
        if (!robloxName) {
            return interaction.reply({
                content: '❌ You have not linked a Roblox account.',
                ephemeral: true
            });
        }

        // 3️⃣ Initialize noblox with Roblox cookie
        await noblox.setCookie(process.env.ROBLOX_COOKIE);

        let robloxUserId;
        try {
            robloxUserId = await noblox.getIdFromUsername(robloxName);
        } catch {
            return interaction.reply({
                content: '❌ Failed to resolve your linked Roblox username.',
                ephemeral: true
            });
        }

        // 4️⃣ Get Roblox group ID from config
        const cfg = setupManager.getConfig(discordId);
        const groupId = cfg?.groupId;
        if (!groupId) {
            return interaction.reply({
                content: '❌ The bot hasn’t been set up with a Roblox group yet.',
                ephemeral: true
            });
        }

        // 5️⃣ Check if user is group owner (rank 255)
        let rank;
        try {
            rank = await noblox.getRankInGroup(groupId, robloxUserId);
        } catch (err) {
            return interaction.reply({
                content: `❌ Error fetching group rank: ${err.message}`,
                ephemeral: true
            });
        }

        if (rank !== 255) {
            return interaction.reply({
                content: '❌ You must be the **Owner** of the linked Roblox group to run backups.',
                ephemeral: true
            });
        }

        // 6️⃣ All checks passed → create the backup
        const backupId = await backupManager.createBackup(interaction.guild);

        const embed = new EmbedBuilder()
            .setTitle('🗄️ Backup Created')
            .setDescription(`Backup ID: \`${backupId}\`\nUse \`/backup restore ${backupId}\` to restore.`)
            .setColor(0x00AE86)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};