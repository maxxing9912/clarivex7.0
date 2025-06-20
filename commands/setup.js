// commands/setup.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags
} = require('discord.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');
const noblox = require('noblox.js');

const PENDING_CHANNEL_ID = '1382426084028584047';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Create a pending setup request for your Roblox group')
    .addStringOption(opt =>
      opt
        .setName('groupid')
        .setDescription('Your Roblox Group ID (you must be the group owner)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('premiumkey')
        .setDescription('(Optional) Premium serial key')
        .setRequired(false)
    ),

  async execute(interaction) {
    // 1) Defer reply (ephemeral to the user)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;
    const groupId = interaction.options.getString('groupid');
    const premiumKey = interaction.options.getString('premiumkey') ?? null;

    // 2) Check if this group is already configured in another server
    const otherGuild = await setupManager.findGuildByGroupId(groupId);
    if (otherGuild && otherGuild !== guildId) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🚫 Group Already Configured')
            .setDescription('This Roblox group is already configured in another server.')
            .setColor(0xED4245)
            .setTimestamp()
        ]
      });
    }

    // 3) Check for pending setup elsewhere
    const pendingElsewhere = await setupManager.findPendingGuildByGroupId(groupId);
    if (pendingElsewhere && pendingElsewhere !== guildId) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🚫 Pending Setup Exists Elsewhere')
            .setDescription('There is already a pending setup request for this group in another server.')
            .setColor(0xED4245)
            .setTimestamp()
        ]
      });
    }

    // 4) Check if *this* server is already configured
    const existingConfig = await setupManager.getConfig(guildId);
    if (existingConfig?.groupId) {
      if (existingConfig.groupId === groupId) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🚫 Already Configured')
              .setDescription('This server is already configured with that same Roblox group.')
              .setColor(0xED4245)
              .setTimestamp()
          ]
        });
      } else {
        return interaction.editReply({
          content: '❌ You already have a different group configured. Use `/transfer-group` to change it.'
        });
      }
    }

    // 5) Check if *this* server already has a pending setup
    const existingPending = await setupManager.getPendingSetup(guildId);
    if (existingPending) {
      if (existingPending.groupId === groupId) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🚫 Pending Setup Already Exists')
              .setDescription('You already have a pending setup request for this group in this server.')
              .setColor(0xED4245)
              .setTimestamp()
          ]
        });
      } else {
        return interaction.editReply({
          content: '❌ You already have a pending setup. Use `/transfer-group` or wait for confirmation.'
        });
      }
    }

    // 6) Fetch group info from Roblox and verify ownership
    let groupInfo;
    try {
      groupInfo = await noblox.getGroup(parseInt(groupId, 10));
    } catch {
      return interaction.editReply({
        content: '❌ Unable to fetch group info. Please check the Group ID.'
      });
    }
    const ownerId = groupInfo.owner?.userId;
    if (!ownerId) {
      return interaction.editReply({
        content: '❌ Unable to determine the group owner.'
      });
    }

    // 7) Verify the invoking user has linked their Roblox account
    const linkedUsername = await xpDb.getRobloxId(userId);
    if (!linkedUsername) {
      return interaction.editReply({
        content: '❌ You must first link your Roblox account with `/verify`.'
      });
    }
    let linkedUserId;
    try {
      linkedUserId = await noblox.getIdFromUsername(linkedUsername);
    } catch {
      return interaction.editReply({
        content: '❌ Unable to verify your Roblox username. Please relink and try again.'
      });
    }
    if (linkedUserId !== ownerId) {
      return interaction.editReply({
        content: '❌ You are not the owner of this Roblox group.'
      });
    }

    // 8) Save the pending setup (so the button handler can pick it up)
    await setupManager.setPendingSetup(guildId, {
      groupId,
      premiumKey,
      ownerDiscordId: userId,
      requestingChannelId: channelId
    });

    // 9) (Optional) pre‑seed a blank config so `/update` doesn’t break
    await setupManager.setConfig(guildId, {
      groupId,
      roleBindings: [],
      verificationRoleId: null,
      unverifiedRoleId: null,
      bypassRoleId: null
    });

    // 10) Acknowledge to the user
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚙️ Setup Pending')
          .setDescription(
            `**Group ID:** ${groupId}\n` +
            (premiumKey ? `**Premium Key:** \`${premiumKey}\`` : '_No premium key provided_') +
            '\n\nYour request has been submitted. You’ll be notified when it’s confirmed.'
          )
          .setColor(0xFFA500)
          .setTimestamp()
      ]
    });

    // 11) Send notification in the shared pending‑requests channel
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_join_${guildId}`)
      .setLabel('✅ Confirm Bot Is In Group')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(confirmButton);

    const pendingEmbed = new EmbedBuilder()
      .setTitle('🚧 Bot Join Request')
      .addFields(
        { name: 'Server', value: `<#${channelId}>`, inline: true },
        { name: 'User', value: `<@${userId}>`, inline: true },
        { name: 'Roblox Group', value: `[${groupId}](https://www.roblox.com/groups/${groupId})`, inline: false },
        { name: '\u200B', value: '⚠️ Add the bot to the Roblox group, then click **Confirm Bot Is In Group**.' }
      )
      .setColor(0xFFA500)
      .setTimestamp();

    const pendingChannel = await interaction.client.channels.fetch(PENDING_CHANNEL_ID);
    if (pendingChannel?.isTextBased()) {
      await pendingChannel.send({ embeds: [pendingEmbed], components: [row] });
    } else {
      console.error(`PENDING_CHANNEL_ID ${PENDING_CHANNEL_ID} is not a text channel.`);
    }
  }
};
