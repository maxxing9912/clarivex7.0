const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verifysettings')
        .setDescription('Configure roles for verification: verified, unverified, and optional bypass')
        .addRoleOption(opt =>
            opt
                .setName('verified_role')
                .setDescription('Role to assign after /verify or /update')
                .setRequired(true)
        )
        .addRoleOption(opt =>
            opt
                .setName('unverified_role')
                .setDescription('Role to remove when the user verifies')
                .setRequired(true)
        )
        .addRoleOption(opt =>
            opt
                .setName('bypass_role')
                .setDescription('Optional role to assign to the verified user (e.g., bypass checks)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guildId;
        const discordUserId = interaction.user.id;

        // 1) Check basic server configuration (e.g., groupId)
        const currentCfg = await setupManager.getConfig(guildId);
        if (!currentCfg?.groupId) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Server Not Configured')
                .setDescription('This server is not configured yet. Use `/setup` first.')
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // 2) Verify invoker is linked to a Roblox account
        const linkedName = await xpDb.getLinked(discordUserId);
        if (!linkedName) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Account Not Linked')
                .setDescription('You have not linked your Roblox username. Run `/verify` first.')
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // 3) Initialize noblox
        try {
            await noblox.setCookie(process.env.ROBLOX_COOKIE);
        } catch (err) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Roblox Initialization Failed')
                .setDescription('Could not initialize noblox.js with the provided cookie.')
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // 4) Get Roblox user ID
        let robloxUserId;
        try {
            robloxUserId = await noblox.getIdFromUsername(linkedName);
        } catch {
            const embed = new EmbedBuilder()
                .setTitle('❌ Username Lookup Failed')
                .setDescription('Could not resolve your linked Roblox username.')
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // 5) Check group rank (255 = Owner)
        let rank;
        try {
            rank = await noblox.getRankInGroup(currentCfg.groupId, robloxUserId);
        } catch (err) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Group Rank Fetch Failed')
                .setDescription(`Error fetching your rank in group ${currentCfg.groupId}: ${err.message}`)
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }
        if (rank !== 255) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Insufficient Permissions')
                .setDescription('Only the **Owner** of the Roblox group can run `/verifysettings`.')
                .setColor(0xED4245)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // 6) Retrieve role options
        const verifiedRole = interaction.options.getRole('verified_role');
        const unverifiedRole = interaction.options.getRole('unverified_role');
        const bypassRoleOption = interaction.options.getRole('bypass_role'); // may be null

        // 7) Save in configuration
        const updateData = {
            verificationRoleId: verifiedRole.id,
            unverifiedRoleId: unverifiedRole.id
        };
        if (bypassRoleOption) {
            updateData.bypassRoleId = bypassRoleOption.id;
        } else {
            // Remove previous bypass if exists
            updateData.bypassRoleId = null;
        }
        await setupManager.updateConfig(guildId, updateData);

        // 8) Confirmation message
        let description = `After /verify or /update, I will remove <@&${unverifiedRole.id}> and assign <@&${verifiedRole.id}>.`;
        if (bypassRoleOption) {
            description += `\nI will also assign the bypass role <@&${bypassRoleOption.id}>.`;
        }
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Verification Settings Saved')
            .setDescription(description)
            .setColor(0x57F287)
            .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
    }
};