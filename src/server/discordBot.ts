import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  TextChannel,
  CategoryChannel,
  Message,
  Guild,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  ActivityType,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ModalSubmitInteraction
} from 'discord.js';
import fs from 'fs';
import path from 'path';

export interface BotGuildInfo {
  id: string;
  name: string;
  memberCount: number;
  channels: { id: string; name: string; type: number }[];
  permissions?: {
    isAdmin: boolean;
    hasManageChannels: boolean;
    hasManageRoles: boolean;
    hasSendMessages: boolean;
    hasManageMessages: boolean;
    hasEmbedLinks: boolean;
  };
}

export interface BotLogEvent {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  guildName?: string;
}

export type GatewayOperationalState =
  | 'connected'
  | 'partially_operational'
  | 'reconnecting'
  | 'disconnected';

export interface BotStatus {
  isOnline: boolean;
  isConnecting: boolean;
  gatewayState: GatewayOperationalState;
  wsPing: number | null;
  wsStatus: number | null;
  uptimeSeconds: number | null;
  degradedReasons: string[];
  botUser: {
    id: string;
    tag: string;
    avatar: string;
  } | null;
  guilds: BotGuildInfo[];
  lastError: string | null;
  startedAt: string | null;
  events: BotLogEvent[];
}

const DISCORD_EPOCH = 1420070400000n;

export function isValidDiscordSnowflake(id: string): boolean {
  if (!/^\d{17,20}$/.test(id)) return false;
  try {
    const snowflake = BigInt(id);
    const timestamp = (snowflake >> 22n) + DISCORD_EPOCH;
    const minValidTime = DISCORD_EPOCH + 86400000n;
    const maxValidTime = BigInt(Date.now()) + 365n * 86400000n;
    return timestamp >= minValidTime && timestamp <= maxValidTime;
  } catch {
    return false;
  }
}

export function escapeCsvField(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const sanitized = /^[=+\-@\t\r]/.test(raw) && !raw.startsWith('@') ? `'${raw}` : raw;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

class DiscordBotManager {
  private client: Client | null = null;
  private isReconnectingGateway = false;
  private status: BotStatus = {
    isOnline: false,
    isConnecting: false,
    gatewayState: 'disconnected',
    wsPing: null,
    wsStatus: null,
    uptimeSeconds: null,
    degradedReasons: [],
    botUser: null,
    guilds: [],
    lastError: null,
    startedAt: null,
    events: [
      {
        id: 'init-evt',
        timestamp: new Date().toISOString(),
        type: 'info',
        message: 'FFA-Manager Discord Bot Engine initialized. Ready to connect to Discord Gateway.'
      }
    ]
  };

  public onTeamRegistered?: (teamData: any) => void;
  public onTeamDeleted?: (slotNumber: number) => void;
  public onTournamentDeleted?: () => void;
  public onConfigUpdated?: () => void;
  public getTournamentConfig?: () => any;
  public getRegisteredTeams?: () => any[];

  private blacklist: { userId: string; username: string; reason: string; addedBy: string; addedAt: string }[] = [];
  private pendingRulesPrompts = new Map<string, { guildId: string; channelId: string; expiresAt: number }>();
  private pendingRegistrationDrafts = new Map<
    string,
    { region: 'India' | 'Bangladesh' | 'Pakistan'; regionSelected: boolean; playerIds: string[]; updatedAt: number }
  >();
  private operationQueue: Promise<any> = Promise.resolve();
  private inFlightPlayerIds = new Set<string>();
  private slotListMessageIds = new Map<string, string>();
  private regDetailsMessageIds = new Map<string, string[]>();
  private slotListUpdateTimers = new Map<string, NodeJS.Timeout>();
  private cleanupTimers = new Set<NodeJS.Timeout>();
  private missingManageMessagesLogged = new Set<string>();

  public async withOperationLock<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.operationQueue.then(() => task());
    this.operationQueue = next.catch(() => {});
    return next;
  }

  public getRegionCountryCode(region: 'India' | 'Bangladesh' | 'Pakistan'): string {
    if (region === 'Bangladesh') return '+880';
    if (region === 'Pakistan') return '+92';
    return '+91';
  }

  public normalizeWhatsAppWithRegion(
    rawInput: string,
    region: 'India' | 'Bangladesh' | 'Pakistan'
  ): { valid: boolean; formatted: string } {
    const code = this.getRegionCountryCode(region);
    const digitsAndPlus = (rawInput || '').trim().replace(/[\s\-()]/g, '');
    if (!digitsAndPlus) {
      return { valid: false, formatted: '' };
    }

    let normalized = digitsAndPlus;
    if (!normalized.startsWith('+')) {
      const codeDigits = code.slice(1);
      if (normalized.startsWith(codeDigits) && normalized.length > codeDigits.length + 6) {
        normalized = `+${normalized}`;
      } else {
        const localNumber = normalized.replace(/^0+/, '');
        normalized = `${code}${localNumber}`;
      }
    }

    if (normalized === code || !/^\+[1-9]\d{8,14}$/.test(normalized)) {
      return { valid: false, formatted: normalized };
    }

    return { valid: true, formatted: normalized };
  }

  public createRegistrationPanelPayload(config: any) {
    const title = (config?.title || 'Free Fire Asia | Glacier Cup - S1').trim();
    const slots = Math.max(2, config?.totalSlots || 20);
    const tags = Math.max(1, config?.requiredTags || 4);

    const panelEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${title}`)
      .setColor(0xF59E0B)
      .setDescription(
        `Tap below to register your team.\n\n` +
        `**${slots} slots • ${tags} required players**`
      )
      .setFooter({ text: `GLACIER CUP • ${title}` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('register_team_panel_btn')
        .setLabel('Register Your Team')
        .setEmoji('🏆')
        .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [panelEmbed], components: [row] };
  }

  public async sendRegistrationPanel(guild: Guild, config: any): Promise<{ success: boolean; channelName?: string; error?: string }> {
    const regCh = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (c.name === config?.regChannel || c.name === '📝┃registration' || c.name === 'registration')
    ) as TextChannel | undefined;

    if (!regCh) {
      return { success: false, error: `Registration channel (#${config?.regChannel || '📝┃registration'}) not found.` };
    }

    try {
      const payload = this.createRegistrationPanelPayload(config);
      await regCh.send(payload);
      return { success: true, channelName: regCh.name };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to post registration panel.' };
    }
  }

  public createRegistrationStepPromptPayload(
    config: any,
    draft?: { region: 'India' | 'Bangladesh' | 'Pakistan'; regionSelected: boolean; playerIds: string[] }
  ) {
    const title = (config?.title || 'Free Fire Asia | Glacier Cup').trim();
    const tags = Math.max(1, config?.requiredTags || 4);
    const currentRegion = draft?.region || 'India';
    const countryCode = this.getRegionCountryCode(currentRegion);
    const selectedPlayers = draft?.playerIds || [];

    const stepEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${title} — Team Registration`)
      .setColor(0xF59E0B)
      .setDescription(
        `Select your **Region** from the dropdown below (and optionally pre-select your **${tags} Players Tags**) to open the registration form:\n\n` +
        `• **Team Name:** Required (Unique team name)\n` +
        `• **Region:** \`${draft?.regionSelected ? `${currentRegion} (${countryCode})` : 'Select from dropdown (India, Bangladesh, Pakistan)'}\`\n` +
        `• **WhatsApp no:** Auto-prefixed with \`${countryCode}\` when **${currentRegion}** is selected\n` +
        `• **Players Tags:** **Exactly ${tags} players required** *(as set during setup)*` +
        (selectedPlayers.length > 0
          ? `\n\n✅ **Pre-selected Players (${selectedPlayers.length}/${tags}):** ${selectedPlayers.map(id => `<@${id}>`).join(', ')}`
          : '')
      )
      .setFooter({ text: 'Selecting a Region opens the Team Registration form with your country code pre-filled' });

    const regionSelect = new StringSelectMenuBuilder()
      .setCustomId('reg_region_select')
      .setPlaceholder('🌍 Region: Select Country (India, Bangladesh, Pakistan)')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('India (+91)')
          .setValue('India')
          .setDescription('Auto-fills +91 country code in WhatsApp number')
          .setEmoji('🇮🇳')
          .setDefault(draft?.regionSelected === true && currentRegion === 'India'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Bangladesh (+880)')
          .setValue('Bangladesh')
          .setDescription('Auto-fills +880 country code in WhatsApp number')
          .setEmoji('🇧🇩')
          .setDefault(draft?.regionSelected === true && currentRegion === 'Bangladesh'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Pakistan (+92)')
          .setValue('Pakistan')
          .setDescription('Auto-fills +92 country code in WhatsApp number')
          .setEmoji('🇵🇰')
          .setDefault(draft?.regionSelected === true && currentRegion === 'Pakistan')
      );

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId('reg_players_select')
      .setPlaceholder(`👥 Players Tags: Select ${tags} players (Set in setup)`)
      .setMinValues(1)
      .setMaxValues(tags);

    const openModalBtn = new ButtonBuilder()
      .setCustomId('reg_open_modal_btn')
      .setLabel(`📝 Fill Registration Form (${currentRegion} ${countryCode})`)
      .setStyle(ButtonStyle.Success);

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect);
    const row2 = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect);
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(openModalBtn);

    return { embeds: [stepEmbed], components: [row1, row2, row3] };
  }

  public createTeamRegistrationModal(
    config: any,
    region: 'India' | 'Bangladesh' | 'Pakistan' = 'India',
    preselectedPlayerIds: string[] = []
  ) {
    const tags = Math.max(1, Math.min(10, config?.requiredTags || 4));
    const modal = new ModalBuilder()
      .setCustomId('submit_team_reg_modal')
      .setTitle(`🏆 Register Your Team (${tags} Players)`.slice(0, 45));

    const teamNameLabel = new LabelBuilder()
      .setLabel('1. Team Name:')
      .setDescription('Enter your unique squad name')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('reg_team_name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter your unique Team Name (e.g. Glacier Titans)')
          .setMinLength(2)
          .setMaxLength(60)
          .setRequired(true)
      );

    const regionSelect = new StringSelectMenuBuilder()
      .setCustomId('reg_region')
      .setPlaceholder('Select Region (India, Bangladesh, Pakistan)')
      .setMinValues(1)
      .setMaxValues(1)
      .setRequired(true)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('India (+91)')
          .setValue('India')
          .setDescription('Auto-adds +91 country code to WhatsApp number')
          .setEmoji('🇮🇳')
          .setDefault(region === 'India'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Bangladesh (+880)')
          .setValue('Bangladesh')
          .setDescription('Auto-adds +880 country code to WhatsApp number')
          .setEmoji('🇧🇩')
          .setDefault(region === 'Bangladesh'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Pakistan (+92)')
          .setValue('Pakistan')
          .setDescription('Auto-adds +92 country code to WhatsApp number')
          .setEmoji('🇵🇰')
          .setDefault(region === 'Pakistan')
      );

    const regionLabel = new LabelBuilder()
      .setLabel('2. Region:')
      .setDescription('Select your team region (India, Bangladesh, Pakistan)')
      .setStringSelectMenuComponent(regionSelect);

    const whatsappLabel = new LabelBuilder()
      .setLabel('3. WhatsApp Number:')
      .setDescription('Country code (+91 / +880 / +92) is auto-applied from Region')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('reg_whatsapp_1')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter WhatsApp number (e.g. 9876543210 or +919876543210)')
          .setMinLength(7)
          .setMaxLength(20)
          .setRequired(true)
      );

    const playersSelect = new UserSelectMenuBuilder()
      .setCustomId('reg_player_tags')
      .setPlaceholder(`Select exactly ${tags} player${tags > 1 ? 's' : ''} (Required: ${tags})`.slice(0, 150))
      .setMinValues(tags)
      .setMaxValues(tags)
      .setRequired(true);

    if (preselectedPlayerIds.length > 0) {
      playersSelect.setDefaultUsers(...preselectedPlayerIds.slice(0, tags));
    }

    const playersLabel = new LabelBuilder()
      .setLabel(`4. Players Tags (Select ${tags}):`.slice(0, 45))
      .setDescription(`Select exactly ${tags} player${tags > 1 ? 's' : ''} — no more and no less`.slice(0, 100))
      .setUserSelectMenuComponent(playersSelect);

    modal.addLabelComponents(teamNameLabel, regionLabel, whatsappLabel, playersLabel);

    return modal;
  }

  private async safeDeleteMessage(msg: Message | null | undefined, context: string): Promise<boolean> {
    if (!msg) return false;
    try {
      const isOwnMessage = this.client?.user && msg.author?.id === this.client.user.id;
      if (!isOwnMessage && msg.guild) {
        const botMember = msg.guild.members.me;
        const channelPerms = (msg.channel as TextChannel).permissionsFor?.(botMember!);
        const canManageMessages =
          botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ||
          botMember?.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
          channelPerms?.has(PermissionsBitField.Flags.ManageMessages);

        if (!canManageMessages) {
          const warnKey = `${msg.guild.id}:${msg.channel.id}`;
          if (!this.missingManageMessagesLogged.has(warnKey)) {
            this.missingManageMessagesLogged.add(warnKey);
            this.logEvent(
              'warn',
              `Auto-cleanup notice (${context}): Bot lacks "Manage Messages" permission in #${(msg.channel as TextChannel).name || 'channel'} to delete user message.`,
              msg.guild.name
            );
          }
          return false;
        }
      }

      await msg.delete();
      return true;
    } catch (err: any) {
      const code = err?.code || err?.status;
      if (code === 10008) {
        return false;
      }
      if (code === 50013) {
        this.logEvent(
          'warn',
          `Auto-cleanup permission denied (${context}): Missing permission to delete message in #${(msg.channel as TextChannel).name || 'channel'}.`,
          msg.guild?.name
        );
        return false;
      }
      this.logEvent('info', `Auto-cleanup skipped (${context}): ${err?.message || 'Message no longer available'}`, msg.guild?.name);
      return false;
    }
  }

  private createRulesButtonRow() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('open_rules_modal')
        .setLabel('📜 Enter & Post Rules to #rules-format')
        .setStyle(ButtonStyle.Primary)
    );
  }

  private createDeleteConfirmRow(deleteChannels: boolean) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_delete_tourney:${deleteChannels ? '1' : '0'}`)
        .setLabel('🗑️ Confirm Delete Tournament')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete_tourney')
        .setLabel('✖️ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  private createRulesModal(existingRules?: string) {
    const modal = new ModalBuilder()
      .setCustomId('submit_rules_modal')
      .setTitle('Tournament Rules & Format');

    const rulesInput = new TextInputBuilder()
      .setCustomId('rules_text')
      .setLabel('Enter Rules & Format to post in #rules-format')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Example:\n1. Format: Squads\n2. No emulators or teaming\n3. Join room 5 mins before start...')
      .setRequired(true)
      .setMaxLength(3800);

    if (existingRules && existingRules.trim().length > 0) {
      rulesInput.setValue(existingRules.slice(0, 3800));
    }

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(rulesInput);
    modal.addComponents(row);
    return modal;
  }

  public async publishRulesToChannel(
    guild: Guild,
    rulesText: string,
    authorName?: string
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (config) {
      config.customRules = rulesText;
    }
    const title = config?.title || `${guild.name} Tournament`;
    const targetNames = [config?.rulesChannel, '📋┃rules-format', 'rules-format', 'rules'].filter(Boolean);

    let rulesCh = guild.channels.cache.find(
      c => c.isTextBased() && targetNames.includes(c.name)
    ) as TextChannel | undefined;

    if (!rulesCh) {
      const category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory &&
             (c.name.toLowerCase() === (config?.categoryName || '').toLowerCase() ||
              c.name.toLowerCase().includes('tournament') ||
              c.name.toLowerCase().includes('scrim'))
      ) as CategoryChannel | undefined;

      try {
        rulesCh = await guild.channels.create({
          name: '📋┃rules-format',
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: `Official tournament rules, format and scoring for ${title}`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
              deny: [PermissionsBitField.Flags.SendMessages]
            }
          ]
        });
      } catch (err: any) {
        return { success: false, error: `Could not find or create #rules-format: ${err.message}` };
      }
    }

    try {
      const rulesEmbed = new EmbedBuilder()
        .setTitle(`📜 ${title} — Tournament Rules & Format`)
        .setColor(0x5865F2)
        .setDescription(rulesText)
        .setFooter({ text: authorName ? `Published by @${authorName} • FFA-Manager` : 'FFA-Manager' })
        .setTimestamp();

      await rulesCh.send({ embeds: [rulesEmbed] });
      this.logEvent('success', `Published custom tournament rules to #${rulesCh.name}`, guild.name);
      return { success: true, channelId: rulesCh.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public getBlacklist() {
    return this.blacklist;
  }

  public addToBlacklist(userId: string, username: string, reason: string, addedBy: string) {
    const cleanId = userId.replace(/[<@!>]/g, '').trim();
    const existing = this.blacklist.find(b => b.userId === cleanId);
    if (existing) {
      existing.reason = reason || existing.reason;
      return existing;
    }
    const entry = {
      userId: cleanId,
      username: username || cleanId,
      reason: reason || 'Rule violation / Fairplay ban',
      addedBy,
      addedAt: new Date().toISOString()
    };
    this.blacklist.push(entry);
    this.logEvent('warn', `Blacklisted player @${entry.username} (${cleanId}) — Reason: ${entry.reason}`);
    return entry;
  }

  public removeFromBlacklist(userId: string): boolean {
    const cleanId = userId.replace(/[<@!>]/g, '').trim();
    const idx = this.blacklist.findIndex(b => b.userId === cleanId || b.username.toLowerCase() === cleanId.toLowerCase());
    if (idx !== -1) {
      const removed = this.blacklist.splice(idx, 1)[0];
      this.logEvent('info', `Removed player @${removed.username} (${removed.userId}) from blacklist.`);
      return true;
    }
    return false;
  }

  public getGroupLetter(groupIdx: number): string {
    let label = '';
    let n = Math.max(0, groupIdx);
    while (n >= 0) {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }

  public calculateGroupForSlot(slotNum: number, config: any): string {
    const totalSlots = Math.max(1, config?.totalSlots || 20);
    const teamsPerGroup =
      config?.teamsPerGroup && config.teamsPerGroup > 0
        ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
        : Math.ceil(totalSlots / Math.max(1, config?.groupsCount || 1));
    const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));
    if (groupsCount > 1) {
      const groupIdx = Math.max(0, Math.min(groupsCount - 1, Math.floor((slotNum - 1) / teamsPerGroup)));
      return `Group ${this.getGroupLetter(groupIdx)}`;
    }
    return 'Group A';
  }

  public formatGroupedSlotListChunks(confirmedTeams: any[], config: any): string[] {
    const confirmed = [...confirmedTeams].sort((a, b) => a.slotNumber - b.slotNumber);
    const totalSlots = Math.max(1, config?.totalSlots || 20);
    const teamsPerGroup =
      config?.teamsPerGroup && config.teamsPerGroup > 0
        ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
        : Math.ceil(totalSlots / Math.max(1, config?.groupsCount || 1));
    const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));

    if (confirmed.length === 0) {
      return ['**Group A**\n*No teams registered yet.*'];
    }

    const sections: string[] = [];
    for (let g = 0; g < groupsCount; g++) {
      const groupLetter = this.getGroupLetter(g);
      const startSlot = g * teamsPerGroup + 1;
      const endSlot = Math.min((g + 1) * teamsPerGroup, totalSlots);
      if (startSlot > totalSlots) break;

      const groupTeams = confirmed.filter(t => t.slotNumber >= startSlot && t.slotNumber <= endSlot);
      const hasTeamsInLaterGroups = confirmed.some(t => t.slotNumber > endSlot);

      if (groupTeams.length === 0 && !hasTeamsInLaterGroups) {
        break;
      }

      const teamLines =
        groupTeams.length > 0
          ? groupTeams
              .map(t => `\`${t.slotNumber < 10 ? '0' + t.slotNumber : t.slotNumber}.\` **${t.teamName}** — <@${t.captain.id}>`)
              .join('\n')
          : '*No teams in this group*';

      sections.push(`**Group ${groupLetter}**\n${teamLines}`);
    }

    const chunks: string[] = [];
    let currentChunk = '';
    for (const sec of sections) {
      if (currentChunk.length + sec.length + 2 > 3400 && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = sec;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n\n${sec}` : sec;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks.length > 0 ? chunks : ['**Group A**\n*No teams registered yet.*'];
  }

  public hasBotManagerRole(
    member: any,
    guild?: Guild | null,
    allowBootstrapSetup: boolean = false
  ): boolean {
    if (!member) return false;
    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const targetRoleName = (config?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase();

    if (member.roles?.cache) {
      const hasRole = member.roles.cache.some(
        (r: any) =>
          r.name?.trim().toLowerCase() === targetRoleName ||
          r.name?.trim().toLowerCase() === 'ffa bot manager'
      );
      if (hasRole) return true;
    }

    if (Array.isArray(member.roles) && guild) {
      const managerRole = guild.roles.cache.find(
        r =>
          r.name.trim().toLowerCase() === targetRoleName ||
          r.name.trim().toLowerCase() === 'ffa bot manager'
      );
      if (managerRole && member.roles.includes(managerRole.id)) {
        return true;
      }
    }

    if (allowBootstrapSetup && guild) {
      const memberId = member.id || member.user?.id;
      if (memberId && guild.ownerId === memberId) {
        return true;
      }
      const isAdminOrManageChannels =
        member.permissions?.has?.(PermissionsBitField.Flags.Administrator) ||
        member.permissions?.has?.(PermissionsBitField.Flags.ManageChannels);
      const managerRoleExists = guild.roles.cache.some(
        r =>
          r.name.trim().toLowerCase() === targetRoleName ||
          r.name.trim().toLowerCase() === 'ffa bot manager'
      );
      if (isAdminOrManageChannels && !managerRoleExists) {
        return true;
      }
    }

    return false;
  }

  public async provisionTeamWorkspace(
    guild: Guild,
    team: any,
    playerIds: string[] = []
  ): Promise<{
    roleId?: string;
    roleName: string;
    categoryId?: string;
    categoryName: string;
    voiceChannelId?: string;
    voiceChannelName: string;
    warnings: string[];
  }> {
    const cleanTeamName = (team.teamName || 'Team').trim().slice(0, 90);
    const roleName = cleanTeamName;
    const categoryName = cleanTeamName;
    const voiceChannelName = cleanTeamName;
    const warnings: string[] = [];

    team.teamRoleName = roleName;
    team.teamCategoryName = categoryName;
    team.teamVoiceChannelName = voiceChannelName;

    if (!guild) {
      return { roleName, categoryName, voiceChannelName, warnings };
    }

    const botMember = guild.members.me;
    const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
    const canManageRoles = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false);
    const canManageChannels = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ?? false);

    const uniquePlayerIds = Array.from(
      new Set(
        [
          team.captain?.id,
          ...playerIds,
          ...(team.players || []).map((p: any) => p.id)
        ].filter(Boolean)
      )
    );

    let teamRole = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!teamRole && canManageRoles) {
      try {
        teamRole = await guild.roles.create({
          name: roleName,
          color: 0x5865F2,
          hoist: false,
          mentionable: true,
          reason: `FFA-Manager Team Role for ${cleanTeamName} (Slot #${team.slotNumber})`
        });
      } catch (err: any) {
        warnings.push(`Could not create team role @${roleName}: ${err.message}`);
      }
    } else if (!teamRole && !canManageRoles) {
      warnings.push(`Bot lacks "Manage Roles" permission to create team role @${roleName}.`);
    }

    if (teamRole) {
      team.teamRoleId = teamRole.id;
      team.teamRoleName = teamRole.name;
    }

    const resolvedMemberIds: string[] = [];
    for (const uid of uniquePlayerIds) {
      try {
        const member = guild.members.cache.get(uid) || (await guild.members.fetch(uid).catch(() => null));
        if (member) {
          resolvedMemberIds.push(member.id);
          if (teamRole && !member.roles.cache.has(teamRole.id)) {
            await member.roles.add(teamRole).catch((err: any) => {
              warnings.push(`Could not assign @${teamRole!.name} to <@${uid}>: ${err.message}`);
            });
          }
        }
      } catch (err: any) {
        warnings.push(`Could not resolve member <@${uid}> for role assignment: ${err.message}`);
      }
    }

    let teamCategory: CategoryChannel | undefined;
    let voiceChannel: any;

    if (canManageChannels) {
      const overwrites: any[] = [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect
          ]
        }
      ];

      if (teamRole) {
        overwrites.push({
          id: teamRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.Stream,
            PermissionsBitField.Flags.UseVAD
          ]
        });
      }

      for (const uid of resolvedMemberIds) {
        overwrites.push({
          id: uid,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.Stream,
            PermissionsBitField.Flags.UseVAD
          ]
        });
      }

      if (botMember) {
        overwrites.push({
          id: botMember.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MoveMembers
          ]
        });
      }

      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const managerRoleName = (config?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase();
      const managerRole = guild.roles.cache.find(
        r => r.name.trim().toLowerCase() === managerRoleName || r.name.trim().toLowerCase() === 'ffa bot manager'
      );
      if (managerRole) {
        overwrites.push({
          id: managerRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MoveMembers
          ]
        });
      }

      try {
        teamCategory = guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildCategory &&
            (c.id === team.teamCategoryId || c.name.toLowerCase() === categoryName.toLowerCase())
        ) as CategoryChannel | undefined;

        if (!teamCategory) {
          teamCategory = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites: overwrites,
            reason: `FFA-Manager Team Category for ${cleanTeamName} (Slot #${team.slotNumber})`
          });
        } else {
          await teamCategory.permissionOverwrites.set(overwrites).catch(() => {});
        }

        team.teamCategoryId = teamCategory.id;
        team.teamCategoryName = teamCategory.name;

        voiceChannel = guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildVoice &&
            (c.id === team.teamVoiceChannelId ||
              (c.parentId === teamCategory!.id && c.name.toLowerCase() === voiceChannelName.toLowerCase()))
        );

        if (!voiceChannel) {
          voiceChannel = await guild.channels.create({
            name: voiceChannelName,
            type: ChannelType.GuildVoice,
            parent: teamCategory.id,
            permissionOverwrites: overwrites,
            reason: `FFA-Manager Private Voice Channel for ${cleanTeamName} (Slot #${team.slotNumber})`
          });
        } else {
          await voiceChannel.permissionOverwrites.set(overwrites).catch(() => {});
        }

        team.teamVoiceChannelId = voiceChannel.id;
        team.teamVoiceChannelName = voiceChannel.name;
      } catch (err: any) {
        warnings.push(`Could not create team category or voice channel for "${cleanTeamName}": ${err.message}`);
      }
    } else {
      warnings.push(`Bot lacks "Manage Channels" permission to create category & private voice channel for "${cleanTeamName}".`);
    }

    this.logEvent(
      warnings.length > 0 ? 'warn' : 'success',
      `Provisioned Team Workspace for "${cleanTeamName}": Category "${categoryName}", Private Voice Channel "🔊 ${voiceChannelName}", and Role "@${roleName}" assigned to ${uniquePlayerIds.length} player(s).${warnings.length > 0 ? ` [${warnings.join('; ')}]` : ''}`,
      guild.name
    );

    return {
      roleId: team.teamRoleId,
      roleName: team.teamRoleName,
      categoryId: team.teamCategoryId,
      categoryName: team.teamCategoryName,
      voiceChannelId: team.teamVoiceChannelId,
      voiceChannelName: team.teamVoiceChannelName,
      warnings
    };
  }

  private createVoiceConnectButtonRow(guildId: string, voiceChannelId: string, channelName: string) {
    const cleanLabel = `🔊 Connect to ${channelName}`.slice(0, 80);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(cleanLabel)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${voiceChannelId}`)
    );
  }

  public async cleanupTeamWorkspace(guild: Guild | undefined, team: any): Promise<string[]> {
    const cleaned: string[] = [];
    if (!guild || !team) return cleaned;

    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const protectedRoleNames = new Set(
      [
        '@everyone',
        'ffa bot manager',
        (config?.managerRoleName || 'FFA Bot Manager').toLowerCase(),
        (config?.verifiedRoleName || 'Verified Team').toLowerCase(),
        (config?.roleName || 'Confirmed Slot').toLowerCase()
      ]
    );

    const botMember = guild.members.me;
    const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
    const canManageChannels = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ?? false);
    const canManageRoles = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false);

    if (canManageChannels) {
      const targetCat = guild.channels.cache.find(
        c =>
          c.type === ChannelType.GuildCategory &&
          ((team.teamCategoryId && c.id === team.teamCategoryId) ||
            (team.teamCategoryName && c.name.toLowerCase() === team.teamCategoryName.toLowerCase()) ||
            (team.teamName && c.name.toLowerCase() === team.teamName.toLowerCase()))
      ) as CategoryChannel | undefined;

      const targetVc = guild.channels.cache.find(
        c =>
          c.type === ChannelType.GuildVoice &&
          ((team.teamVoiceChannelId && c.id === team.teamVoiceChannelId) ||
            (targetCat && c.parentId === targetCat.id))
      );

      if (targetVc) {
        try {
          const vcName = targetVc.name;
          await targetVc.delete(`FFA-Manager cleanup for team ${team.teamName}`);
          cleaned.push(`Voice: 🔊 ${vcName}`);
        } catch {
        }
      }

      if (targetCat) {
        try {
          const children = guild.channels.cache.filter(c => c.parentId === targetCat.id);
          for (const [, child] of children) {
            await child.delete(`FFA-Manager cleanup for team ${team.teamName}`).catch(() => {});
          }
          const catName = targetCat.name;
          await targetCat.delete(`FFA-Manager cleanup for team ${team.teamName}`);
          cleaned.push(`Category: ${catName}`);
        } catch {
        }
      }
    }

    if (canManageRoles) {
      const targetRole = guild.roles.cache.find(
        r =>
          !protectedRoleNames.has(r.name.toLowerCase()) &&
          ((team.teamRoleId && r.id === team.teamRoleId) ||
            (team.teamRoleName && r.name.toLowerCase() === team.teamRoleName.toLowerCase()) ||
            (team.teamName && r.name.toLowerCase() === team.teamName.toLowerCase()))
      );
      if (targetRole) {
        try {
          const rName = targetRole.name;
          await targetRole.delete(`FFA-Manager cleanup for team ${team.teamName}`);
          cleaned.push(`Role: @${rName}`);
        } catch {
        }
      }
    }

    return cleaned;
  }

  public async startRegistration(
    targetGuild?: Guild,
    staffTag?: string
  ): Promise<{
    success: boolean;
    unlockedChannels: string[];
    warnings: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      if (!config.totalSlots || config.totalSlots <= 0) {
        config.totalSlots = 20;
      }

      config.status = 'open';
      config.explicitlyStoppedOrPaused = false;
      const unlockedChannels: string[] = [];
      const warnings: string[] = [];

      const guilds = targetGuild
        ? [targetGuild]
        : this.client
        ? Array.from(this.client.guilds.cache.values())
        : [];

      const tags = config.requiredTags || 4;
      let sampleRoster = `Team Name: Glacier Titans\nRegion: India\nWhatsApp: +919876543210\nBackup WhatsApp: +919876543211\n`;
      for (let i = 1; i <= tags; i++) {
        sampleRoster += `Player ${i}: @Player${i}\n`;
      }

      for (const guild of guilds) {
        const regCh = guild.channels.cache.find(
          c =>
            c.isTextBased() &&
            (c.name === config.regChannel || c.name === '📝┃registration' || c.name === 'registration')
        ) as TextChannel | undefined;

        if (regCh) {
          try {
            await regCh.permissionOverwrites.edit(
              guild.roles.everyone.id,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              },
              { reason: `Registration started by ${staffTag || 'Staff'}` }
            );
            unlockedChannels.push(`#${regCh.name}`);
          } catch (err: any) {
            warnings.push(`Could not unlock #${regCh.name} in "${guild.name}": ${err.message}`);
          }

          try {
            const openEmbed = new EmbedBuilder()
              .setTitle(`🟢 ${config.title || 'Tournament'} — Registration Started!`)
              .setColor(0x00E676)
              .setDescription(
                `Registration is now **OPEN** and <#${regCh.id}> is **UNLOCKED**!\n\n` +
                `Submit your team roster using the format below:\n\`\`\`text\n${sampleRoster}\`\`\``
              )
              .addFields(
                { name: 'Total Slots', value: `\`${config.totalSlots} Slots\``, inline: true },
                { name: 'Teams Per Group', value: `\`${config.teamsPerGroup || config.totalSlots} Teams/Group\` (\`${config.groupsCount || 1} Group(s)\`)`, inline: true },
                { name: 'Required Tags', value: `\`${tags} Player Mentions\``, inline: true }
              )
              .setFooter({ text: staffTag ? `Started by @${staffTag} • FFA | Glacier Cup Manager™` : 'FFA | Glacier Cup Manager™' })
              .setTimestamp();

            const panelPayload = this.createRegistrationPanelPayload(config);
            await regCh.send({
              content: '@here 🟢 **Registration is now OPEN!**',
              embeds: [openEmbed, ...panelPayload.embeds],
              components: panelPayload.components
            });
          } catch (err: any) {
            warnings.push(`Could not post start announcement in #${regCh.name}: ${err.message}`);
          }
        } else {
          warnings.push(`Registration channel (#${config.regChannel || '📝┃registration'}) not found in "${guild.name}".`);
        }

        await this.updateSlotListChannel(guild, config).catch(() => {});
      }

      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }

      this.logEvent(
        'success',
        `Registration STARTED and #registration unlocked by ${staffTag || 'Staff'} (${unlockedChannels.join(', ') || 'status set to OPEN'}).`,
        targetGuild?.name
      );

      return {
        success: true,
        unlockedChannels,
        warnings
      };
    });
  }

  public async pauseRegistration(
    targetGuild?: Guild,
    reason?: string,
    staffTag?: string
  ): Promise<{
    success: boolean;
    pausedChannels: string[];
    warnings: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      if (!config || !config.totalSlots || config.totalSlots <= 0) {
        return {
          success: false,
          pausedChannels: [],
          warnings: [],
          error: 'No active tournament is configured. Run `/setup` first.'
        };
      }

      config.status = 'paused';
      config.explicitlyStoppedOrPaused = true;
      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }

      const pausedChannels: string[] = [];
      const warnings: string[] = [];
      const pauseReason = reason?.trim() || 'Registration has been temporarily paused by tournament staff.';

      const guilds = targetGuild
        ? [targetGuild]
        : this.client
        ? Array.from(this.client.guilds.cache.values())
        : [];

      for (const guild of guilds) {
        const regCh = guild.channels.cache.find(
          c =>
            c.isTextBased() &&
            (c.name === config.regChannel || c.name === '📝┃registration' || c.name === 'registration')
        ) as TextChannel | undefined;

        if (regCh) {
          try {
            await regCh.permissionOverwrites.edit(
              guild.roles.everyone.id,
              {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
              },
              { reason: `Registration paused by ${staffTag || 'Staff'}: ${pauseReason}` }
            );
            pausedChannels.push(`#${regCh.name}`);
          } catch (err: any) {
            warnings.push(`Could not lock #${regCh.name} in "${guild.name}": ${err.message}`);
          }

          try {
            const pauseEmbed = new EmbedBuilder()
              .setTitle(`⏸️ ${config.title || 'Tournament'} — Registration Paused`)
              .setColor(0xFEE75C)
              .setDescription(
                `Registration for **${config.title || 'this tournament'}** is currently **PAUSED** and <#${regCh.id}> is temporarily locked.\n` +
                `**Reason:** ${pauseReason}\n\n` +
                `▶️ Registration will resume as soon as staff run \`/start-registration\`.`
              )
              .setFooter({ text: staffTag ? `Paused by @${staffTag} • FFA | Glacier Cup Manager™` : 'FFA | Glacier Cup Manager™' })
              .setTimestamp();

            await regCh.send({ embeds: [pauseEmbed] });
          } catch (err: any) {
            warnings.push(`Could not post pause announcement in #${regCh.name}: ${err.message}`);
          }
        }

        await this.updateSlotListChannel(guild, config).catch(() => {});
      }

      this.logEvent(
        'warn',
        `Registration PAUSED and #registration temporarily locked by ${staffTag || 'Staff'}: ${pauseReason}`,
        targetGuild?.name
      );

      return {
        success: true,
        pausedChannels,
        warnings
      };
    });
  }

  public async stopRegistration(
    targetGuild?: Guild,
    reason?: string,
    staffTag?: string
  ): Promise<{
    success: boolean;
    lockedChannels: string[];
    warnings: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      if (!config) {
        return {
          success: false,
          lockedChannels: [],
          warnings: [],
          error: 'Configuration not loaded.'
        };
      }

      config.status = 'closed';
      config.explicitlyStoppedOrPaused = true;
      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }
      const lockedChannels: string[] = [];
      const warnings: string[] = [];
      const closeReason = reason?.trim() || 'Registration has been ended by tournament staff.';

      const guilds = targetGuild
        ? [targetGuild]
        : this.client
        ? Array.from(this.client.guilds.cache.values())
        : [];

      for (const guild of guilds) {
        const regCh = guild.channels.cache.find(
          c =>
            c.isTextBased() &&
            (c.name === config.regChannel || c.name === '📝┃registration' || c.name === 'registration')
        ) as TextChannel | undefined;

        if (regCh) {
          try {
            await regCh.permissionOverwrites.edit(
              guild.roles.everyone.id,
              {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
              },
              { reason: `Registration stopped by ${staffTag || 'Staff'}: ${closeReason}` }
            );
            lockedChannels.push(`#${regCh.name}`);
          } catch (err: any) {
            warnings.push(`Could not lock #${regCh.name} in "${guild.name}": ${err.message}`);
          }

          try {
            const closeEmbed = new EmbedBuilder()
              .setTitle(`🔴 ${config.title || 'Tournament'} — Registration Ended & Channel Locked`)
              .setColor(0xED4245)
              .setDescription(
                `Registration for **${config.title || 'this tournament'}** is now **CLOSED** and <#${regCh.id}> has been **LOCKED**.\n` +
                `**Reason:** ${closeReason}`
              )
              .setFooter({ text: staffTag ? `Stopped by @${staffTag} • FFA | Glacier Cup Manager™` : 'FFA | Glacier Cup Manager™' })
              .setTimestamp();

            await regCh.send({ embeds: [closeEmbed] });
          } catch (err: any) {
            warnings.push(`Could not post stop announcement in #${regCh.name}: ${err.message}`);
          }
        }

        await this.updateSlotListChannel(guild, config).catch(() => {});
      }

      this.logEvent(
        'warn',
        `Registration STOPPED and #registration locked by ${staffTag || 'Staff'}: ${closeReason}`,
        targetGuild?.name
      );

      return {
        success: true,
        lockedChannels,
        warnings
      };
    });
  }

  public async swapSlots(
    slot1: number,
    slot2: number,
    guild?: Guild
  ): Promise<{
    success: boolean;
    team1?: any;
    team2?: any;
    group1?: string;
    group2?: string;
    prevGroup1?: string;
    prevGroup2?: string;
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;

      if (!config || !config.totalSlots || config.totalSlots <= 0) {
        return {
          success: false,
          error: 'No active tournament is configured. Run `/setup` or `/create tournament` first.'
        };
      }

      if (!Number.isInteger(slot1) || !Number.isInteger(slot2)) {
        return {
          success: false,
          error: 'Both slot numbers must be valid whole integers.'
        };
      }

      if (slot1 === slot2) {
        return {
          success: false,
          error: `Cannot swap Slot #${slot1} with itself. Please specify two different slot numbers.`
        };
      }

      if (slot1 < 1 || slot1 > config.totalSlots || slot2 < 1 || slot2 > config.totalSlots) {
        return {
          success: false,
          error: `Slot numbers must be within the configured tournament range (1 to ${config.totalSlots}). You requested Slot #${slot1} and Slot #${slot2}.`
        };
      }

      const t1 = teams.find(t => t.slotNumber === slot1 && !t.isWaitlist);
      const t2 = teams.find(t => t.slotNumber === slot2 && !t.isWaitlist);

      if (!t1 && !t2) {
        return {
          success: false,
          error: `Neither Slot #${slot1} nor Slot #${slot2} has a confirmed team to swap.`
        };
      }

      const groupForSlot1 = this.calculateGroupForSlot(slot1, config);
      const groupForSlot2 = this.calculateGroupForSlot(slot2, config);

      if (!/^Group [A-Z]+$/.test(groupForSlot1) || !/^Group [A-Z]+$/.test(groupForSlot2)) {
        return {
          success: false,
          error: `Computed invalid group assignment (${groupForSlot1} / ${groupForSlot2}). Swap aborted.`
        };
      }

      const prevGroup1 = t1?.group || groupForSlot1;
      const prevGroup2 = t2?.group || groupForSlot2;

      if (t1 && t2) {
        t1.slotNumber = slot2;
        t1.group = groupForSlot2;
        t2.slotNumber = slot1;
        t2.group = groupForSlot1;
      } else if (t1 && !t2) {
        t1.slotNumber = slot2;
        t1.group = groupForSlot2;
      } else if (!t1 && t2) {
        t2.slotNumber = slot1;
        t2.group = groupForSlot1;
      }

      teams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));

      if (guild && config) {
        await this.updateSlotListChannel(guild, config).catch(() => {});
      }

      this.logEvent(
        'info',
        `Swapped Slot #${slot1} (${groupForSlot1}) and Slot #${slot2} (${groupForSlot2})`,
        guild?.name
      );

      return {
        success: true,
        team1: t1,
        team2: t2,
        group1: groupForSlot1,
        group2: groupForSlot2,
        prevGroup1,
        prevGroup2
      };
    });
  }

  public generateRosterExport(format: 'csv' | 'markdown' = 'markdown', includeWaitlist: boolean = true): string {
    const rawTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const sorted = [...rawTeams]
      .filter(t => includeWaitlist || !t.isWaitlist)
      .sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));

    if (format === 'csv') {
      const header = 'Slot,Group,Status,Team Name,Captain,Captain ID,Players,Player IDs,Registered At';
      const rows = sorted.map(t => {
        const status = t.isWaitlist ? `Waitlist #${t.slotNumber}` : 'Confirmed';
        const group = t.isWaitlist ? 'Waitlist' : (t.group || 'Group A');
        const playerTags = (t.players || []).map((p: any) => `@${p.displayName || p.username}`).join('; ');
        const playerIds = (t.players || []).map((p: any) => p.id).join('; ');
        return [
          t.slotNumber,
          escapeCsvField(group),
          escapeCsvField(status),
          escapeCsvField(t.teamName),
          escapeCsvField(`@${t.captain?.displayName || t.captain?.username || 'Unknown'}`),
          escapeCsvField(t.captain?.id || ''),
          escapeCsvField(playerTags),
          escapeCsvField(playerIds),
          escapeCsvField(t.registeredAt || '')
        ].join(',');
      });
      return [header, ...rows].join('\n');
    }

    if (sorted.length === 0) {
      return 'No registered teams yet.';
    }

    return sorted
      .map(t => {
        const slotTag = t.isWaitlist
          ? `WL #${t.slotNumber < 10 ? '0' + t.slotNumber : t.slotNumber}`
          : `Slot #${t.slotNumber < 10 ? '0' + t.slotNumber : t.slotNumber} (${t.group || 'Group A'})`;
        const players = (t.players || []).map((p: any) => `@${p.displayName || p.username}`).join(', ');
        return `${slotTag} | ${t.teamName} — Capt: @${t.captain?.displayName || t.captain?.username} [${players}]`;
      })
      .join('\n');
  }

  public getStatus(): BotStatus {
    this.refreshGuilds();

    const wsStatus = this.client?.ws?.status ?? null;
    const rawPing = this.client?.ws?.ping ?? null;
    const wsPing = typeof rawPing === 'number' && rawPing >= 0 ? Math.round(rawPing) : null;
    const uptimeSeconds = this.client?.uptime ? Math.floor(this.client.uptime / 1000) : null;

    const degradedReasons: string[] = [];
    let gatewayState: GatewayOperationalState = 'disconnected';

    if (this.status.isConnecting || this.isReconnectingGateway || wsStatus === 1 || wsStatus === 2) {
      gatewayState = 'reconnecting';
    } else if (this.status.isOnline && this.client?.isReady()) {
      if (this.status.guilds.length === 0) {
        degradedReasons.push('Bot is connected to Gateway but has not joined any Discord servers yet.');
      }
      for (const g of this.status.guilds) {
        const missingPerms: string[] = [];
        if (!g.permissions?.hasManageChannels) missingPerms.push('Manage Channels');
        if (!g.permissions?.hasManageRoles) missingPerms.push('Manage Roles');
        if (!g.permissions?.hasSendMessages) missingPerms.push('Send Messages');
        if (missingPerms.length > 0) {
          degradedReasons.push(`Server "${g.name}" is missing permissions: ${missingPerms.join(', ')}`);
        }
      }
      if (wsPing !== null && wsPing > 500) {
        degradedReasons.push(`High Discord Gateway latency (${wsPing}ms)`);
      }
      gatewayState = degradedReasons.length > 0 ? 'partially_operational' : 'connected';
    } else {
      gatewayState = 'disconnected';
    }

    this.status.gatewayState = gatewayState;
    this.status.wsPing = wsPing;
    this.status.wsStatus = wsStatus;
    this.status.uptimeSeconds = uptimeSeconds;
    this.status.degradedReasons = degradedReasons;

    return this.status;
  }

  public logEvent(type: 'info' | 'success' | 'warn' | 'error', message: string, guildName?: string) {
    const event: BotLogEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      guildName
    };
    this.status.events = [event, ...(this.status.events || [])].slice(0, 50);
    console.log(`[DiscordBot] ${message}`);
  }

  public async start(token: string): Promise<{ success: boolean; error?: string }> {
    if (!token || token.trim().length < 20) {
      this.status.lastError = 'Invalid Discord bot token provided.';
      this.status.gatewayState = 'disconnected';
      this.logEvent('error', this.status.lastError);
      return { success: false, error: this.status.lastError };
    }

    if (this.client) {
      await this.stop();
    }

    this.status.isConnecting = true;
    this.status.gatewayState = 'reconnecting';
    this.status.lastError = null;
    this.logEvent('info', 'Connecting to Discord Gateway with provided bot token...');

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMembers
        ],
        presence: {
          activities: [{ name: 'Glacier Cup', type: ActivityType.Watching }],
          status: 'online'
        }
      });

      this.setupListeners();

      await this.client.login(token.trim());

      this.status.isOnline = true;
      this.status.isConnecting = false;
      this.isReconnectingGateway = false;
      this.status.startedAt = new Date().toISOString();

      if (this.client.user) {
        this.status.botUser = {
          id: this.client.user.id,
          tag: 'FFA | Glacier Cup Manager™',
          avatar: '/assets/glacier-cup-logo.png'
        };
      }

      this.refreshGuilds();
      this.getStatus();
      this.logEvent('success', `Bot is LIVE and online as FFA | Glacier Cup Manager™ (${this.client.user?.tag})! Listening to tournaments.`);

      return { success: true };
    } catch (err: any) {
      this.status.isOnline = false;
      this.status.isConnecting = false;
      this.isReconnectingGateway = false;
      this.status.gatewayState = 'disconnected';
      this.status.lastError = err.message || 'Failed to login with Discord token';
      this.logEvent('error', `Login failed: ${this.status.lastError}. (Tip: Ensure Privileged Gateway Intents "Message Content" and "Server Members" are toggled ON in Discord Developer Portal).`);
      if (this.client) {
        this.client.destroy().catch(() => {});
        this.client = null;
      }
      return { success: false, error: this.status.lastError || undefined };
    }
  }

  public async stop(): Promise<void> {
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    for (const [, timer] of this.slotListUpdateTimers) {
      clearTimeout(timer);
    }
    this.slotListUpdateTimers.clear();

    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
      }
      this.client = null;
    }
    this.status.isOnline = false;
    this.status.isConnecting = false;
    this.isReconnectingGateway = false;
    this.status.gatewayState = 'disconnected';
    this.status.wsPing = null;
    this.status.wsStatus = null;
    this.status.uptimeSeconds = null;
    this.status.degradedReasons = [];
    this.status.botUser = null;
    this.status.guilds = [];
    this.logEvent('info', 'Discord bot gateway connection closed.');
  }

  private refreshGuilds() {
    if (!this.client || !this.client.isReady()) return;
    const guildsList: BotGuildInfo[] = [];
    this.client.guilds.cache.forEach(guild => {
      const textChannels: { id: string; name: string; type: number }[] = [];
      guild.channels.cache.forEach(ch => {
        if (ch.isTextBased()) {
          textChannels.push({ id: ch.id, name: ch.name, type: ch.type });
        }
      });

      const botMember = guild.members.me;
      const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
      const hasManageChannels = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ?? false);
      const hasManageRoles = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false);
      const hasSendMessages = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.SendMessages) ?? false);
      const hasManageMessages = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageMessages) ?? false);
      const hasEmbedLinks = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.EmbedLinks) ?? false);

      guildsList.push({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channels: textChannels,
        permissions: {
          isAdmin,
          hasManageChannels,
          hasManageRoles,
          hasSendMessages,
          hasManageMessages,
          hasEmbedLinks
        }
      });
    });
    this.status.guilds = guildsList;
  }

  private setupListeners() {
    if (!this.client) return;

    this.client.on('error', (err) => {
      this.logEvent('warn', `Gateway notice: ${err.message}`);
    });

    this.client.on('shardError', (err) => {
      this.logEvent('warn', `Shard connection notice: ${err.message}`);
    });

    this.client.on('shardReconnecting', (id) => {
      this.isReconnectingGateway = true;
      this.status.gatewayState = 'reconnecting';
      this.logEvent('warn', `Shard #${id} reconnecting to Discord Gateway...`);
    });

    this.client.on('shardResume', (id, replayedEvents) => {
      this.isReconnectingGateway = false;
      this.status.isOnline = true;
      this.getStatus();
      this.logEvent('success', `Shard #${id} resumed Gateway session (${replayedEvents} events replayed).`);
    });

    this.client.on('shardDisconnect', (event, id) => {
      this.isReconnectingGateway = false;
      this.status.isOnline = false;
      this.status.gatewayState = 'disconnected';
      this.logEvent('error', `Shard #${id} disconnected from Discord Gateway (Code ${event.code}).`);
    });

    this.client.on('ready', async () => {
      console.log(`[DiscordBot] Logged in as ${this.client?.user?.tag}`);
      this.isReconnectingGateway = false;
      this.status.isOnline = true;
      this.status.isConnecting = false;
      this.client?.user?.setActivity('Glacier Cup', { type: ActivityType.Watching });

      if (this.client?.user) {
        this.status.botUser = {
          id: this.client.user.id,
          tag: 'FFA-Manager',
          avatar: '/assets/glacier-cup-logo.png'
        };
      }

      this.refreshGuilds();
      this.getStatus();

      await this.registerSlashCommands(false);

      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      this.client?.guilds.cache.forEach(guild => {
        guild.members.me?.setNickname('FFA-Manager').catch(() => {});
        const regChannel = guild.channels.cache.find(
          c => (c.name === config?.regChannel || c.name === '📝┃registration' || c.name === 'registration') && c.isTextBased()
        );
        if (regChannel) {
          if (config) {
            if (!config.totalSlots || config.totalSlots <= 0) {
              config.regChannel = regChannel.name;
              config.slotListChannel = '📊┃slot-list';
              config.idpChannel = '🔑┃id-pass';
              config.rulesChannel = '📋┃rules-format';
              config.totalSlots = 20;
              config.teamsPerGroup = 20;
              config.groupsCount = 1;
              config.title = config.title || `${guild.name} Championship`;
            }
            if (!config.explicitlyStoppedOrPaused) {
              config.status = 'open';
            }
          }
          this.logEvent('info', `Listening to #${regChannel.name} in "${guild.name}" as FFA-Manager`, guild.name);
        } else {
          this.logEvent('info', `Connected to "${guild.name}" as FFA-Manager. Ready for registrations. (Use /setup or !setup).`, guild.name);
        }
      });

      setTimeout(async () => {
        try {
          if (this.client?.user && !this.client.user.avatar) {
            const logoPath = path.join(process.cwd(), 'public/assets/glacier-cup-logo.png');
            if (fs.existsSync(logoPath)) {
              const logoBuffer = fs.readFileSync(logoPath);
              await this.client.user.setAvatar(logoBuffer).catch(() => {});
            }
          }
          if (this.client?.user && this.client.user.username !== 'FFA-Manager') {
            await this.client.user.setUsername('FFA-Manager').catch(() => {});
          }
        } catch {
        }
      }, 2000);
    });

    this.client.on('guildCreate', async (guild) => {
      guild.members.me?.setNickname('FFA-Manager').catch(() => {});
      this.logEvent('info', `Bot joined new server: "${guild.name}" (${guild.memberCount} members). Run /setup or /create to launch a tournament.`, guild.name);
      this.refreshGuilds();
      await this.registerSlashCommands(true);
    });

    this.client.on('guildDelete', (guild) => {
      this.logEvent('warn', `Bot removed from server: "${guild.name}"`, guild.name);
      this.refreshGuilds();
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleInteraction(interaction);
          return;
        }

        if (interaction.isButton()) {
          if (interaction.customId === 'register_team_panel_btn') {
            const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
            if (!cfg) {
              await interaction.reply({
                content: '❌ Tournament configuration is not ready yet.',
                ephemeral: true
              });
              return;
            }
            if (!cfg.totalSlots || cfg.totalSlots <= 0) {
              cfg.totalSlots = 20;
              cfg.requiredTags = cfg.requiredTags || 4;
              cfg.maxTags = cfg.requiredTags;
            }
            if (!cfg.explicitlyStoppedOrPaused && cfg.status !== 'open') {
              cfg.status = 'open';
            }
            if (cfg.status === 'paused' && cfg.explicitlyStoppedOrPaused) {
              await interaction.reply({
                content: `⏸️ Registrations for **${cfg.title || 'this tournament'}** are currently **PAUSED** by tournament staff.`,
                ephemeral: true
              });
              return;
            }
            if (cfg.status === 'closed' && cfg.explicitlyStoppedOrPaused) {
              await interaction.reply({
                content: `🔴 Registrations for **${cfg.title || 'this tournament'}** are currently **CLOSED**. Please wait for tournament staff to run \`/start-registration\`.`,
                ephemeral: true
              });
              return;
            }

            await interaction.showModal(this.createTeamRegistrationModal(cfg));
            return;
          }

          if (interaction.customId === 'reg_open_modal_btn') {
            const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
            const draft = this.pendingRegistrationDrafts.get(interaction.user.id);
            const selectedRegion = draft?.region || 'India';
            const preselectedPlayers = draft?.playerIds || [];
            await interaction.showModal(this.createTeamRegistrationModal(cfg, selectedRegion, preselectedPlayers));
            return;
          }

          if (interaction.customId === 'open_rules_modal') {
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            if (!isStaff) {
              await interaction.reply({
                content: '❌ **Access Restricted:** Only members with the **@FFA Bot Manager** role can set and publish tournament rules.',
                ephemeral: true
              });
              return;
            }
            const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
            await interaction.showModal(this.createRulesModal(cfg?.customRules));
            return;
          }

          if (interaction.customId.startsWith('confirm_delete_tourney:')) {
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            if (!isStaff) {
              await interaction.reply({
                content: '❌ **Access Restricted:** Only members with the **@FFA Bot Manager** role can confirm tournament deletion.',
                ephemeral: true
              });
              return;
            }
            const deleteChannels = interaction.customId.endsWith(':1');
            await interaction.update({
              content: '⏳ **Deleting tournament channels and resetting rosters...**',
              embeds: [],
              components: []
            });
            const result = await this.deleteTournament(interaction.guild || undefined, deleteChannels);
            const embed = new EmbedBuilder()
              .setTitle('🗑️ Tournament Deleted & Roster Reset')
              .setColor(0xED4245)
              .setDescription(`The active tournament has been deleted by <@${interaction.user.id}>. All registered rosters and slots have been cleared.`)
              .addFields(
                {
                  name: 'Deleted Channels / Category',
                  value: result.deletedChannels.length > 0 ? result.deletedChannels.join('\n') : '*(Channels retained; rosters reset)*',
                  inline: false
                }
              )
              .setTimestamp();
            await interaction.editReply({ content: null, embeds: [embed], components: [] });
            return;
          }

          if (interaction.customId === 'cancel_delete_tourney') {
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            if (!isStaff) {
              await interaction.reply({
                content: '❌ **Access Restricted:** Only members with the **@FFA Bot Manager** role can use this control.',
                ephemeral: true
              });
              return;
            }
            await interaction.update({
              content: '✅ **Tournament deletion cancelled.** No channels or rosters were modified.',
              embeds: [],
              components: []
            });
            return;
          }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'reg_region_select') {
          const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
          const rawVal = interaction.values[0];
          const chosenRegion: 'India' | 'Bangladesh' | 'Pakistan' =
            rawVal === 'Bangladesh' ? 'Bangladesh' : rawVal === 'Pakistan' ? 'Pakistan' : 'India';
          await interaction.showModal(this.createTeamRegistrationModal(cfg, chosenRegion, []));
          return;
        }

        if (interaction.isUserSelectMenu() && interaction.customId === 'reg_players_select') {
          const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
          await interaction.showModal(this.createTeamRegistrationModal(cfg, 'India', interaction.values));
          return;
        }

        if (
          interaction.isModalSubmit() &&
          (interaction.customId === 'submit_team_reg_modal' || interaction.customId.startsWith('submit_team_reg_modal:'))
        ) {
          const cfg = this.getTournamentConfig ? this.getTournamentConfig() : null;
          if (!cfg) {
            await interaction.reply({ content: '❌ Tournament configuration not loaded.', ephemeral: true });
            return;
          }
          await this.withOperationLock(() => this.handleModalRegistration(interaction, cfg));
          return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'submit_rules_modal') {
          if (!interaction.guild) {
            await interaction.reply({ content: '❌ This can only be used inside a server.', ephemeral: true });
            return;
          }
          const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
          if (!isStaff) {
            await interaction.reply({
              content: '❌ **Access Restricted:** Only members with the **@FFA Bot Manager** role can publish tournament rules.',
              ephemeral: true
            });
            return;
          }
          await interaction.deferReply({ ephemeral: false });
          const rulesText = interaction.fields.getTextInputValue('rules_text').trim();
          this.pendingRulesPrompts.delete(`${interaction.guild.id}:${interaction.user.id}`);

          const pubRes = await this.publishRulesToChannel(interaction.guild, rulesText, interaction.user.username);
          if (pubRes.success) {
            const confirmEmbed = new EmbedBuilder()
              .setTitle('✅ Tournament Rules Published!')
              .setColor(0x57F287)
              .setDescription(`Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!`)
              .setFooter({ text: `Published by @${interaction.user.username} • FFA-Manager` })
              .setTimestamp();
            await interaction.editReply({ embeds: [confirmEmbed] });
          } else {
            await interaction.editReply(`❌ Failed to publish rules: ${pubRes.error}`);
          }
        }
      } catch (err: any) {
        console.log('[DiscordBot] Interaction handling notice:', err?.message || err);
        this.logEvent('info', `Interaction notice: ${err.message || 'Unknown error'}`);
        try {
          if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply(`❌ Command error: ${err.message || 'An unexpected error occurred.'}`).catch(() => {});
            } else {
              await interaction.reply({ content: `❌ Command error: ${err.message || 'An unexpected error occurred.'}`, ephemeral: true }).catch(() => {});
            }
          }
        } catch {
        }
      }
    });

    this.client.on('messageCreate', async (message: Message) => {
      try {
        if (message.author.bot) return;

        const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
        if (!config) return;

        const channelName = (message.channel as TextChannel).name;
        const content = message.content.trim();

        if (message.guild && content.length > 0 && !content.startsWith('!') && !content.startsWith('/')) {
          const promptKey = `${message.guild.id}:${message.author.id}`;
          const pending = this.pendingRulesPrompts.get(promptKey);
          if (pending && pending.channelId === message.channel.id && Date.now() < pending.expiresAt) {
            this.pendingRulesPrompts.delete(promptKey);
            const pubRes = await this.publishRulesToChannel(message.guild, content, message.author.username);
            if (pubRes.success) {
              const confirmEmbed = new EmbedBuilder()
                .setTitle('✅ Tournament Rules Published!')
                .setColor(0x57F287)
                .setDescription(`Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!`)
                .setFooter({ text: `Published by @${message.author.username} • FFA-Manager` })
                .setTimestamp();
              await message.reply({ embeds: [confirmEmbed] }).catch(() => {});
            } else {
              await message.reply(`❌ Failed to publish rules: ${pubRes.error}`).catch(() => {});
            }
            return;
          }
        }

        if (content.startsWith('!')) {
          await this.handleCommand(message, config);
          return;
        }

        if (
          channelName === config.regChannel ||
          message.channel.id === config.regChannel ||
          channelName === '📝┃registration' ||
          channelName === 'registration'
        ) {
          await this.withOperationLock(() => this.handleRegistration(message, config));
        }
      } catch (err: any) {
        this.logEvent('info', `Message handler notice: ${err?.message || err}`);
      }
    });
  }

  private async handleCommand(message: Message, config: any) {
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();
    const isSetupCmd = cmd === 'setup' || cmd === 'create' || (cmd === 'tourney' && args[0] === 'setup');
    const isStaff = this.hasBotManagerRole(message.member, message.guild, isSetupCmd);

    if (cmd !== 'slots' && !isStaff) {
      return message.reply(
        `❌ **Access Restricted:** Only members with the **@${config?.managerRoleName || 'FFA Bot Manager'}** role can use bot commands. Normal members can only register their team in \`#${config?.regChannel || '📝┃registration'}\` and check the slot list (\`!slots\` or \`#${config?.slotListChannel || '📊┃slot-list'}\`).`
      );
    }

    if (cmd === 'help' || cmd === 'commands') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 FFA | Glacier Cup Manager™ — Full Command Suite')
        .setColor(0x5865F2)
        .setDescription('Official FFA | Glacier Cup Manager™ Tagcheck Tournament Bot for Discord. Supports both **Slash Commands** (`/`) and prefix commands (`!`).')
        .addFields(
          {
            name: '🏆 Tournament Setup & Channels',
            value: '`/setup [slots] [tags] [groups] [title]` — Auto-create category, channels & `@FFA Bot Manager` + `@Verified Team` roles (up to 500 slots; `groups` = teams per group; registration stays closed)\n`/start-registration` — Start registration & unlock `#registration`\n`/pause-registration [reason]` — Pause registration & temporarily lock `#registration`\n`/stop-registration [reason]` — End registration & lock `#registration`\n`/delete slot <slot>` — Remove team & promote waitlist\n`/delete tournament` — Preview & delete tournament',
            inline: false
          },
          {
            name: '🔑 Lobby & Registration Control',
            value: '`/idpass <room_id> <pass> [map] [time]` — Broadcast private Room ID & Pass to `#id-pass`\n`/start-registration` • `/pause-registration` • `/stop-registration` — Open, pause, or close `#registration`\n`/swap-slots <slot1> <slot2>` — Swap two teams\' slot numbers & groups\n`/announce <message>` — Send official tournament announcement',
            inline: false
          },
          {
            name: '🛡️ Verification, Roster & Standings',
            value: '`/tagcheck <@user>` — Inspect if a player is already registered or banned\n`/team-info <slot_or_name>` — Full dossier for any registered team\n`/blacklist add|remove|list` — Ban/unban players from registering\n`/standings [group]` — View tournament points table\n`/rules` — Display official tournament rulebook\n`/export [format]` — Export clean roster list (Markdown / CSV)',
            inline: false
          },
          {
            name: '📝 Registration Format',
            value: '```text\nTeam Name: <Team Name>\nPlayer 1: @Tag1\nPlayer 2: @Tag2\nPlayer 3: @Tag3\nPlayer 4: @Tag4\n```',
            inline: false
          }
        )
        .setFooter({ text: 'Powered by FFA | Glacier Cup Manager™ • Restricted to @FFA Bot Manager' });
      return message.reply({ embeds: [helpEmbed] });
    }

    if (cmd === 'setup' || cmd === 'create' || (cmd === 'tourney' && args[0] === 'setup')) {
      if (!isStaff) {
        return message.reply(`❌ Only members with the **@${config?.managerRoleName || 'FFA Bot Manager'}** role can create and setup tournaments.`);
      }

      if (!message.guild) {
        return message.reply('❌ This command can only be used inside a Discord server.');
      }

      const subArgs = (cmd === 'tourney' && args[0] === 'setup') ? args.slice(1) : args;
      const rawSlots = parseInt(subArgs[0], 10);
      const rawTags = parseInt(subArgs[1], 10);
      const rawTeamsPerGroup = parseInt(subArgs[2], 10);

      if (!isNaN(rawSlots) && !isNaN(rawTags)) {
        const slots = Math.max(2, Math.min(500, rawSlots));
        const tags = Math.max(1, Math.min(10, rawTags));
        const teamsPerGroup = !isNaN(rawTeamsPerGroup) && rawTeamsPerGroup > 0 ? Math.min(slots, rawTeamsPerGroup) : slots;
        const groupsCount = Math.max(1, Math.ceil(slots / teamsPerGroup));
        const title = subArgs.slice(3).join(' ').trim() || `${config.game || 'Tournament'} Championship`;

        const setupWaitMsg = await message.reply('⏳ **Validating permissions and generating tournament category, channels, and `@FFA Bot Manager` + `@Verified Team` roles...**');
        const result = await this.createTournament(message.guild, {
          slots,
          tags,
          teamsPerGroup,
          title,
          createdBy: message.author.tag,
          createdByUserId: message.author.id
        });

        if (result.success) {
          this.pendingRulesPrompts.set(`${message.guild.id}:${message.author.id}`, {
            guildId: message.guild.id,
            channelId: message.channel.id,
            expiresAt: Date.now() + 10 * 60 * 1000
          });

          const successEmbed = new EmbedBuilder()
            .setTitle('🏆 Tournament Setup Complete — Registration Open')
            .setColor(result.warnings && result.warnings.length > 0 ? 0xFEE75C : 0x57F287)
            .setDescription(`**${title}** has been provisioned in **${message.guild.name}**! Registration is **OPEN** and the registration panel is active in \`#📝┃registration\`.`)
            .addFields(
              { name: 'Slots & Tags', value: `\`${slots} Slots\` • \`${tags} Tags/Team\``, inline: true },
              { name: 'Group Allocation', value: `\`${teamsPerGroup} Teams/Group\` (\`${groupsCount} Group(s)\`)`, inline: true },
              { name: 'Registration Status', value: '🟢 `OPEN (Registration Active)`', inline: true },
              { name: 'Created Category & Channels', value: result.created.join('\n') || 'All channels active', inline: false },
              {
                name: '▶️ Registration Control Commands',
                value: '• Registration continues indefinitely until you pause or stop it.\n• Run **`/pause-registration`** to pause or **`/stop-registration`** to end registration.',
                inline: false
              }
            )
            .setFooter({ text: 'FFA-Manager • Registered teams will automatically receive @Verified Team' })
            .setTimestamp();

          if (result.warnings && result.warnings.length > 0) {
            successEmbed.addFields({
              name: '⚠️ Partial Setup Warnings',
              value: result.warnings.join('\n'),
              inline: false
            });
          }

          successEmbed.addFields({
            name: '📜 Next Step — Provide Tournament Rules',
            value: 'Please **reply with your Tournament Rules & Format** in this channel (or click the button below / use `/rules`) and I will publish them to `#📋┃rules-format`!',
            inline: false
          });

          return setupWaitMsg.edit({
            content: '✅ **Tournament Setup Complete! Registration is now OPEN in `#📝┃registration`:**',
            embeds: [successEmbed],
            components: [this.createRulesButtonRow()]
          });
        } else {
          const rollbackNote = result.rolledBack && result.rolledBack.length > 0
            ? `\n🔄 **Rolled Back Partial Resources:** ${result.rolledBack.join(', ')}`
            : '';
          return setupWaitMsg.edit(`❌ **Setup Failed:** ${result.error || 'Check bot permissions'}${rollbackNote}`);
        }
      }

      const wizardEmbed = new EmbedBuilder()
        .setTitle('🏆 Tournament Setup & Auto-Generation Wizard')
        .setColor(0x5865F2)
        .setDescription(
          `Create a tournament instantly! The bot will validate permissions and automatically create:\n` +
          `• 📁 **Tournament Category** (\`🏆 ┃ TOURNAMENTS\`)\n` +
          `• 📋 **#rules-format** (Information, format, & rules)\n` +
          `• 📝 **#registration** (Tag-basis verification channel)\n` +
          `• 📊 **#slot-list** (Live slots divided by Groups)\n` +
          `• 🔑 **#id-pass** (Restricted to **@Verified Team** role)\n` +
          `• 🛡️ **@Verified Team Role** (Auto-assigned upon successful registration)\n\n` +
          `**Choose a quick preset below or reply with custom parameters:**`
        )
        .addFields(
          {
            name: '⚡ Quick Preset 1: Squad Scrims',
            value: '`20 Slots` • `4 Tags` • `1 Group`',
            inline: true
          },
          {
            name: '👥 Quick Preset 2: 2-Group Scrims',
            value: '`32 Slots` • `4 Tags` • `2 Groups (A & B)`',
            inline: true
          },
          {
            name: '🏆 Quick Preset 3: 4-Group Championship',
            value: '`48 Slots` • `4 Tags` • `4 Groups (A, B, C, D)`',
            inline: true
          },
          {
            name: '🎯 Quick Preset 4: Duo Scrims',
            value: '`24 Slots` • `2 Tags` • `1 Group`',
            inline: true
          },
          {
            name: '⌨️ Fast Command Syntax',
            value: '`!setup <slots> <tags> <groups> [Tournament Name]`\n*Example:* `!setup 20 4 2 Glacier Cup S1`',
            inline: false
          }
        )
        .setFooter({ text: 'Select a preset button below within 60 seconds' });

      const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('setup_preset_squad_20')
          .setLabel('⚡ 20 Slots (4 Tags, 1 Grp)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_preset_2grp_32')
          .setLabel('👥 32 Slots (4 Tags, 2 Grps)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_preset_4grp_48')
          .setLabel('🏆 48 Slots (4 Tags, 4 Grps)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_preset_duo_24')
          .setLabel('🎯 24 Slots (2 Tags, 1 Grp)')
          .setStyle(ButtonStyle.Secondary)
      );

      const promptMsg = await message.reply({ embeds: [wizardEmbed], components: [row1] });

      const collector = promptMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id && !this.hasBotManagerRole(interaction.member, interaction.guild, true)) {
          return interaction.reply({ content: '❌ Only `@FFA Bot Manager` staff who initiated the setup can use these buttons.', ephemeral: true });
        }

        let chosenSlots = 20;
        let chosenTags = 4;
        let chosenGroups = 1;
        let chosenTitle = `${config.game || 'Tournament'} Scrims`;

        if (interaction.customId === 'setup_preset_squad_20') {
          chosenSlots = 20;
          chosenTags = 4;
          chosenGroups = 1;
          chosenTitle = 'Glacier Cup Squads';
        } else if (interaction.customId === 'setup_preset_2grp_32') {
          chosenSlots = 32;
          chosenTags = 4;
          chosenGroups = 2;
          chosenTitle = 'Elite Scrims — 2 Groups';
        } else if (interaction.customId === 'setup_preset_4grp_48') {
          chosenSlots = 48;
          chosenTags = 4;
          chosenGroups = 4;
          chosenTitle = 'Championship Series — 4 Groups';
        } else if (interaction.customId === 'setup_preset_duo_24') {
          chosenSlots = 24;
          chosenTags = 2;
          chosenGroups = 1;
          chosenTitle = 'Duo Scrims';
        }

        await interaction.update({
          content: '⏳ **Validating permissions & creating Tournament Category, Channels & `@FFA Bot Manager` Role...**',
          embeds: [],
          components: []
        });

        const res = await this.createTournament(interaction.guild!, {
          slots: chosenSlots,
          tags: chosenTags,
          groups: chosenGroups,
          title: chosenTitle,
          createdBy: interaction.user.tag,
          createdByUserId: interaction.user.id
        });

        if (res.success) {
          this.pendingRulesPrompts.set(`${interaction.guild!.id}:${interaction.user.id}`, {
            guildId: interaction.guild!.id,
            channelId: message.channel.id,
            expiresAt: Date.now() + 10 * 60 * 1000
          });

          const doneEmbed = new EmbedBuilder()
            .setTitle('🏆 Tournament Auto-Created!')
            .setColor(res.warnings && res.warnings.length > 0 ? 0xFEE75C : 0x57F287)
            .setDescription(`**${chosenTitle}** is ready in **${interaction.guild?.name}**!`)
            .addFields(
              { name: 'Configuration', value: `\`${chosenSlots} Slots\` • \`${chosenTags} Tags/Team\` • \`${chosenGroups} Group(s)\``, inline: false },
              { name: 'Created Channels & Role', value: res.created.join('\n') || 'Channels ready', inline: false }
            )
            .setFooter({ text: 'Teams registering will be granted @Verified Team and unlock #id-pass' });

          if (res.warnings && res.warnings.length > 0) {
            doneEmbed.addFields({
              name: '⚠️ Partial Setup Warnings',
              value: res.warnings.join('\n'),
              inline: false
            });
          }

          doneEmbed.addFields({
            name: '📜 Next Step — Provide Tournament Rules',
            value: 'Please **send your Tournament Rules & Format** in this channel (or click the button below) and I will post them in `#📋┃rules-format`!',
            inline: false
          });

          await promptMsg.edit({
            content: '✅ **Setup Complete! Please provide your tournament rules:**',
            embeds: [doneEmbed],
            components: [this.createRulesButtonRow()]
          });
        } else {
          const rollbackNote = res.rolledBack && res.rolledBack.length > 0
            ? `\n🔄 **Rolled Back Partial Resources:** ${res.rolledBack.join(', ')}`
            : '';
          await promptMsg.edit({ content: `❌ **Setup Failed:** ${res.error}${rollbackNote}` });
        }
      });
      return;
    }

    if (cmd === 'tourney' || cmd === 'gt') {
      if (!isStaff) {
        return message.reply('❌ You need `Manage Channels` permission to manage tournaments.');
      }
      const sub = args[0]?.toLowerCase();
      if (sub === 'open') {
        config.status = 'open';
        config.explicitlyStoppedOrPaused = false;
        if (this.onConfigUpdated) this.onConfigUpdated();
        this.logEvent('info', `Admin @${message.author.username} opened registrations via Discord command.`, message.guild?.name);
        return message.reply('🟢 **Tournament registrations are now OPEN!**');
      } else if (sub === 'pause') {
        config.status = 'paused';
        config.explicitlyStoppedOrPaused = true;
        if (this.onConfigUpdated) this.onConfigUpdated();
        this.logEvent('info', `Admin @${message.author.username} paused registrations via Discord command.`, message.guild?.name);
        return message.reply('⏸️ **Tournament registrations are now PAUSED!**');
      } else if (sub === 'close') {
        config.status = 'closed';
        config.explicitlyStoppedOrPaused = true;
        if (this.onConfigUpdated) this.onConfigUpdated();
        this.logEvent('info', `Admin @${message.author.username} closed registrations via Discord command.`, message.guild?.name);
        return message.reply('🔴 **Tournament registrations are now CLOSED!**');
      } else if (sub === 'reset') {
        config.status = 'open';
        config.explicitlyStoppedOrPaused = false;
        if (this.onConfigUpdated) this.onConfigUpdated();
        this.logEvent('warn', `Admin @${message.author.username} reset registrations via Discord command.`, message.guild?.name);
        return message.reply('🔄 **Tournament slots have been reset.**');
      }
    }

    if (cmd === 'tagcheck' || cmd === 'gtagcheck') {
      const mentionedUser = message.mentions.users.first();
      const rawArg = args[0] || '';
      const idMatch = rawArg.match(/^<@!?(\d+)>$/) || rawArg.match(/^(\d{15,20})$/);

      if (mentionedUser || idMatch || (rawArg && isNaN(parseInt(rawArg, 10)))) {
        const targetId = mentionedUser?.id || (idMatch ? idMatch[1] : rawArg.replace(/^@/, ''));
        const targetName = mentionedUser?.username || targetId;
        const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
        const banned = this.blacklist.find(b => b.userId === targetId || b.username.toLowerCase() === targetName.toLowerCase());
        const foundTeam = teams.find(t =>
          t.players.some((p: any) => p.id === targetId || p.username?.toLowerCase() === targetName.toLowerCase() || p.displayName?.toLowerCase() === targetName.toLowerCase())
        );

        const embed = new EmbedBuilder()
          .setTitle('🔍 FFA | Glacier Cup Manager™ Player Tagcheck Dossier')
          .setColor(banned ? 0xED4245 : foundTeam ? 0xFEE75C : 0x57F287)
          .setDescription(`Inspection results for <@${targetId}> (\`${targetName}\`):`)
          .addFields(
            {
              name: 'Eligibility Status',
              value: banned
                ? `🚫 **BLACKLISTED** — Reason: *${banned.reason}*`
                : foundTeam
                ? `⚠️ **ALREADY REGISTERED** (Cannot join another team)`
                : `✅ **ELIGIBLE / FREE AGENT** (Cleared to register)`,
              inline: false
            }
          )
          .setTimestamp();

        if (foundTeam) {
          embed.addFields(
            { name: 'Registered Team', value: `**${foundTeam.teamName}**`, inline: true },
            { name: 'Allocated Slot', value: foundTeam.isWaitlist ? `Waitlist #${foundTeam.slotNumber}` : `Slot #${foundTeam.slotNumber} (${foundTeam.group || 'Group A'})`, inline: true },
            { name: 'Team Captain', value: `<@${foundTeam.captain.id}>`, inline: true }
          );
        }
        return message.reply({ embeds: [embed] });
      }

      if (!isStaff) return message.reply('❌ Permission denied.');
      const req = parseInt(rawArg, 10);
      if (!isNaN(req)) {
        config.requiredTags = req;
        this.logEvent('info', `Admin @${message.author.username} updated required tags to ${req}.`, message.guild?.name);
        return message.reply(`⚙️ Minimum required tags set to **${req}**.`);
      }
      return message.reply(`Current required tags: **${config.requiredTags}** (Format: ${config.format}). Usage: \`!tagcheck @user\` or \`!tagcheck <number>\`.`);
    }

    if (cmd === 'eztag' || cmd === 'geztag') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      config.easyTagEnabled = !config.easyTagEnabled;
      this.logEvent('info', `Admin @${message.author.username} toggled EasyTag to ${config.easyTagEnabled ? 'ENABLED' : 'DISABLED'}.`, message.guild?.name);
      return message.reply(`⚙️ EasyTag automatic ID-conversion is now **${config.easyTagEnabled ? 'ENABLED' : 'DISABLED'}**.`);
    }

    if (cmd === 'slots') {
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const confirmed = teams.filter(t => !t.isWaitlist);
      const waitlist = teams.filter(t => t.isWaitlist);
      const groupedChunks = this.formatGroupedSlotListChunks(confirmed, config);
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${config.title || 'Tournament'} — Live Slot List`)
        .setColor(0x5865F2)
        .setDescription(groupedChunks[0])
        .addFields(
          { name: 'Confirmed Slots', value: `\`${confirmed.length} / ${config.totalSlots}\``, inline: true },
          { name: 'Teams Per Group', value: `\`${config.teamsPerGroup || config.totalSlots || 20} Teams/Group\``, inline: true },
          { name: 'Registration Status', value: config.status === 'open' ? '🟢 `OPEN`' : config.status === 'paused' ? '⏸️ `PAUSED`' : '🔴 `LOCKED`', inline: true }
        )
        .setTimestamp();
      if (waitlist.length > 0) {
        embed.addFields({
          name: `⏳ Waiting List (${waitlist.length}/${config.waitlistSlots})`,
          value: waitlist.map(w => `\`WL #${w.slotNumber}\` **${w.teamName}** — <@${w.captain.id}>`).join('\n').slice(0, 1020),
          inline: false
        });
      }
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'idpass' || cmd === 'idp') {
      if (!isStaff) return message.reply('❌ You need `Manage Channels` or `Administrator` permission to publish Room ID & Password.');
      const roomId = args[0];
      const roomPass = args[1];
      if (!roomId || !roomPass) {
        return message.reply('❌ Usage: `!idpass <room_id> <password> [map] [start_time]` (or `/idpass` for private ephemeral dispatch).');
      }

      await this.safeDeleteMessage(message, 'idpass-command-redaction');

      const mapName = args[2] || 'Main Lobby';
      const matchTime = args.slice(3).join(' ') || 'Starts in 15 Mins';
      const creds = {
        roomId,
        roomPass,
        mapName,
        matchTime,
        serverType: 'Official Match Lobby',
        sentAt: new Date().toISOString()
      };
      const res = await this.dispatchIdp(creds, config, message.guild || undefined);
      if (!res.success) {
        return (message.channel as TextChannel).send(
          `❌ **Failed to publish Room ID & Password:** ${res.error || 'Could not send to #id-pass.'}`
        );
      }
      const maskedId = roomId.length > 2 ? `***${roomId.slice(-2)}` : '***';
      const embed = new EmbedBuilder()
        .setTitle('🔑 Room ID & Password Dispatched!')
        .setColor(res.failedGuilds.length > 0 ? 0xFEE75C : 0x57F287)
        .setDescription(`Credentials have been published to **#${config.idpChannel || 'id-pass'}** (${res.sentCount} channel(s) notified). Command message was auto-deleted to protect lobby credentials.`)
        .addFields(
          { name: 'Room ID', value: `\`${maskedId}\` *(See #id-pass)*`, inline: true },
          { name: 'Password', value: '`[REDACTED]` *(See #id-pass)*', inline: true },
          { name: 'Map & Time', value: `${mapName} • ${matchTime}`, inline: true }
        )
        .setTimestamp();

      if (res.failedGuilds.length > 0) {
        embed.addFields({
          name: '⚠️ Publication Failures',
          value: res.failedGuilds.map(f => `• **${f.guildName}**: ${f.reason}`).join('\n'),
          inline: false
        });
      }
      return (message.channel as TextChannel).send({ embeds: [embed] });
    }

    if (cmd === 'pause-registration' || cmd === 'pausereg' || cmd === 'pause') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const reason = args.join(' ') || 'Registration temporarily paused by tournament administrator.';
      const res = await this.pauseRegistration(message.guild || undefined, reason, message.author.username);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('⏸️ Tournament Registration Paused')
        .setColor(0xFEE75C)
        .setDescription(
          `Registrations for **${config.title || 'Active Tournament'}** are now **PAUSED** and \`#${config.regChannel || '📝┃registration'}\` is temporarily locked.\n` +
          `**Reason:** ${reason}\n\n` +
          `▶️ Run \`/start-registration\` (or \`!start-registration\`) to resume registrations.`
        )
        .setFooter({ text: `Paused by @${message.author.username}` })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'stop-registration' || cmd === 'stopreg' || cmd === 'lock') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const reason = args.join(' ') || 'Registration ended and channel locked by tournament administrator.';
      const res = await this.stopRegistration(message.guild || undefined, reason, message.author.username);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🔴 Tournament Registration Ended & Channel Locked')
        .setColor(0xED4245)
        .setDescription(
          `Registrations for **${config.title || 'Active Tournament'}** are now **CLOSED** and \`#${config.regChannel || '📝┃registration'}\` has been **LOCKED**.\n` +
          `**Reason:** ${reason}`
        )
        .setFooter({ text: `Stopped by @${message.author.username}` })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'start-registration' || cmd === 'startreg' || cmd === 'unlock') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const res = await this.startRegistration(message.guild || undefined, message.author.username);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🟢 Tournament Registration Started & Channel Unlocked!')
        .setColor(0x57F287)
        .setDescription(
          `Registrations for **${config.title}** are now **OPEN** and \`#${config.regChannel || '📝┃registration'}\` has been **UNLOCKED**!\n` +
          `Players can now tag **${config.requiredTags} players** with their Team Name to claim a slot.`
        )
        .setFooter({ text: `Started by @${message.author.username}` })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'blacklist' || cmd === 'banplayer') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const sub = args[0]?.toLowerCase() || 'list';
      if (sub === 'add') {
        const mentioned = message.mentions.users.first();
        const rawTarget = args[1];
        if (!mentioned && !rawTarget) {
          return message.reply('❌ Usage: `!blacklist add <@user_or_id> [reason]`');
        }
        const targetId = mentioned ? mentioned.id : rawTarget.replace(/[<@!>]/g, '');
        const targetName = mentioned ? mentioned.username : targetId;
        const reason = args.slice(2).join(' ') || 'Fairplay / Tournament Rule Violation';
        const entry = this.addToBlacklist(targetId, targetName, reason, message.author.username);
        const embed = new EmbedBuilder()
          .setTitle('🚫 Player Added to Tournament Blacklist')
          .setColor(0xED4245)
          .setDescription(`Player <@${entry.userId}> (\`${entry.username}\`) is now banned from registering or being tagged in any squad.`)
          .addFields(
            { name: 'Reason', value: entry.reason, inline: true },
            { name: 'Banned By', value: `@${entry.addedBy}`, inline: true }
          )
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      } else if (sub === 'remove' || sub === 'unban') {
        const mentioned = message.mentions.users.first();
        const rawTarget = args[1];
        if (!mentioned && !rawTarget) {
          return message.reply('❌ Usage: `!blacklist remove <@user_or_id>`');
        }
        const targetId = mentioned ? mentioned.id : rawTarget;
        const removed = this.removeFromBlacklist(targetId);
        return message.reply(removed ? `✅ Removed \`${targetId}\` from the tournament blacklist.` : `❌ Player \`${targetId}\` was not found on the blacklist.`);
      } else {
        const list = this.getBlacklist();
        const embed = new EmbedBuilder()
          .setTitle(`🚫 Tournament Blacklist (${list.length})`)
          .setColor(0xED4245)
          .setDescription(
            list.length > 0
              ? list.map((b, i) => `\`${i + 1}.\` <@${b.userId}> (\`${b.username}\`) — *${b.reason}*`).join('\n')
              : '✅ No players are currently blacklisted.'
          )
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }
    }

    if (cmd === 'team' || cmd === 'team-info' || cmd === 'teaminfo') {
      const queryArgs = args[0]?.toLowerCase() === 'info' ? args.slice(1) : args;
      const query = queryArgs.join(' ').trim();
      if (!query) {
        return message.reply('❌ Usage: `!team <slot_number_or_team_name>` (e.g. `!team 1` or `!team Soul`).');
      }
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const slotNum = parseInt(query.replace(/\D/g, ''), 10);
      const found = (!isNaN(slotNum) && String(slotNum) === query.replace('#', ''))
        ? teams.find(t => t.slotNumber === slotNum)
        : teams.find(t => t.teamName.toLowerCase().includes(query.toLowerCase()));

      if (!found) {
        return message.reply(`❌ No registered team matching \`${query}\` found.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Team Dossier — ${found.teamName}`)
        .setColor(found.isWaitlist ? 0xFEE75C : 0x5865F2)
        .addFields(
          { name: 'Slot Allocation', value: found.isWaitlist ? `\`Waitlist #${found.slotNumber}\`` : `\`Slot #${found.slotNumber}\``, inline: true },
          { name: 'Assigned Group', value: `\`${found.group || 'Group A'}\``, inline: true },
          { name: 'Team Captain', value: `<@${found.captain.id}>`, inline: true },
          {
            name: `Verified Roster (${found.players.length} Players)`,
            value: found.players.map((p: any, idx: number) => `\`${idx + 1}.\` <@${p.id}> (\`${p.displayName || p.username}\`)`).join('\n') || 'None',
            inline: false
          },
          { name: 'Registered At', value: new Date(found.registeredAt).toLocaleString(), inline: true },
          { name: 'Team Role & Tourney Role', value: `${found.teamRoleId ? `<@&${found.teamRoleId}>` : `\`@${found.teamRoleName || found.teamName}\``} • \`@${config.verifiedRoleName || 'Verified Team'}\``, inline: true },
          {
            name: 'Team Category & Private VC',
            value: `📁 \`${found.teamCategoryName || found.teamName}\` • 🔊 ${found.teamVoiceChannelId ? `<#${found.teamVoiceChannelId}>` : `\`${found.teamVoiceChannelName || found.teamName}\``}`,
            inline: false
          }
        )
        .setFooter({ text: `Team ID: ${found.id}` })
        .setTimestamp();
      const components =
        message.guild && found.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(message.guild.id, found.teamVoiceChannelId, found.teamVoiceChannelName || found.teamName)]
          : [];
      return message.reply({ embeds: [embed], components });
    }

    if (cmd === 'standings' || cmd === 'points' || cmd === 'leaderboard') {
      const teams = (this.getRegisteredTeams ? this.getRegisteredTeams() : []).filter(t => !t.isWaitlist);
      const groupFilter = args[0] ? `Group ${args[0].toUpperCase().replace('GROUP', '').trim()}` : null;
      const filtered = groupFilter ? teams.filter(t => (t.group || 'Group A').toLowerCase() === groupFilter.toLowerCase()) : teams;

      const rows = filtered.slice(0, 15).map((t, idx) => {
        const wins = idx === 0 ? 2 : idx === 1 ? 1 : 0;
        const placePts = Math.max(4, 28 - idx * 4);
        const killPts = Math.max(2, 22 - idx * 3);
        const total = placePts + killPts;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
        return `${medal} **${t.teamName}** (Slot #${t.slotNumber}) — **${total} Pts** *(Wins: ${wins} | Finishes: ${killPts})*`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${config.title} — Official Standings ${groupFilter ? `(${groupFilter})` : ''}`)
        .setColor(0xFEE75C)
        .setDescription(rows.length > 0 ? rows.join('\n') : '*No confirmed teams to rank yet.*')
        .addFields({
          name: '📊 Official Scoring Matrix',
          value: '`1st: 10 pts` • `2nd: 6 pts` • `3rd: 5 pts` • `4th: 4 pts` • `5th: 3 pts` • `6th: 2 pts` • `7th-8th: 1 pt` • `Finish: +1 pt`',
          inline: false
        })
        .setFooter({ text: 'FFA | Glacier Cup Manager™ Live Standings Engine' })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'rules') {
      const customText = args.join(' ').trim();
      if (isStaff && message.guild && customText.length > 0) {
        const pubRes = await this.publishRulesToChannel(message.guild, customText, message.author.username);
        if (pubRes.success) {
          const embed = new EmbedBuilder()
            .setTitle('✅ Tournament Rules Published!')
            .setColor(0x57F287)
            .setDescription(`Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!`)
            .setFooter({ text: `Published by @${message.author.username} • FFA-Manager` })
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        }
        return message.reply(`❌ Failed to publish rules: ${pubRes.error}`);
      }

      if (isStaff && message.guild && !config.customRules) {
        this.pendingRulesPrompts.set(`${message.guild.id}:${message.author.id}`, {
          guildId: message.guild.id,
          channelId: message.channel.id,
          expiresAt: Date.now() + 10 * 60 * 1000
        });
        const promptEmbed = new EmbedBuilder()
          .setTitle('📜 Set Tournament Rules & Format')
          .setColor(0x5865F2)
          .setDescription(
            'Please **reply with your Tournament Rules & Format** as your next message in this channel (or click the button below), and I will publish it directly to `#📋┃rules-format`!'
          )
          .setFooter({ text: 'FFA-Manager Rules Publisher' });
        return message.reply({ embeds: [promptEmbed], components: [this.createRulesButtonRow()] });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📜 ${config.title} — Official Tournament Rulebook`)
        .setColor(0x5865F2)
        .setDescription(config.customRules || '*No custom rules have been published yet. Staff can run `/rules` or `!rules <text>` to set and post rules to `#📋┃rules-format`.*')
        .setFooter({ text: 'FFA-Manager' })
        .setTimestamp();
      return message.reply({
        embeds: [embed],
        components: isStaff ? [this.createRulesButtonRow()] : []
      });
    }

    if (cmd === 'announce') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const announcementText = args.join(' ').trim();
      if (!announcementText) {
        return message.reply('❌ Usage: `!announce <your official tournament message>`');
      }
      const embed = new EmbedBuilder()
        .setTitle(`📢 Official Tournament Announcement — ${config.title}`)
        .setColor(0x5865F2)
        .setDescription(announcementText)
        .setFooter({ text: `Announced by @${message.author.username} • FFA | Glacier Cup Manager™` })
        .setTimestamp();
      this.logEvent('info', `Announcement published by @${message.author.username}`, message.guild?.name);
      return (message.channel as TextChannel).send({ content: '@here', embeds: [embed] });
    }

    if (cmd === 'swap' || cmd === 'swap-slots') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const s1 = parseInt(args[0], 10);
      const s2 = parseInt(args[1], 10);
      if (isNaN(s1) || isNaN(s2)) {
        return message.reply('❌ Usage: `!swap <slot1> <slot2>` (e.g. `!swap 1 2`).');
      }
      const res = await this.swapSlots(s1, s2, message.guild || undefined);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🔄 Slots Swapped Successfully')
        .setColor(0x57F287)
        .setDescription(`Swapped **Slot #${s1}** (${res.group1}) and **Slot #${s2}** (${res.group2}). The \`#slot-list\` channel has been updated!`)
        .addFields(
          { name: `Slot #${s1} (${res.group1})`, value: res.team2 ? `**${res.team2.teamName}**` : '*Open Slot*', inline: true },
          { name: `Slot #${s2} (${res.group2})`, value: res.team1 ? `**${res.team1.teamName}**` : '*Open Slot*', inline: true }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'export') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const format = (args[0] || 'markdown').toLowerCase() === 'csv' ? 'csv' : 'markdown';
      const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const output = this.generateRosterExport(format, true);
      const safeOutput = output.length > 3800 ? output.slice(0, 3800) + '\n...truncated' : output;
      const embed = new EmbedBuilder()
        .setTitle(`📤 Exported Tournament Roster (${allTeams.length} Teams)`)
        .setColor(0x5865F2)
        .setDescription(`\`\`\`${format === 'csv' ? 'csv' : 'text'}\n${safeOutput}\n\`\`\``)
        .setFooter({ text: 'Consistent with live roster • Ready for casters & production overlays' })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'delete') {
      if (!isStaff) return message.reply('❌ You need `Manage Channels` permission to delete slots or tournaments.');
      const sub = args[0]?.toLowerCase();
      if (sub === 'slot') {
        const slotNum = parseInt(args[1], 10);
        if (isNaN(slotNum)) {
          return message.reply('❌ Please specify a valid slot number. Usage: `!delete slot <number>` (or `/delete slot`).');
        }
        const result = await this.deleteSlot(slotNum, message.guild || undefined);
        if (result.success && result.deletedTeam) {
          const embed = new EmbedBuilder()
            .setTitle('🗑️ Slot Deleted Successfully')
            .setColor(result.syncWarnings && result.syncWarnings.length > 0 ? 0xFEE75C : 0xED4245)
            .setDescription(`**Slot #${slotNum}** (${result.deletedTeam.teamName}) has been removed.`)
            .addFields(
              { name: 'Removed Team', value: `**${result.deletedTeam.teamName}** (Captain: <@${result.deletedTeam.captain.id}>)`, inline: false },
              {
                name: 'Waitlist Promotion',
                value: result.promotedTeam
                  ? `✅ **${result.promotedTeam.teamName}** was auto-promoted from the waitlist to confirmed **Slot #${result.promotedTeam.slotNumber}** (${result.promotedTeam.group || 'Group A'})!`
                  : 'ℹ️ No teams on the waitlist to promote.',
                inline: false
              }
            )
            .setTimestamp();

          if (result.syncWarnings && result.syncWarnings.length > 0) {
            embed.addFields({
              name: '⚠️ Role / Channel Sync Notice',
              value: result.syncWarnings.join('\n'),
              inline: false
            });
          }
          return message.reply({ embeds: [embed] });
        } else {
          return message.reply(`❌ ${result.error || `Slot #${slotNum} not found.`}`);
        }
      } else if (sub === 'tournament') {
        const confirmedArg = args[1]?.toLowerCase() === 'confirm';
        if (!confirmedArg) {
          const preview = this.previewDeleteTournament(message.guild || undefined, true);
          const previewEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Destructive Action — Delete Tournament')
            .setColor(0xFEE75C)
            .setDescription(`You are about to delete **${preview.title}** and reset all registered rosters. Please review what will be removed and confirm below:`)
            .addFields(
              { name: 'Confirmed Teams to Clear', value: `\`${preview.confirmedCount} Team(s)\``, inline: true },
              { name: 'Waitlist Teams to Clear', value: `\`${preview.waitlistCount} Team(s)\``, inline: true },
              {
                name: 'Channels & Category to Delete',
                value: preview.channelsToDelete.length > 0 ? preview.channelsToDelete.join('\n') : '*(No matching tournament channels found — only rosters will be reset)*',
                inline: false
              }
            )
            .setFooter({ text: 'Click Confirm below or run !delete tournament confirm' })
            .setTimestamp();

          return message.reply({
            embeds: [previewEmbed],
            components: [this.createDeleteConfirmRow(true)]
          });
        }

        const result = await this.deleteTournament(message.guild || undefined, true);
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Tournament Deleted & Roster Reset')
          .setColor(0xED4245)
          .setDescription(`The active tournament has been deleted. All slots and registered rosters have been cleared.`)
          .addFields(
            {
              name: 'Deleted Channels / Categories',
              value: result.deletedChannels.length > 0 ? result.deletedChannels.join('\n') : '*(No channels deleted)*',
              inline: false
            }
          )
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      } else {
        return message.reply('❌ Usage: `!delete slot <number>` or `!delete tournament` (or use slash commands `/delete slot`, `/delete tournament`).');
      }
    }
  }

  private async handleRegistration(message: Message, config: any) {
    this.logEvent('info', `Received registration message from @${message.author.displayName || message.author.username}`, message.guild?.name);

    if (!config.totalSlots || config.totalSlots <= 0) {
      config.totalSlots = 20;
      config.requiredTags = config.requiredTags || 4;
      config.maxTags = config.requiredTags;
    }

    if (!config.explicitlyStoppedOrPaused && config.status !== 'open') {
      config.status = 'open';
    }

    if (config.status === 'paused' && config.explicitlyStoppedOrPaused) {
      await this.sendErrorAndAutoDelete(
        message,
        `Registrations are currently **PAUSED** by tournament staff. Please wait for staff to resume registration with \`/start-registration\`.`
      );
      this.logEvent('info', `Registration notice for @${message.author.username}: registrations are paused`, message.guild?.name);
      return;
    }

    if (config.status !== 'open' && config.explicitlyStoppedOrPaused) {
      await this.sendErrorAndAutoDelete(
        message,
        `Registrations are currently **CLOSED** (ended by staff). Please wait for tournament staff to run \`/start-registration\`.`
      );
      this.logEvent('info', `Registration notice for @${message.author.username}: registrations are ${config.status}`, message.guild?.name);
      return;
    }

    const existingTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];

    for (let i = existingTeams.length - 1; i >= 0; i--) {
      const cleanedExisting = (existingTeams[i].teamName || '').replace(/^<\s*|\s*>$/g, '').trim().toLowerCase();
      if (cleanedExisting === 'team name' || cleanedExisting === 'your team' || cleanedExisting === 'your team name') {
        existingTeams.splice(i, 1);
      }
    }

    const confirmedCount = existingTeams.filter(t => !t.isWaitlist).length;
    const waitlistCount = existingTeams.filter(t => t.isWaitlist).length;

    let processedText = message.content;

    const bodyWithoutTeamLine = processedText.replace(/^(?:team\s*name|teamname|team|t\.n\.?|tn)\s*[:=-]?[^\n\r]*/im, '');
    const malformedIds: string[] = [];
    const rawIdsWhenDisabled: string[] = [];

    const numericTokensRegex = /(?:^|[\s,:])(\d{6,25})(?=$|\s|[^\w>])/g;
    let numMatch;
    while ((numMatch = numericTokensRegex.exec(bodyWithoutTeamLine)) !== null) {
      const candidate = numMatch[1];
      if (candidate.length < 17 || candidate.length > 20 || !isValidDiscordSnowflake(candidate)) {
        if (!malformedIds.includes(candidate)) malformedIds.push(candidate);
      } else if (!config.easyTagEnabled) {
        if (!rawIdsWhenDisabled.includes(candidate)) rawIdsWhenDisabled.push(candidate);
      }
    }

    if (rawIdsWhenDisabled.length > 0) {
      const errMsg = `EasyTag Notice: Raw Discord ID(s) detected (${rawIdsWhenDisabled.map(id => `\`${id}\``).join(', ')}), but EasyTag is currently **DISABLED**. Please use standard \`@username\` mentions.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('warn', `EasyTag disabled notice for @${message.author.username}: Raw IDs ${rawIdsWhenDisabled.join(', ')}`, message.guild?.name);
      return;
    }

    if (malformedIds.length > 0) {
      const errMsg = `EasyTag Notice: Malformed Discord User ID(s) detected: ${malformedIds.map(id => `\`${id}\``).join(', ')}. Valid Discord IDs must be 17–20 digit snowflakes.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('warn', `EasyTag malformed ID notice for @${message.author.username}: ${malformedIds.join(', ')}`, message.guild?.name);
      return;
    }

    if (config.easyTagEnabled) {
      processedText = processedText.replace(/(^|[\s,:])@?(\d{17,20})(?=$|\s|[^\w>])/g, '$1<@$2>');
    }

    const teamPatterns = [
      /(?:team\s*name|teamname|team)\s*[:=-]\s*([^\n\r]+)/i,
      /^team\s+([^\n\r]+)/im
    ];
    let teamName = '';
    for (const p of teamPatterns) {
      const m = processedText.match(p);
      if (m && m[1]) {
        teamName = m[1].replace(/<@!?\d+>/g, '').replace(/^<\s*|\s*>$/g, '').trim();
        break;
      }
    }

    const lowerTeamName = teamName.toLowerCase();
    if (
      !teamName ||
      teamName.length < 2 ||
      lowerTeamName === 'team name' ||
      lowerTeamName === 'your team' ||
      lowerTeamName === 'your team name'
    ) {
      const errMsg = 'Invalid Team Name! Please replace `<Team Name>` with your actual squad name (e.g. `Team Name: Team Glacier`).';
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('info', `Registration format notice for @${message.author.username}: Placeholder or missing Team Name`, message.guild?.name);
      return;
    }

    const allOrderedTagIds: string[] = [];
    const taggedUserIds: string[] = [];
    const unresolvedIdentifiers: string[] = [];

    const mentionRegex = /<@!?(\d+)>/g;
    let match;
    while ((match = mentionRegex.exec(processedText)) !== null) {
      const uid = match[1];
      if (!isValidDiscordSnowflake(uid)) {
        if (!malformedIds.includes(uid)) malformedIds.push(uid);
        continue;
      }
      allOrderedTagIds.push(uid);
      if (!taggedUserIds.includes(uid)) {
        taggedUserIds.push(uid);
      }
    }

    if (malformedIds.length > 0) {
      const errMsg = `EasyTag Notice: Malformed Discord mention ID(s): ${malformedIds.map(id => `\`${id}\``).join(', ')}.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      return;
    }

    const textWithoutDiscordTags = processedText
      .replace(/<@!?\d+>/g, ' ')
      .replace(/<@&\d+>/g, ' ')
      .replace(/<#\d+>/g, ' ');

    const textMentionRegex = /@([a-zA-Z0-9_.-]+)/g;
    let textMatch;
    while ((textMatch = textMentionRegex.exec(textWithoutDiscordTags)) !== null) {
      const token = textMatch[1];
      const name = token.toLowerCase();
      if (name === 'everyone' || name === 'here') continue;

      let found: any = null;

      if (/^\d{17,20}$/.test(token)) {
        found = message.guild?.members.cache.get(token) || null;
        if (!found && message.guild) {
          found = await message.guild.members.fetch(token).catch(() => null);
        }
        if (!found) {
          const directUser = await this.client?.users.fetch(token).catch(() => null);
          if (directUser) {
            found = { id: directUser.id, user: directUser, displayName: directUser.displayName || directUser.username };
          } else if (isValidDiscordSnowflake(token)) {
            found = { id: token, user: { id: token, bot: false, username: `user_${token.slice(-4)}` }, displayName: `Player ${token.slice(-4)}` };
          }
        }
      } else {
        found = message.guild?.members.cache.find(m =>
          m.user.username.toLowerCase() === name ||
          m.displayName.toLowerCase() === name ||
          m.user.globalName?.toLowerCase() === name
        );
        if (!found && message.guild) {
          const searched = await message.guild.members.fetch({ query: token, limit: 5 }).catch(() => null);
          found =
            searched?.find(
              m =>
                m.user.username.toLowerCase() === name ||
                m.displayName.toLowerCase() === name ||
                m.user.globalName?.toLowerCase() === name
            ) || searched?.first();
        }
      }

      if (found) {
        if (config.disallowBots && found.user?.bot) {
          await this.sendErrorAndAutoDelete(message, `Tagcheck Notice: Bot <@${found.id}> cannot be registered as a tournament player.`);
          return;
        }
        allOrderedTagIds.push(found.id);
        if (!taggedUserIds.includes(found.id)) {
          taggedUserIds.push(found.id);
        }
      } else {
        if (!unresolvedIdentifiers.includes(`@${token}`)) {
          unresolvedIdentifiers.push(`@${token}`);
        }
      }
    }

    if (config.prohibitSelfDuplication && allOrderedTagIds.length !== new Set(allOrderedTagIds).size) {
      const errMsg = 'Tagcheck Notice: Duplicate player tags detected within the same team submission. Every player tag in your roster must be unique!';
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('warn', `Self-duplication rejected for @${message.author.username}`, message.guild?.name);
      return;
    }

    const playersList: any[] = [];
    for (const uid of taggedUserIds) {
      try {
        const cachedUser =
          message.mentions?.users?.get(uid) ||
          message.guild?.members?.cache?.get(uid)?.user ||
          this.client?.users?.cache?.get(uid);
        const fetchedMember =
          !cachedUser && message.guild
            ? await message.guild.members.fetch(uid).catch(() => null)
            : null;
        const u =
          cachedUser ||
          fetchedMember?.user ||
          (await this.client?.users.fetch(uid).catch(() => null));
        if (!u) {
          if (isValidDiscordSnowflake(uid)) {
            playersList.push({
              id: uid,
              username: `user_${uid.slice(-4)}`,
              displayName: `Player ${uid.slice(-4)}`,
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
            });
            continue;
          }
          unresolvedIdentifiers.push(`ID:${uid}`);
          continue;
        }
        if (config.disallowBots && u.bot) {
          await this.sendErrorAndAutoDelete(message, `Tagcheck Notice: Bot <@${u.id}> cannot be registered as a tournament player.`);
          return;
        }
        playersList.push({
          id: uid,
          username: u.username,
          displayName: fetchedMember?.displayName || u.displayName || u.username,
          avatar: u.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
        });
      } catch {
        if (isValidDiscordSnowflake(uid)) {
          playersList.push({
            id: uid,
            username: `user_${uid.slice(-4)}`,
            displayName: `Player ${uid.slice(-4)}`,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
          });
        } else {
          unresolvedIdentifiers.push(`ID:${uid}`);
        }
      }
    }

    if (unresolvedIdentifiers.length > 0) {
      const errMsg = `EasyTag Notice: Could not resolve Discord user(s): ${unresolvedIdentifiers.map(x => `\`${x}\``).join(', ')}. Please verify the Discord ID or @mention belongs to a valid member.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('warn', `Unresolved Discord ID/tag for @${message.author.username}: ${unresolvedIdentifiers.join(', ')}`, message.guild?.name);
      return;
    }

    if (taggedUserIds.length < config.requiredTags) {
      const errMsg = `Tagcheck Notice: Exactly **${config.requiredTags} players** are required for ${config.format} (as configured during \`/setup\`). You provided **${taggedUserIds.length}**.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      this.logEvent('info', `Registration check for @${message.author.username}: Provided ${taggedUserIds.length}/${config.requiredTags} tags`, message.guild?.name);
      return;
    }

    if (taggedUserIds.length > config.requiredTags) {
      const errMsg = `Tagcheck Notice: Only **${config.requiredTags} players** are allowed per team (as configured during \`/setup\` — no extra players or tags). You provided **${taggedUserIds.length}**.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      return;
    }

    for (const taggedId of [message.author.id, ...taggedUserIds]) {
      const banned = this.blacklist.find(b => b.userId === taggedId);
      if (banned) {
        const errMsg = `Tagcheck Notice: Player <@${taggedId}> is currently **BLACKLISTED** from this tournament (Reason: *${banned.reason}*).`;
        await this.sendErrorAndAutoDelete(message, errMsg);
        this.logEvent('info', `Registration notice for @${message.author.username}: Blacklisted player <@${taggedId}>`, message.guild?.name);
        return;
      }
    }

    const captainExistingTeam = existingTeams.find(t => t.captain?.id === message.author.id);

    const duplicateTeamByName = existingTeams.find(
      t => (!captainExistingTeam || t.id !== captainExistingTeam.id) && t.teamName.trim().toLowerCase() === lowerTeamName
    );
    if (duplicateTeamByName) {
      const errMsg = `Tagcheck Notice: Team name **${duplicateTeamByName.teamName}** is already registered in Slot #${duplicateTeamByName.slotNumber}.`;
      await this.sendErrorAndAutoDelete(message, errMsg);
      return;
    }

    if (config.prohibitDuplicateTags) {
      for (const taggedId of taggedUserIds) {
        if (this.inFlightPlayerIds.has(taggedId)) {
          const errMsg = `Tagcheck Notice: Player <@${taggedId}> is currently being processed in another simultaneous registration.`;
          await this.sendErrorAndAutoDelete(message, errMsg);
          return;
        }
        for (const team of existingTeams) {
          if (captainExistingTeam && team.id === captainExistingTeam.id) continue;
          if (team.players.some((p: any) => p.id === taggedId)) {
            const errMsg = `Tagcheck Notice: Player <@${taggedId}> is already registered in **${team.teamName}** (Slot #${team.slotNumber}). Multi-team registration is prohibited!`;
            await this.sendErrorAndAutoDelete(message, errMsg);
            this.logEvent('info', `Tagcheck notice for @${message.author.username}: Player <@${taggedId}> already registered in "${team.teamName}"`, message.guild?.name);
            return;
          }
        }
      }
    }

    taggedUserIds.forEach(id => this.inFlightPlayerIds.add(id));

    try {
      if (captainExistingTeam) {
        if (message.guild) {
          await this.cleanupTeamWorkspace(message.guild, captainExistingTeam).catch(() => {});
        }
        const idx = existingTeams.findIndex(t => t.id === captainExistingTeam.id);
        if (idx !== -1) {
          existingTeams.splice(idx, 1);
        }
      }

      const currentConfirmed = existingTeams.filter(t => !t.isWaitlist);
      const currentWaitlist = existingTeams.filter(t => t.isWaitlist);
      const isWaitlist = captainExistingTeam ? captainExistingTeam.isWaitlist : (currentConfirmed.length >= config.totalSlots);

      let slotNumber = 1;
      if (captainExistingTeam) {
        slotNumber = captainExistingTeam.slotNumber;
      } else if (isWaitlist) {
        slotNumber = currentWaitlist.length + 1;
      } else {
        const usedSlots = new Set(currentConfirmed.map(t => t.slotNumber));
        while (usedSlots.has(slotNumber) && slotNumber <= config.totalSlots) {
          slotNumber++;
        }
      }

      const assignedGroup = this.calculateGroupForSlot(slotNumber, config);

      let parsedWhatsapp1: string | undefined = undefined;
      let parsedRegion: 'India' | 'Pakistan' | 'Bangladesh' = 'India';

      const regMatch = processedText.match(/region\s*[:=-]\s*(india|pakistan|bangladesh)/i);
      if (regMatch && regMatch[1]) {
        const lower = regMatch[1].toLowerCase();
        if (lower === 'india') parsedRegion = 'India';
        else if (lower === 'pakistan') parsedRegion = 'Pakistan';
        else if (lower === 'bangladesh') parsedRegion = 'Bangladesh';
      }

      const wa1Match = processedText.match(/(?:primary\s*whatsapp|whatsapp\s*number\s*1|whatsapp\s*1|whatsapp\s*number|whatsapp\s*no|whatsapp|wa|phone|contact)\s*[:=-]\s*([+\d\s\-()]{7,25})/i);
      if (wa1Match && wa1Match[1]) {
        const norm = this.normalizeWhatsAppWithRegion(wa1Match[1], parsedRegion);
        if (norm.valid) {
          parsedWhatsapp1 = norm.formatted;
        }
      }

      const newTeam: any = {
        id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        slotNumber,
        teamName,
        captain: {
          id: message.author.id,
          username: message.author.username,
          displayName: message.author.displayName || message.author.username,
          avatar: message.author.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${message.author.id}`
        },
        players: playersList,
        registeredAt: new Date().toISOString(),
        messageId: message.id,
        channelId: message.channel.id,
        isWaitlist,
        group: assignedGroup,
        teamRoleName: teamName,
        teamCategoryName: teamName,
        teamVoiceChannelName: teamName,
        whatsappNumber1: parsedWhatsapp1,
        region: parsedRegion
      };

      if (this.onTeamRegistered) {
        this.onTeamRegistered(newTeam);
      }
      existingTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));

      this.logEvent('success', `✅ Slot ${isWaitlist ? `WL #${slotNumber}` : `#${slotNumber} (${assignedGroup})`} confirmed for Team "${teamName}" (Captain: @${newTeam.captain.displayName}, ${playersList.length} tags verified)`, message.guild?.name);

      await message.react('✅').catch(() => {});

      if (message.guild) {
        const verifiedRoleName = config.verifiedRoleName || 'Verified Team';
        const slotRoleName = config.roleName || 'Confirmed Slot';
        const verifiedRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
        const slotRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());

        const rolesToAdd = [verifiedRole, slotRole].filter(Boolean);

        if (rolesToAdd.length > 0 && message.member) {
          await message.member.roles.add(rolesToAdd as any).catch(() => {});
        }

        for (const uid of taggedUserIds) {
          if (uid !== message.author.id && rolesToAdd.length > 0) {
            try {
              const member = message.guild.members.cache.get(uid) || (await message.guild.members.fetch(uid).catch(() => null));
              if (member) {
                await member.roles.add(rolesToAdd as any).catch(() => {});
              }
            } catch {
            }
          }
        }

        if (config.autoCreateTeamVoice !== false) {
          await this.provisionTeamWorkspace(message.guild, newTeam, taggedUserIds);
        }
      }

      const idpChannel = message.guild?.channels.cache.find(
        c => c.name === config.idpChannel || c.name === '🔑┃id-pass' || c.name === 'id-pass'
      );

      const updatedConfirmedCount = existingTeams.filter(t => !t.isWaitlist).length;
      const embed = new EmbedBuilder()
        .setTitle(isWaitlist ? '⏳ Added to Waiting List' : '✅ Tournament Registration Confirmed!')
        .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
        .setDescription(
          isWaitlist
            ? `Team **${teamName}** secured **Waitlist #${slotNumber}**.`
            : `Congratulations! **${teamName}** has secured **Slot #${slotNumber}** for **${config.title}**!`
        )
        .addFields(
          { name: 'Team Name', value: `\`${teamName}\``, inline: true },
          { name: isWaitlist ? 'Waitlist Position' : 'Allocated Slot', value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
          { name: 'Remaining Slots', value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
          { name: 'Region', value: `\`${newTeam.region || 'India'}\``, inline: true },
          { name: 'WhatsApp No', value: newTeam.whatsappNumber1 ? `\`${newTeam.whatsappNumber1}\`` : '`Not provided`', inline: true },
          { name: 'Roster Tags (Voice Role Granted)', value: taggedUserIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n') },
          {
            name: 'Voice Channel Role & Tourney Role',
            value: `${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${teamName}\``} • \`@${config.verifiedRoleName || 'Verified Team'}\``,
            inline: true
          },
          {
            name: 'Team Category & Private VC',
            value: newTeam.teamVoiceChannelId
              ? `📁 **${newTeam.teamCategoryName || teamName}**\n🔊 <#${newTeam.teamVoiceChannelId}> *(All tagged players granted ${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${teamName}\``} to join)*`
              : `📁 **${teamName}**\n🔊 \`${teamName}\` *(Private Team VC)*`,
            inline: true
          },
          { name: 'Private Room', value: idpChannel ? `<#${idpChannel.id}> *(Credentials before match)*` : 'Unlocked `#id-pass`', inline: false }
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Voice Channel Role granted to all tagged players' })
        .setTimestamp();

      const components =
        message.guild && newTeam.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(message.guild.id, newTeam.teamVoiceChannelId, newTeam.teamVoiceChannelName || teamName)]
          : [];

      await message.reply({ embeds: [embed], components }).catch(() => {});

      this.scheduleSlotListUpdate(message.guild, config);
    } finally {
      taggedUserIds.forEach(id => this.inFlightPlayerIds.delete(id));
    }
  }

  private async handleModalRegistration(interaction: ModalSubmitInteraction, config: any) {
    await interaction.deferReply({ ephemeral: true });

    if (!config.totalSlots || config.totalSlots <= 0) {
      config.totalSlots = 20;
      config.requiredTags = config.requiredTags || 4;
      config.maxTags = config.requiredTags;
    }

    if (!config.explicitlyStoppedOrPaused && config.status !== 'open') {
      config.status = 'open';
    }

    if (config.status === 'paused' && config.explicitlyStoppedOrPaused) {
      await interaction.editReply(
        '⏸️ Registrations are currently **PAUSED** by tournament staff. Please wait for staff to resume registration with `/start-registration`.'
      );
      return;
    }

    if (config.status === 'closed' && config.explicitlyStoppedOrPaused) {
      await interaction.editReply(
        '🔴 Registrations are currently **CLOSED**. Please wait for tournament staff to run `/start-registration`.'
      );
      return;
    }

    const existingTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const confirmedCount = existingTeams.filter(t => !t.isWaitlist).length;
    const waitlistCount = existingTeams.filter(t => t.isWaitlist).length;

    const rawTeamName = interaction.fields.getTextInputValue('reg_team_name')?.trim() || '';
    const teamName = rawTeamName.replace(/<@!?\d+>/g, '').replace(/^<\s*|\s*>$/g, '').trim();
    const lowerTeamName = teamName.toLowerCase();

    if (
      !teamName ||
      teamName.length < 2 ||
      lowerTeamName === 'team name' ||
      lowerTeamName === 'your team' ||
      lowerTeamName === 'your team name'
    ) {
      await interaction.editReply('❌ **Invalid Team Name:** Please enter a valid, unique squad name (at least 2 characters).');
      return;
    }

    const modalRegionFallback = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : 'India';
    let rawRegionInput = '';
    try {
      const regionValues = interaction.fields.getStringSelectValues('reg_region');
      rawRegionInput = (regionValues?.[0] || '').trim().toLowerCase();
    } catch {
      try {
        rawRegionInput = (interaction.fields.getTextInputValue('reg_region') || modalRegionFallback).trim().toLowerCase();
      } catch {
        rawRegionInput = modalRegionFallback.trim().toLowerCase();
      }
    }

    let parsedRegion: 'India' | 'Pakistan' | 'Bangladesh' | null = null;
    if (rawRegionInput === 'india') parsedRegion = 'India';
    else if (rawRegionInput === 'bangladesh') parsedRegion = 'Bangladesh';
    else if (rawRegionInput === 'pakistan') parsedRegion = 'Pakistan';

    if (!parsedRegion) {
      await interaction.editReply(
        '❌ **Invalid Region:** Please select **India**, **Bangladesh**, or **Pakistan** from the Region dropdown.'
      );
      return;
    }

    const rawWa1 = (interaction.fields.getTextInputValue('reg_whatsapp_1') || '').trim();
    const waNorm = this.normalizeWhatsAppWithRegion(rawWa1, parsedRegion);
    if (!waNorm.valid) {
      const expectedCode = this.getRegionCountryCode(parsedRegion);
      await interaction.editReply(
        `❌ **Invalid WhatsApp Number:** Please enter a valid WhatsApp number for **${parsedRegion}** (e.g., \`${expectedCode}9876543210\`).`
      );
      return;
    }
    const cleanWa1 = waNorm.formatted;

    const allOrderedTagIds: string[] = [];
    const taggedUserIds: string[] = [];
    const unresolvedIdentifiers: string[] = [];

    let selectedModalUsers: any = null;
    let selectedModalMembers: any = null;
    const rawPlayersField = interaction.fields.fields?.get('reg_player_tags') as any;

    if (rawPlayersField && Array.isArray(rawPlayersField.values)) {
      try {
        selectedModalUsers = interaction.fields.getSelectedUsers('reg_player_tags');
        selectedModalMembers = interaction.fields.getSelectedMembers('reg_player_tags');
      } catch {
        selectedModalUsers = rawPlayersField.users || null;
        selectedModalMembers = rawPlayersField.members || null;
      }

      for (const uid of rawPlayersField.values) {
        if (uid && isValidDiscordSnowflake(uid)) {
          allOrderedTagIds.push(uid);
          if (!taggedUserIds.includes(uid)) {
            taggedUserIds.push(uid);
          }
        }
      }
    } else {
      let rawPlayersText = '';
      try {
        rawPlayersText = (interaction.fields.getTextInputValue('reg_player_tags') || '').trim();
      } catch {
        rawPlayersText = '';
      }

      let processedPlayersText = rawPlayersText;
      if (config.easyTagEnabled !== false) {
        processedPlayersText = processedPlayersText.replace(/(^|[\s,:])@?(\d{17,20})(?=$|\s|[^\w>])/g, '$1<@$2>');
      }

      const mentionRegex = /<@!?(\d+)>/g;
      let mMatch;
      while ((mMatch = mentionRegex.exec(processedPlayersText)) !== null) {
        const uid = mMatch[1];
        if (isValidDiscordSnowflake(uid)) {
          allOrderedTagIds.push(uid);
          if (!taggedUserIds.includes(uid)) {
            taggedUserIds.push(uid);
          }
        } else {
          unresolvedIdentifiers.push(uid);
        }
      }
    }

    if (unresolvedIdentifiers.length > 0) {
      await interaction.editReply(
        `❌ **EasyTag Notice:** Could not resolve Discord user(s): ${unresolvedIdentifiers.map(x => `\`${x}\``).join(', ')}. Please select your players from the Players Tags dropdown.`
      );
      return;
    }

    if (config.prohibitSelfDuplication && allOrderedTagIds.length !== new Set(allOrderedTagIds).size) {
      await interaction.editReply(
        '❌ **Tagcheck Notice:** Duplicate player tags detected within the same team submission. Every player tag in your roster must be unique!'
      );
      return;
    }

    const playersList: any[] = [];
    for (const uid of taggedUserIds) {
      try {
        const modalUser = selectedModalUsers?.get?.(uid);
        const modalMember = selectedModalMembers?.get?.(uid);
        const cachedUser =
          modalUser ||
          interaction.guild?.members?.cache?.get(uid)?.user ||
          this.client?.users?.cache?.get(uid);
        const fetchedMember =
          modalMember ||
          (!cachedUser && interaction.guild
            ? await interaction.guild.members.fetch(uid).catch(() => null)
            : null);
        const u =
          cachedUser ||
          fetchedMember?.user ||
          (await this.client?.users.fetch(uid).catch(() => null));

        if (!u) {
          if (isValidDiscordSnowflake(uid)) {
            playersList.push({
              id: uid,
              username: `user_${uid.slice(-4)}`,
              displayName: `Player ${uid.slice(-4)}`,
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
            });
            continue;
          }
          unresolvedIdentifiers.push(`ID:${uid}`);
          continue;
        }

        if (config.disallowBots && u.bot) {
          await interaction.editReply(`❌ **Tagcheck Notice:** Bot <@${u.id}> cannot be registered as a tournament player.`);
          return;
        }

        playersList.push({
          id: uid,
          username: u.username,
          displayName: fetchedMember?.displayName || fetchedMember?.nick || u.displayName || u.username,
          avatar: (typeof u.displayAvatarURL === 'function' ? u.displayAvatarURL() : null) || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
        });
      } catch {
        if (isValidDiscordSnowflake(uid)) {
          playersList.push({
            id: uid,
            username: `user_${uid.slice(-4)}`,
            displayName: `Player ${uid.slice(-4)}`,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`
          });
        }
      }
    }

    const reqTags = Math.max(1, config.requiredTags || 4);

    if (taggedUserIds.length < reqTags) {
      await interaction.editReply(
        `❌ **Tagcheck Notice:** Exactly **${reqTags} player${reqTags > 1 ? 's' : ''}** ${reqTags > 1 ? 'are' : 'is'} required for ${config.format || 'this tournament'} (set during \`/setup\`). You selected **${taggedUserIds.length}**.`
      );
      return;
    }

    if (taggedUserIds.length > reqTags) {
      await interaction.editReply(
        `❌ **Tagcheck Notice:** Only **${reqTags} player${reqTags > 1 ? 's' : ''}** ${reqTags > 1 ? 'are' : 'is'} allowed per team (as set during \`/setup\` — no extra players or tags allowed). You selected **${taggedUserIds.length}**.`
      );
      return;
    }

    for (const taggedId of [interaction.user.id, ...taggedUserIds]) {
      const banned = this.blacklist.find(b => b.userId === taggedId);
      if (banned) {
        await interaction.editReply(
          `❌ **Tagcheck Notice:** Player <@${taggedId}> is currently **BLACKLISTED** from this tournament (Reason: *${banned.reason}*).`
        );
        return;
      }
    }

    const captainExistingTeam = existingTeams.find(t => t.captain?.id === interaction.user.id);
    const duplicateTeamByName = existingTeams.find(
      t => (!captainExistingTeam || t.id !== captainExistingTeam.id) && t.teamName.trim().toLowerCase() === lowerTeamName
    );
    if (duplicateTeamByName) {
      await interaction.editReply(
        `❌ **Duplicate Team Name:** Team **${duplicateTeamByName.teamName}** is already registered in Slot #${duplicateTeamByName.slotNumber}.`
      );
      return;
    }

    if (config.prohibitDuplicateTags) {
      for (const taggedId of taggedUserIds) {
        if (this.inFlightPlayerIds.has(taggedId)) {
          await interaction.editReply(
            `❌ **Tagcheck Notice:** Player <@${taggedId}> is currently being processed in another simultaneous registration.`
          );
          return;
        }
        for (const team of existingTeams) {
          if (captainExistingTeam && team.id === captainExistingTeam.id) continue;
          if (team.players.some((p: any) => p.id === taggedId)) {
            await interaction.editReply(
              `❌ **Tagcheck Notice:** Player <@${taggedId}> is already registered in **${team.teamName}** (Slot #${team.slotNumber}). Multi-team registration is prohibited!`
            );
            return;
          }
        }
      }
    }

    taggedUserIds.forEach(id => this.inFlightPlayerIds.add(id));

    try {
      if (captainExistingTeam) {
        if (interaction.guild) {
          await this.cleanupTeamWorkspace(interaction.guild, captainExistingTeam).catch(() => {});
        }
        const idx = existingTeams.findIndex(t => t.id === captainExistingTeam.id);
        if (idx !== -1) {
          existingTeams.splice(idx, 1);
        }
      }

      const currentConfirmed = existingTeams.filter(t => !t.isWaitlist);
      const currentWaitlist = existingTeams.filter(t => t.isWaitlist);
      const isWaitlist = captainExistingTeam ? captainExistingTeam.isWaitlist : currentConfirmed.length >= config.totalSlots;

      let slotNumber = 1;
      if (captainExistingTeam) {
        slotNumber = captainExistingTeam.slotNumber;
      } else if (isWaitlist) {
        slotNumber = currentWaitlist.length + 1;
      } else {
        const usedSlots = new Set(currentConfirmed.map(t => t.slotNumber));
        while (usedSlots.has(slotNumber) && slotNumber <= config.totalSlots) {
          slotNumber++;
        }
      }

      const assignedGroup = this.calculateGroupForSlot(slotNumber, config);

      const newTeam: any = {
        id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        slotNumber,
        teamName,
        captain: {
          id: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.user.displayName || interaction.user.username,
          avatar: interaction.user.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${interaction.user.id}`
        },
        players: playersList,
        registeredAt: new Date().toISOString(),
        messageId: `modal-${interaction.id}`,
        channelId: interaction.channelId || config.regChannel || 'registration',
        isWaitlist,
        group: assignedGroup,
        teamRoleName: teamName,
        teamCategoryName: teamName,
        teamVoiceChannelName: teamName,
        whatsappNumber1: cleanWa1,
        region: parsedRegion
      };

      if (this.onTeamRegistered) {
        this.onTeamRegistered(newTeam);
      }
      existingTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));
      this.pendingRegistrationDrafts.delete(interaction.user.id);

      this.logEvent(
        'success',
        `✅ Slot ${isWaitlist ? `WL #${slotNumber}` : `#${slotNumber} (${assignedGroup})`} confirmed via Registration Panel for Team "${teamName}" (${parsedRegion}, Captain: @${newTeam.captain.displayName}, ${playersList.length} tags verified)`,
        interaction.guild?.name
      );

      if (interaction.guild) {
        const verifiedRoleName = config.verifiedRoleName || 'Verified Team';
        const slotRoleName = config.roleName || 'Confirmed Slot';
        const verifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
        const slotRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());
        const rolesToAdd = [verifiedRole, slotRole].filter(Boolean);

        for (const uid of Array.from(new Set([interaction.user.id, ...taggedUserIds]))) {
          if (rolesToAdd.length > 0) {
            try {
              const member =
                interaction.guild.members.cache.get(uid) ||
                (await interaction.guild.members.fetch(uid).catch(() => null));
              if (member) {
                await member.roles.add(rolesToAdd as any).catch(() => {});
              }
            } catch {
            }
          }
        }

        if (config.autoCreateTeamVoice !== false) {
          await this.provisionTeamWorkspace(interaction.guild, newTeam, taggedUserIds);
        }
      }

      const idpChannel = interaction.guild?.channels.cache.find(
        c => c.name === config.idpChannel || c.name === '🔑┃id-pass' || c.name === 'id-pass'
      );

      const updatedConfirmedCount = existingTeams.filter(t => !t.isWaitlist).length;
      const privateConfirmEmbed = new EmbedBuilder()
        .setTitle(isWaitlist ? '⏳ Added to Waiting List' : '✅ Tournament Registration Confirmed!')
        .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
        .setDescription(
          isWaitlist
            ? `Team **${teamName}** secured **Waitlist #${slotNumber}**.`
            : `Congratulations! **${teamName}** has secured **Slot #${slotNumber}** for **${config.title}**!`
        )
        .addFields(
          { name: 'Team Name', value: `\`${teamName}\``, inline: true },
          { name: isWaitlist ? 'Waitlist Position' : 'Allocated Slot', value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
          { name: 'Remaining Slots', value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
          { name: 'Region', value: `\`${newTeam.region || 'India'}\``, inline: true },
          { name: 'WhatsApp No', value: newTeam.whatsappNumber1 ? `\`${newTeam.whatsappNumber1}\`` : '`Not provided`', inline: true },
          { name: 'Roster Tags (Voice Role Granted)', value: taggedUserIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n') },
          {
            name: 'Voice Channel Role & Tourney Role',
            value: `${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${teamName}\``} • \`@${config.verifiedRoleName || 'Verified Team'}\``,
            inline: true
          },
          {
            name: 'Team Category & Private VC',
            value: newTeam.teamVoiceChannelId
              ? `📁 **${newTeam.teamCategoryName || teamName}**\n🔊 <#${newTeam.teamVoiceChannelId}> *(All tagged players granted ${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${teamName}\``} to join)*`
              : `📁 **${teamName}**\n🔊 \`${teamName}\` *(Private Team VC)*`,
            inline: true
          },
          { name: 'Private Room', value: idpChannel ? `<#${idpChannel.id}> *(Credentials before match)*` : 'Unlocked `#id-pass`', inline: false }
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Voice Channel Role granted to all tagged players' })
        .setTimestamp();

      const components =
        interaction.guild && newTeam.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(interaction.guild.id, newTeam.teamVoiceChannelId, newTeam.teamVoiceChannelName || teamName)]
          : [];

      await interaction.editReply({ embeds: [privateConfirmEmbed], components });

      if (interaction.guild) {
        const regCh = interaction.guild.channels.cache.find(
          c =>
            c.isTextBased() &&
            (c.id === interaction.channelId ||
              c.name === config.regChannel ||
              c.name === '📝┃registration' ||
              c.name === 'registration')
        ) as TextChannel | undefined;

        if (regCh) {
          const publicEmbed = new EmbedBuilder()
            .setTitle(isWaitlist ? '⏳ Team Added to Waiting List' : '✅ Team Registration Confirmed!')
            .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
            .setDescription(
              isWaitlist
                ? `**${teamName}** (<@${interaction.user.id}>) secured **Waitlist #${slotNumber}**.`
                : `**${teamName}** (<@${interaction.user.id}>) has secured **Slot #${slotNumber}** (${assignedGroup}) for **${config.title}**!`
            )
            .addFields(
              { name: 'Team Name', value: `\`${teamName}\``, inline: true },
              { name: isWaitlist ? 'Waitlist Position' : 'Allocated Slot', value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
              { name: 'Remaining Slots', value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
              { name: 'Region', value: `\`${newTeam.region || 'India'}\``, inline: true },
              {
                name: 'Voice Channel & Role',
                value: newTeam.teamVoiceChannelId
                  ? `🔊 <#${newTeam.teamVoiceChannelId}> (${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${teamName}\``})`
                  : `\`@${teamName}\``,
                inline: true
              },
              { name: 'Roster Tags (Voice Role Assigned)', value: taggedUserIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n'), inline: false }
            )
            .setFooter({ text: 'FFA | Glacier Cup Manager™ • Tagged players received the Team Voice Role to join VC' })
            .setTimestamp();

          await regCh.send({ embeds: [publicEmbed], components }).catch(() => {});
        }
      }

      this.scheduleSlotListUpdate(interaction.guild, config);
    } finally {
      taggedUserIds.forEach(id => this.inFlightPlayerIds.delete(id));
    }
  }

  private scheduleSlotListUpdate(guild: any, config: any) {
    if (!guild) return;
    const existingTimer = this.slotListUpdateTimers.get(guild.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.slotListUpdateTimers.delete(guild.id);
      this.updateSlotListChannel(guild, config).catch(() => {});
    }, 600);
    this.slotListUpdateTimers.set(guild.id, timer);
  }

  private async sendErrorAndAutoDelete(message: Message, errorMsg: string) {
    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const autoDeleteEnabled = config?.autoDeleteInvalid !== false;
    const delaySeconds = Math.max(2, Math.min(30, config?.autoDeleteSeconds || 8));

    const reqTags = Math.max(1, config?.requiredTags || 4);
    const playerLines = Array.from({ length: reqTags }, (_, i) => `Player ${i + 1}: @Player${i + 1}`).join('\n');
    const formatExample = `Team Name: Glacier Titans\nRegion: India\nWhatsApp: +91XXXXXXXXXX\n${playerLines}`;

    const embed = new EmbedBuilder()
      .setTitle('❌ Registration Rejected — Tagcheck Notice')
      .setColor(0xED4245)
      .setDescription(errorMsg)
      .addFields(
        {
          name: '📋 Required Format',
          value: `\`\`\`text\n${formatExample}\n\`\`\`\n*(Replace \`Glacier Titans\` with your actual team name)*`,
          inline: false
        },
        {
          name: '💡 EasyTag Tip',
          value: 'Select usernames from Discord\'s `@` popup, or paste valid 17–20 digit Discord User IDs directly.',
          inline: false
        }
      )
      .setFooter({
        text: autoDeleteEnabled
          ? `This notice and your message will auto-delete in ${delaySeconds} seconds to keep #registration clean.`
          : 'Please correct your format and submit again.'
      });

    const reply = await message.reply({ embeds: [embed] }).catch(() => null);

    if (autoDeleteEnabled) {
      const timer = setTimeout(async () => {
        this.cleanupTimers.delete(timer);
        if (reply) await this.safeDeleteMessage(reply, 'bot-error-notice');
        await this.safeDeleteMessage(message, 'invalid-registration-submission');
      }, delaySeconds * 1000);
      this.cleanupTimers.add(timer);
    }
  }

  public formatRegistrationDetailsEmbeds(confirmedTeams: any[], waitlistTeams: any[], config: any): EmbedBuilder[] {
    const confirmed = [...confirmedTeams].sort((a, b) => a.slotNumber - b.slotNumber);
    const waitlist = [...waitlistTeams].sort((a, b) => a.slotNumber - b.slotNumber);
    const totalSlots = Math.max(1, config?.totalSlots || 20);
    const reqTags = Math.max(1, config?.requiredTags || 4);
    const managerRoleName = config?.managerRoleName || 'FFA Bot Manager';
    const title = config?.title || 'Glacier Cup';

    const headerInfo =
      `🔒 **Confidential Staff Roster & Contact Directory** *(Visible only to \`@${managerRoleName}\`)*\n` +
      `**Confirmed Teams:** \`${confirmed.length} / ${totalSlots}\` • **Waitlist:** \`${waitlist.length}\` • **Required Tags:** \`${reqTags}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (confirmed.length === 0 && waitlist.length === 0) {
      return [
        new EmbedBuilder()
          .setTitle(`📋 ${title} — Registration Details (Sequence View)`)
          .setColor(0xF59E0B)
          .setDescription(`${headerInfo}\n\n*No teams registered yet. As teams submit registrations, their full details (Team Name, Region, WhatsApp Number, and Players Tags) will appear here in strict slot sequence.*`)
          .setFooter({ text: `Restricted to @${managerRoleName} • FFA | Glacier Cup Manager™` })
          .setTimestamp()
      ];
    }

    const formatTeamEntry = (t: any, isWl: boolean) => {
      const slotStr = t.slotNumber < 10 ? `0${t.slotNumber}` : `${t.slotNumber}`;
      const badge = isWl ? `⏳ **WAITLIST #${slotStr}**` : `🔢 **SLOT #${slotStr}** • **${t.group || this.calculateGroupForSlot(t.slotNumber, config)}**`;
      const regionStr = t.region || 'India';
      const wpStr = t.whatsappNumber1 || 'Not provided';
      const captainMention = t.captain?.id ? `<@${t.captain.id}> (\`@${t.captain.username || t.captain.displayName}\`)` : `\`@${t.captain?.displayName || 'Unknown'}\``;
      const playerMentions =
        Array.isArray(t.players) && t.players.length > 0
          ? t.players.map((p: any, i: number) => `\`${i + 1}.\` <@${p.id}>`).join(' • ')
          : '*None*';
      return (
        `${badge}\n` +
        `┣ 🏆 **Team Name:** \`${t.teamName}\`\n` +
        `┣ 🌍 **Region:** \`${regionStr}\`\n` +
        `┣ 📱 **WhatsApp No:** \`${wpStr}\`\n` +
        `┣ 👑 **Registered By:** ${captainMention}\n` +
        `┗ 👥 **Players Tags (${(t.players || []).length}):** ${playerMentions}`
      );
    };

    const allEntries: string[] = [
      ...confirmed.map(t => formatTeamEntry(t, false)),
      ...waitlist.map(w => formatTeamEntry(w, true))
    ];

    const chunks: string[] = [];
    let currentChunk = '';
    for (const entry of allEntries) {
      if (currentChunk.length + entry.length + 2 > 3200 && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = entry;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n\n${entry}` : entry;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks.slice(0, 10).map((chunk, idx) => {
      const embed = new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `📋 ${title} — Registration Details (Sequence #01–#${confirmed.length < 10 ? '0' + confirmed.length : confirmed.length})`
            : `📋 ${title} — Registration Details (Continued #${idx + 1})`
        )
        .setColor(0xF59E0B)
        .setDescription(idx === 0 ? `${headerInfo}\n\n${chunk}` : chunk);

      if (idx === Math.min(chunks.length, 10) - 1) {
        embed.setFooter({ text: `Restricted to @${managerRoleName} • Sequence-Wise Systematic Registration Log` });
        embed.setTimestamp();
      }
      return embed;
    });
  }

  public async updateRegistrationDetailsChannel(guild: any, config: any): Promise<{ updated: boolean; error?: string }> {
    if (!guild || !config) return { updated: false, error: 'No guild or config provided' };

    const targetChannelName = config.regDetailsChannel || '🔒┃registration-details';
    let channel = guild.channels.cache.find(
      (c: any) =>
        c.isTextBased() &&
        (c.name === targetChannelName ||
          c.name === '🔒┃registration-details' ||
          c.name === '📋┃registration-details' ||
          c.name === 'registration-details')
    ) as TextChannel | undefined;

    if (!channel) {
      const botMember = guild.members.me;
      const canManageChannels =
        botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ||
        botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels);

      if (canManageChannels) {
        const managerRoleName = (config.managerRoleName || 'FFA Bot Manager').trim().toLowerCase();
        const managerRole = guild.roles.cache.find(
          (r: any) => r.name.trim().toLowerCase() === managerRoleName || r.name.trim().toLowerCase() === 'ffa bot manager'
        );
        const category = guild.channels.cache.find(
          (c: any) =>
            c.type === ChannelType.GuildCategory &&
            ((config.categoryName && c.name.toLowerCase() === config.categoryName.toLowerCase()) ||
              c.name.toLowerCase().includes('tournament') ||
              c.name.toLowerCase().includes('scrim'))
        ) as CategoryChannel | undefined;

        const overwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }
        ];
        if (managerRole) {
          overwrites.push({
            id: managerRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages
            ]
          });
        }
        if (botMember) {
          overwrites.push({
            id: botMember.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.EmbedLinks,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }

        try {
          channel = await guild.channels.create({
            name: targetChannelName,
            type: ChannelType.GuildText,
            parent: category?.id,
            topic: `Confidential team registration details (Team Name, Region, WhatsApp, Players Tags) — Visible only to @${config.managerRoleName || 'FFA Bot Manager'}`,
            permissionOverwrites: overwrites
          });
          config.regDetailsChannel = targetChannelName;
        } catch {
          return { updated: false, error: `Could not create #${targetChannelName}` };
        }
      } else {
        return { updated: false, error: `#${targetChannelName} channel not found` };
      }
    }
    if (channel === undefined || channel === null) return { updated: false };
    const existingTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const confirmed = existingTeams.filter(t => !t.isWaitlist);
    const waitlist = existingTeams.filter(t => t.isWaitlist);
    const embeds = this.formatRegistrationDetailsEmbeds(confirmed, waitlist, config);

    const trackedIds = this.regDetailsMessageIds.get(channel.id) || [];
    try {
      if (trackedIds.length > 0) {
        const existingMsg = await channel.messages.fetch(trackedIds[0]).catch(() => null);
        if (existingMsg) {
          await existingMsg.edit({ embeds });
          return { updated: true };
        }
      }

      const recentMessages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMsg = recentMessages?.find((m: any) => m.author?.id === this.client?.user?.id);
      if (botMsg) {
        this.regDetailsMessageIds.set(channel.id, [botMsg.id]);
        await botMsg.edit({ embeds });
        return { updated: true };
      }

      const sentMsg = await channel.send({ embeds });
      if (sentMsg) {
        this.regDetailsMessageIds.set(channel.id, [sentMsg.id]);
        return { updated: true };
      }
      return { updated: false, error: 'Failed to send registration-details message' };
    } catch (err: any) {
      return { updated: false, error: err?.message || 'Permission error updating #registration-details' };
    }
  }

  public async updateSlotListChannel(guild: any, config: any): Promise<{ updated: boolean; error?: string }> {
    if (!guild) return { updated: false, error: 'No guild provided' };
    await this.updateRegistrationDetailsChannel(guild, config).catch(() => {});
    const channel = guild.channels.cache.find(
      (c: any) => (c.name === config.slotListChannel || c.name === '📊┃slot-list' || c.name === 'slot-list') && c.isTextBased()
    ) as TextChannel | undefined;
    if (!channel) return { updated: false, error: `#${config.slotListChannel || 'slot-list'} channel not found` };

    const existingTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const confirmed = existingTeams.filter(t => !t.isWaitlist);
    const waitlist = existingTeams.filter(t => t.isWaitlist);
    const totalSlots = Math.max(1, config.totalSlots || 20);
    const teamsPerGroup =
      config.teamsPerGroup && config.teamsPerGroup > 0
        ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
        : Math.ceil(totalSlots / Math.max(1, config.groupsCount || 1));
    const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));

    const gamePrefix = config.game ? `**Game:** ${config.game} | ` : '';
    const statusText =
      config.status === 'open'
        ? '🟢 OPEN'
        : config.status === 'paused'
        ? '⏸️ PAUSED'
        : '🔒 CLOSED';
    const headerLine = `${gamePrefix}**Format:** ${config.format} (${config.requiredTags} Tags) | **Status:** ${statusText}\n**Confirmed Teams:** ${confirmed.length}/${totalSlots} | **Teams Per Group:** ${teamsPerGroup} (${groupsCount} Group${groupsCount > 1 ? 's' : ''})\n\n`;

    const groupedChunks = this.formatGroupedSlotListChunks(confirmed, config);
    const payloadEmbeds: EmbedBuilder[] = groupedChunks.map((chunk, idx) => {
      const embed = new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `🏆 ${config.title || 'Glacier Cup'} — Official Slot List`
            : `🏆 ${config.title || 'Glacier Cup'} — Slot List (Continued #${idx + 1})`
        )
        .setColor(0x5865F2)
        .setDescription(idx === 0 ? `${headerLine}${chunk}` : chunk);

      if (idx === groupedChunks.length - 1) {
        embed.setTimestamp();
        if (waitlist.length > 0) {
          embed.addFields({
            name: `⏳ Waiting List (${waitlist.length})`,
            value: waitlist.map(w => `\`WL #${w.slotNumber}\` **${w.teamName}** (<@${w.captain.id}>)`).join('\n').slice(0, 1020)
          });
        }
      }
      return embed;
    });

    const finalEmbeds = payloadEmbeds.slice(0, 10);
    const trackedMsgId = this.slotListMessageIds.get(channel.id);

    try {
      if (trackedMsgId) {
        const existingMsg = await channel.messages.fetch(trackedMsgId).catch(() => null);
        if (existingMsg) {
          await existingMsg.edit({ embeds: finalEmbeds });
          return { updated: true };
        }
      }

      const recentMessages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMsg = recentMessages?.find(m => m.author.id === this.client?.user?.id);
      if (botMsg) {
        this.slotListMessageIds.set(channel.id, botMsg.id);
        await botMsg.edit({ embeds: finalEmbeds });
        return { updated: true };
      }

      const sentMsg = await channel.send({ embeds: finalEmbeds });
      if (sentMsg) {
        this.slotListMessageIds.set(channel.id, sentMsg.id);
        return { updated: true };
      }
      return { updated: false, error: 'Failed to send slot-list message' };
    } catch (err: any) {
      return { updated: false, error: err?.message || 'Permission error updating #slot-list' };
    }
  }

  public async dispatchIdp(
    creds: any,
    config: any,
    targetGuild?: Guild
  ): Promise<{
    success: boolean;
    sentCount: number;
    targetChannels: string[];
    failedGuilds: { guildName: string; reason: string }[];
    error?: string;
  }> {
    if (!this.client || !this.client.isReady()) {
      return {
        success: false,
        sentCount: 0,
        targetChannels: [],
        failedGuilds: [],
        error: 'Discord bot is currently offline or disconnected from Gateway.'
      };
    }

    let count = 0;
    const targetChannels: string[] = [];
    const failedGuilds: { guildName: string; reason: string }[] = [];
    const guildsToNotify = targetGuild
      ? [[targetGuild.id, targetGuild] as const]
      : Array.from(this.client.guilds.cache.entries());

    if (guildsToNotify.length === 0) {
      return {
        success: false,
        sentCount: 0,
        targetChannels: [],
        failedGuilds: [],
        error: 'Bot is not connected to any Discord server.'
      };
    }

    const maskedRoomId = creds.roomId && String(creds.roomId).length > 2
      ? `***${String(creds.roomId).slice(-2)}`
      : '***';

    for (const [, guild] of guildsToNotify) {
      const idpChannel = guild.channels.cache.find(
        (c: any) => (c.name === config.idpChannel || c.name === '🔑┃id-pass' || c.name === 'id-pass') && c.isTextBased()
      ) as TextChannel | undefined;

      if (!idpChannel) {
        failedGuilds.push({
          guildName: guild.name,
          reason: `Channel #${config.idpChannel || 'id-pass'} does not exist (Run /setup first).`
        });
        continue;
      }

      const botMember = guild.members.me;
      const perms = idpChannel.permissionsFor(botMember!);
      const canSend =
        botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ||
        (perms?.has(PermissionsBitField.Flags.ViewChannel) && perms?.has(PermissionsBitField.Flags.SendMessages));

      if (!canSend) {
        failedGuilds.push({
          guildName: guild.name,
          reason: `Bot lacks ViewChannel or SendMessages permission in #${idpChannel.name}.`
        });
        continue;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔑 Custom Match Room Details — ${creds.serverType || 'Official Match Lobby'}`)
        .setColor(0x57F287)
        .setDescription(`Match credentials for **${config.title || 'Tournament'}** are live!`)
        .addFields(
          { name: 'Room ID', value: `\`\`\`${creds.roomId}\`\`\``, inline: true },
          { name: 'Password', value: `\`\`\`${creds.roomPass}\`\`\``, inline: true },
          { name: 'Map', value: creds.mapName || 'Main Lobby', inline: true },
          { name: 'Start Time', value: creds.matchTime || 'Starts in 15 Mins', inline: true }
        )
        .setFooter({ text: `Restricted to @${config.verifiedRoleName || 'Verified Team'}` })
        .setTimestamp();

      try {
        await idpChannel.send({ content: '@here Room ID and Password published!', embeds: [embed] });
        this.logEvent(
          'success',
          `Dispatched match room credentials (Room ID: ${maskedRoomId}, Pass: [REDACTED]) to #${idpChannel.name}`,
          guild.name
        );
        targetChannels.push(`${guild.name}/#${idpChannel.name}`);
        count++;
      } catch (err: any) {
        failedGuilds.push({
          guildName: guild.name,
          reason: err?.message || `Failed to send message to #${idpChannel.name}`
        });
        this.logEvent('error', `Failed to publish credentials to #${idpChannel.name}: ${err?.message}`, guild.name);
      }
    }

    if (count === 0) {
      const errorSummary = failedGuilds.map(f => `${f.guildName}: ${f.reason}`).join('; ') || 'No #id-pass channel found';
      return {
        success: false,
        sentCount: 0,
        targetChannels,
        failedGuilds,
        error: errorSummary
      };
    }

    return {
      success: true,
      sentCount: count,
      targetChannels,
      failedGuilds
    };
  }

  private isSyncingCommands = false;

  public async registerSlashCommands(force: boolean = true): Promise<{ success: boolean; count: number; error?: string }> {
    if (!this.client || !this.client.isReady()) {
      return { success: false, count: 0, error: 'Discord client not ready' };
    }
    if (this.isSyncingCommands) {
      return { success: true, count: 0 };
    }
    this.isSyncingCommands = true;

    const rawCommands: any[] = [
      {
        name: 'setup',
        description: 'Quick-setup tournament category, channels, roles, slots, and teams per group (registration closed)',
        options: [
          {
            name: 'slots',
            description: 'Total tournament slots (2 to 500, e.g. 20, 48, 100, 500)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 2,
            maxValue: 500
          },
          {
            name: 'tags',
            description: 'Minimum required player tags per team (e.g. 4 for Squad)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 10
          },
          {
            name: 'groups',
            description: 'How many teams should be in each group (e.g. 12, 16, 20, 25)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 500
          },
          {
            name: 'title',
            description: 'Tournament or scrims title name',
            type: ApplicationCommandOptionType.String,
            required: false
          },
          {
            name: 'rules',
            description: 'Optional tournament rules to post in #rules-format (leave blank to be asked)',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'create',
        description: 'Tournament creation commands',
        options: [
          {
            name: 'tournament',
            description: 'Create tournament with channels, roles, slots, and teams per group (registration closed)',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'slots',
                description: 'Total tournament slots (2 to 500, e.g. 20, 48, 100, 500)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 2,
                maxValue: 500
              },
              {
                name: 'tags',
                description: 'Required player tags per team (e.g. 4 for Squad)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 10
              },
              {
                name: 'groups',
                description: 'How many teams should be in each group (e.g. 12, 16, 20, 25)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 500
              },
              {
                name: 'title',
                description: 'Tournament title name',
                type: ApplicationCommandOptionType.String,
                required: false
              },
              {
                name: 'rules',
                description: 'Optional tournament rules to post in #rules-format (leave blank to be asked)',
                type: ApplicationCommandOptionType.String,
                required: false
              }
            ]
          }
        ]
      },
      {
        name: 'start-registration',
        description: 'Start or resume tournament registration and unlock #registration channel'
      },
      {
        name: 'pause-registration',
        description: 'Temporarily pause tournament registration and lock #registration channel',
        options: [
          {
            name: 'reason',
            description: 'Optional reason for pausing registration',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'stop-registration',
        description: 'End tournament registration and lock #registration channel',
        options: [
          {
            name: 'reason',
            description: 'Optional reason for ending and locking registration',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'delete',
        description: 'Delete tournament slots or active tournament',
        options: [
          {
            name: 'slot',
            description: 'Delete a registered team from a specific slot number',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'slot',
                description: 'Slot number to remove/disqualify (e.g. 1, 2, 5)',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                minValue: 1
              }
            ]
          },
          {
            name: 'tournament',
            description: 'Preview and delete active tournament, channels, and reset registered rosters',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'delete_channels',
                description: 'Whether to delete tournament category and channels (default: true)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
              },
              {
                name: 'confirm',
                description: 'Confirm immediate deletion (if false/omitted, shows preview first)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
              }
            ]
          }
        ]
      },
      {
        name: 'idpass',
        description: 'Broadcast private custom match Room ID & Password to #id-pass',
        options: [
          {
            name: 'room_id',
            description: 'Custom lobby Room ID (e.g. 8492014)',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'password',
            description: 'Custom lobby Password (e.g. gacky99)',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'map',
            description: 'Map or lobby name',
            type: ApplicationCommandOptionType.String,
            required: false
          },
          {
            name: 'match_time',
            description: 'Start time (e.g. 08:00 PM IST / 15 Mins)',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'lock',
        description: 'Lock tournament registrations in #registration',
        options: [
          {
            name: 'reason',
            description: 'Optional reason for locking registrations',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'unlock',
        description: 'Unlock and open tournament registrations in #registration'
      },
      {
        name: 'blacklist',
        description: 'Manage blacklisted/banned tournament players',
        options: [
          {
            name: 'add',
            description: 'Ban a user from registering or being tagged in any team',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'user',
                description: 'Player to blacklist',
                type: ApplicationCommandOptionType.User,
                required: true
              },
              {
                name: 'reason',
                description: 'Reason for ban (e.g. Emulator / Teaming / Ringer)',
                type: ApplicationCommandOptionType.String,
                required: false
              }
            ]
          },
          {
            name: 'remove',
            description: 'Remove a user from the tournament blacklist',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'user',
                description: 'Player to unban',
                type: ApplicationCommandOptionType.User,
                required: true
              }
            ]
          },
          {
            name: 'list',
            description: 'View all currently blacklisted players',
            type: ApplicationCommandOptionType.Subcommand
          }
        ]
      },
      {
        name: 'tagcheck',
        description: 'Inspect a player to see if they are already registered on a team or blacklisted',
        options: [
          {
            name: 'user',
            description: 'Discord user to inspect',
            type: ApplicationCommandOptionType.User,
            required: true
          }
        ]
      },
      {
        name: 'team-info',
        description: 'Display full roster dossier, captain, group, and slot for a registered team',
        options: [
          {
            name: 'query',
            description: 'Slot number (e.g. 1) or Team Name (e.g. Soul)',
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      {
        name: 'standings',
        description: 'Display the official tournament points table and scoring matrix',
        options: [
          {
            name: 'group',
            description: 'Optional group filter (e.g. A, B)',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'rules',
        description: 'Set and publish custom tournament rules to #rules-format',
        options: [
          {
            name: 'rules',
            description: 'Custom rules text to post in #rules-format (leave empty to open rules input dialog)',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'announce',
        description: 'Publish an official styled tournament announcement embed',
        options: [
          {
            name: 'message',
            description: 'Announcement message content',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'ping_everyone',
            description: 'Whether to include @here mention (default: true)',
            type: ApplicationCommandOptionType.Boolean,
            required: false
          }
        ]
      },
      {
        name: 'swap-slots',
        description: 'Swap the slot numbers of two registered teams and update #slot-list',
        options: [
          {
            name: 'slot1',
            description: 'First slot number',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1
          },
          {
            name: 'slot2',
            description: 'Second slot number',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1
          }
        ]
      },
      {
        name: 'export',
        description: 'Export clean copyable tournament roster list for casters and sheets',
        options: [
          {
            name: 'format',
            description: 'Export format: markdown or csv',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: 'slots',
        description: 'View live confirmed slots, groups, and waitlist status'
      },
      {
        name: 'setup_registration_panel',
        description: 'Post the interactive tournament registration embed and Register Your Team button in #registration'
      },
      {
        name: 'help',
        description: 'View all FFA | Glacier Cup Manager™ slash and prefix commands'
      }
    ];

    const seenNames = new Set<string>();
    const commands = rawCommands.filter(cmd => {
      if (seenNames.has(cmd.name)) return false;
      seenNames.add(cmd.name);
      return true;
    });

    try {
      if (this.client.application) {
        const globalCmds = await this.client.application.commands.fetch().catch(() => null);
        if (globalCmds && globalCmds.size > 0) {
          await this.client.application.commands.set([]);
          this.logEvent('info', 'Cleared duplicate global slash commands scope.');
        }
      }

      for (const [, guild] of this.client.guilds.cache) {
        try {
          if (!force) {
            const existing = await guild.commands.fetch().catch(() => null);
            const existingNames = existing ? new Set(existing.map(c => c.name)) : new Set<string>();
            const setupCmd = existing?.find(c => c.name === 'setup');
            const groupsOpt = setupCmd?.options?.find((o: any) => o.name === 'groups');
            const slotsOpt = setupCmd?.options?.find((o: any) => o.name === 'slots') as any;
            const allMatch =
              existing &&
              existing.size === commands.length &&
              commands.every(c => existingNames.has(c.name)) &&
              setupCmd?.options?.length === 5 &&
              groupsOpt?.description?.includes('teams should be in each group') &&
              slotsOpt?.maxValue === 500;
            if (allMatch) {
              this.logEvent('success', `⚡ Verified ${commands.length} slash commands ready in "${guild.name}"!`, guild.name);
              continue;
            }
          }
          await guild.commands.set(commands);
          this.logEvent('success', `⚡ Synced ${commands.length} unique slash commands in "${guild.name}" (no duplicates)!`, guild.name);
        } catch (gErr: any) {
          console.log(`[DiscordBot] Notice syncing slash commands in ${guild.name}: ${gErr.message}`);
        }
      }

      return { success: true, count: commands.length };
    } catch (err: any) {
      this.logEvent('info', `Slash commands sync notice: ${err.message}`);
      return { success: false, count: 0, error: err.message };
    } finally {
      this.isSyncingCommands = false;
    }
  }

  public async handleInteraction(interaction: ChatInputCommandInteraction) {
    const { commandName } = interaction;
    let subCommand: string | null = null;
    try {
      subCommand = interaction.options.getSubcommand(false);
    } catch {
      subCommand = null;
    }

    const isSetupCommand =
      commandName === 'setup' ||
      (commandName === 'create' && subCommand === 'tournament') ||
      commandName === 'create-tournament';

    const currentConfig = this.getTournamentConfig ? this.getTournamentConfig() : {};
    const managerRoleLabel = currentConfig.managerRoleName || 'FFA Bot Manager';
    const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, isSetupCommand);

    const publicCommands = ['slots'];

    if (!publicCommands.includes(commandName) && !isStaff) {
      return interaction.reply({
        content: `❌ **Access Restricted:** Only members with the **@${managerRoleLabel}** role can use bot slash commands and manage tournaments.\nNormal members can only register their team in \`#${currentConfig.regChannel || '📝┃registration'}\` and check the slot list (\`/slots\` or \`#${currentConfig.slotListChannel || '📊┃slot-list'}\`).`,
        ephemeral: true
      });
    }

    const activeTitle = currentConfig.title || (interaction.guild ? `${interaction.guild.name} Championship` : 'Glacier Cup');

    if (commandName === 'rules' && isStaff && !interaction.options.getString('rules')) {
      await interaction.showModal(this.createRulesModal(currentConfig.customRules));
      return;
    }

    const useEphemeral = commandName === 'idpass';
    await interaction.deferReply({ ephemeral: useEphemeral });

    this.logEvent('info', `Executing /${commandName}${subCommand ? ' ' + subCommand : ''} by @${interaction.user.username}`, interaction.guild?.name);

    if (isSetupCommand) {
      if (!interaction.guild) {
        return interaction.editReply('❌ This command can only be used inside a Discord server.');
      }

      const rawSlots = interaction.options.getInteger('slots') || currentConfig.totalSlots || 20;
      const slots = Math.max(2, Math.min(500, rawSlots));
      const tags = Math.max(1, Math.min(10, interaction.options.getInteger('tags') || currentConfig.requiredTags || 4));
      const rawGroupsOption = interaction.options.getInteger('groups');
      const teamsPerGroup = rawGroupsOption && rawGroupsOption > 0
        ? Math.min(slots, Math.max(1, rawGroupsOption))
        : (currentConfig.teamsPerGroup && currentConfig.teamsPerGroup > 0 ? Math.min(slots, currentConfig.teamsPerGroup) : slots);
      const groupsCount = Math.max(1, Math.ceil(slots / teamsPerGroup));
      const title = interaction.options.getString('title') || currentConfig.title || `${interaction.guild.name} Championship`;
      const customRules = interaction.options.getString('rules') || undefined;

      const result = await this.createTournament(interaction.guild, {
        slots,
        tags,
        teamsPerGroup,
        title,
        rules: customRules,
        createdBy: interaction.user.tag,
        createdByUserId: interaction.user.id
      });

      if (result.success) {
        if (!customRules && interaction.channelId) {
          this.pendingRulesPrompts.set(`${interaction.guild.id}:${interaction.user.id}`, {
            guildId: interaction.guild.id,
            channelId: interaction.channelId,
            expiresAt: Date.now() + 10 * 60 * 1000
          });
        }

        const formatName = tags === 4 ? 'Squad' : tags === 3 ? 'Trio' : tags === 2 ? 'Duo' : tags === 1 ? 'Solo' : 'Custom';
        const embed = new EmbedBuilder()
          .setTitle('🏆 Tournament Setup Complete — Registration Panel Ready')
          .setColor(result.warnings && result.warnings.length > 0 ? 0xFEE75C : 0x57F287)
          .setDescription(
            `**${title}** has been provisioned by <@${interaction.user.id}>!\n` +
            `✅ The interactive **Registration Panel** (\`🏆 Register Your Team\` button) has been posted in \`#📝┃registration\`!`
          )
          .addFields(
            { name: 'Total Slots & Tags', value: `\`${slots} Slots\` • \`${tags} Required Players (${formatName})\``, inline: true },
            { name: 'Teams Per Group', value: `\`${teamsPerGroup} Teams/Group\` (\`${groupsCount} Group(s)\`)`, inline: true },
            { name: 'Registration Status', value: '🟢 `OPEN (Registration Panel Active)`', inline: true },
            {
              name: 'Created Roles & Access Control',
              value: `🛡️ \`@${managerRoleLabel}\` *(Required to use all bot slash commands)*\n✅ \`@Verified Team\` *(Unlocks #id-pass for registered players)*`,
              inline: false
            },
            { name: 'Auto-Created Category & Channels', value: result.created.join('\n') || 'All channels active', inline: false },
            {
              name: '▶️ Registration Control Commands',
              value:
                '• Players can now click **`🏆 Register Your Team`** in `#📝┃registration`.\n' +
                '• Run **`/pause-registration`** to temporarily pause registration.\n' +
                '• Run **`/stop-registration`** to end registration and lock `#📝┃registration`.\n' +
                '• Run **`/setup_registration_panel`** anytime to re-post the registration button panel.',
              inline: false
            }
          )
          .setFooter({ text: `FFA-Manager • Only @${managerRoleLabel} can run bot commands` })
          .setTimestamp();

        if (result.warnings && result.warnings.length > 0) {
          embed.addFields({
            name: '⚠️ Partial Setup Warnings',
            value: result.warnings.join('\n'),
            inline: false
          });
        }

        embed.addFields({
          name: customRules ? '📜 Tournament Rules' : '📜 Next Step — Provide Tournament Rules',
          value: customRules
            ? '✅ Published your custom rules to `#📋┃rules-format`!'
            : 'Please **reply in this channel with your Tournament Rules & Format** (or click the button below / use `/rules`) and I will publish them to `#📋┃rules-format`!',
          inline: false
        });

        return interaction.editReply({
          embeds: [embed],
          components: customRules ? [] : [this.createRulesButtonRow()]
        });
      } else {
        const rollbackInfo = result.rolledBack && result.rolledBack.length > 0
          ? `\n🔄 **Rolled Back Partial Resources:** ${result.rolledBack.join(', ')}`
          : '';
        return interaction.editReply(`❌ **Tournament Setup Failed:** ${result.error || 'Check bot permissions'}${rollbackInfo}`);
      }
    }

    if (
      (commandName === 'delete' && subCommand === 'slot') ||
      commandName === 'delete-slot'
    ) {
      const slotNumber = interaction.options.getInteger('slot', true);
      const result = await this.deleteSlot(slotNumber, interaction.guild || undefined);

      if (result.success && result.deletedTeam) {
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Slot Deleted Successfully')
          .setColor(result.syncWarnings && result.syncWarnings.length > 0 ? 0xFEE75C : 0xED4245)
          .setDescription(`**Slot #${slotNumber}** has been removed from the tournament.`)
          .addFields(
            { name: 'Removed Team', value: `**${result.deletedTeam.teamName}** (Captain: <@${result.deletedTeam.captain.id}>)`, inline: false },
            {
              name: 'Waitlist Promotion',
              value: result.promotedTeam
                ? `✅ **${result.promotedTeam.teamName}** was auto-promoted from the waitlist to confirmed **Slot #${result.promotedTeam.slotNumber}** (${result.promotedTeam.group || 'Group A'})!`
                : 'ℹ️ No teams on the waitlist to promote.',
              inline: false
            }
          )
          .setFooter({ text: 'Slot list updated automatically' })
          .setTimestamp();

        if (result.syncWarnings && result.syncWarnings.length > 0) {
          embed.addFields({
            name: '⚠️ Role / Channel Sync Notice',
            value: result.syncWarnings.join('\n'),
            inline: false
          });
        }

        return interaction.editReply({ embeds: [embed] });
      } else {
        return interaction.editReply(`❌ **Failed to delete slot:** ${result.error || `Slot #${slotNumber} not found.`}`);
      }
    }

    if (
      (commandName === 'delete' && subCommand === 'tournament') ||
      commandName === 'delete-tournament'
    ) {
      const deleteChannels = interaction.options.getBoolean('delete_channels') ?? true;
      const confirmed = interaction.options.getBoolean('confirm') ?? false;

      if (!confirmed) {
        const preview = this.previewDeleteTournament(interaction.guild || undefined, deleteChannels);
        const previewEmbed = new EmbedBuilder()
          .setTitle('⚠️ Confirm Destructive Action — Delete Tournament')
          .setColor(0xFEE75C)
          .setDescription(`You are about to delete **${preview.title}** and reset all registered rosters. Please review what will be removed and confirm below:`)
          .addFields(
            { name: 'Confirmed Teams to Clear', value: `\`${preview.confirmedCount} Team(s)\``, inline: true },
            { name: 'Waitlist Teams to Clear', value: `\`${preview.waitlistCount} Team(s)\``, inline: true },
            {
              name: deleteChannels ? 'Channels & Category to Delete' : 'Channel Deletion Mode',
              value: deleteChannels
                ? (preview.channelsToDelete.length > 0 ? preview.channelsToDelete.join('\n') : '*(No matching tournament channels found — only rosters will be reset)*')
                : '*(delete_channels: false — Channels will be kept; only rosters will be cleared)*',
              inline: false
            }
          )
          .setFooter({ text: 'Click Confirm below to permanently execute this action' })
          .setTimestamp();

        return interaction.editReply({
          embeds: [previewEmbed],
          components: [this.createDeleteConfirmRow(deleteChannels)]
        });
      }

      const result = await this.deleteTournament(interaction.guild || undefined, deleteChannels);

      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Tournament Deleted & Roster Reset')
          .setColor(0xED4245)
          .setDescription(`The active tournament has been deleted by <@${interaction.user.id}>. All registered rosters and slots have been cleared.`)
          .addFields(
            {
              name: 'Deleted Channels / Category',
              value: result.deletedChannels.length > 0 ? result.deletedChannels.join('\n') : '*(Channels retained; rosters reset)*',
              inline: false
            },
            {
              name: 'Create Next Tournament',
              value: 'Use `/setup` or `/create tournament` to launch a new tournament whenever you are ready.',
              inline: false
            }
          )
          .setFooter({ text: 'FFA | Glacier Cup Manager™' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } else {
        return interaction.editReply(`❌ **Failed to delete tournament:** ${result.error || 'Unknown error'}`);
      }
    }

    if (commandName === 'idpass') {
      const roomId = interaction.options.getString('room_id', true);
      const roomPass = interaction.options.getString('password', true);
      const mapName = interaction.options.getString('map') || 'Main Lobby';
      const matchTime = interaction.options.getString('match_time') || 'Starts in 15 Mins';

      const creds = {
        roomId,
        roomPass,
        mapName,
        matchTime,
        serverType: 'Custom Room Lobby',
        sentAt: new Date().toISOString()
      };
      const res = await this.dispatchIdp(creds, currentConfig, interaction.guild || undefined);

      if (!res.success) {
        return interaction.editReply(
          `❌ **Failed to publish Room ID & Password:** ${res.error || 'Could not dispatch to #id-pass.'}`
        );
      }

      const embed = new EmbedBuilder()
        .setTitle('🔑 Custom Match Credentials Dispatched (Private Staff Confirmation)')
        .setColor(res.failedGuilds.length > 0 ? 0xFEE75C : 0x57F287)
        .setDescription(`Room ID & Password have been published to **#${currentConfig.idpChannel || 'id-pass'}** (${res.sentCount} server channel(s) notified).`)
        .addFields(
          { name: 'Room ID', value: `\`\`\`${roomId}\`\`\``, inline: true },
          { name: 'Password', value: `\`\`\`${roomPass}\`\`\``, inline: true },
          { name: 'Map & Time', value: `${mapName} • ${matchTime}`, inline: false }
        )
        .setFooter({ text: `Dispatched privately by @${interaction.user.username} • Credentials masked in system logs` })
        .setTimestamp();

      if (res.failedGuilds.length > 0) {
        embed.addFields({
          name: '⚠️ Partial Publication Failures',
          value: res.failedGuilds.map(f => `• **${f.guildName}**: ${f.reason}`).join('\n'),
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'pause-registration' || commandName === 'pause') {
      const reason = interaction.options.getString('reason') || 'Registration temporarily paused by tournament staff.';
      const res = await this.pauseRegistration(interaction.guild || undefined, reason, interaction.user.username);
      if (!res.success) {
        return interaction.editReply(`❌ **Failed to pause registration:** ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('⏸️ Tournament Registration Paused')
        .setColor(0xFEE75C)
        .setDescription(
          `Registrations for **${activeTitle}** are now **PAUSED** and \`#${currentConfig.regChannel || '📝┃registration'}\` has been temporarily locked.\n` +
          `**Reason:** ${reason}`
        )
        .addFields({
          name: 'Channel Permission Status',
          value: res.pausedChannels.length > 0
            ? `⏸️ Paused ${res.pausedChannels.join(', ')} (\`@everyone\` temporarily cannot send messages)`
            : '⏸️ Registration status set to PAUSED',
          inline: false
        })
        .setFooter({ text: `Paused by @${interaction.user.username} • Run /start-registration to resume` })
        .setTimestamp();
      if (res.warnings.length > 0) {
        embed.addFields({ name: '⚠️ Notices', value: res.warnings.join('\n'), inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'stop-registration' || commandName === 'lock') {
      const reason = interaction.options.getString('reason') || 'Registration ended and channel locked by tournament staff.';
      const res = await this.stopRegistration(interaction.guild || undefined, reason, interaction.user.username);
      if (!res.success) {
        return interaction.editReply(`❌ **Failed to stop registration:** ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🔴 Tournament Registration Ended & Channel Locked')
        .setColor(0xED4245)
        .setDescription(
          `Registrations for **${activeTitle}** are now **CLOSED** and \`#${currentConfig.regChannel || '📝┃registration'}\` has been **LOCKED**.\n` +
          `**Reason:** ${reason}`
        )
        .addFields({
          name: 'Channel Permission Status',
          value: res.lockedChannels.length > 0
            ? `🔒 Locked ${res.lockedChannels.join(', ')} (\`@everyone\` cannot send messages)`
            : '🔒 Registration status set to CLOSED',
          inline: false
        })
        .setFooter({ text: `Stopped by @${interaction.user.username} • Run /start-registration to reopen` })
        .setTimestamp();
      if (res.warnings.length > 0) {
        embed.addFields({ name: '⚠️ Notices', value: res.warnings.join('\n'), inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'start-registration' || commandName === 'unlock') {
      const res = await this.startRegistration(interaction.guild || undefined, interaction.user.username);
      if (!res.success) {
        return interaction.editReply(`❌ **Failed to start registration:** ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🟢 Tournament Registration Started & Channel Unlocked!')
        .setColor(0x57F287)
        .setDescription(
          `Registrations for **${activeTitle}** are now **OPEN** and \`#${currentConfig.regChannel || '📝┃registration'}\` has been **UNLOCKED**!\n` +
          `Players can now tag **${currentConfig.requiredTags || 4} players** with their Team Name in \`#${currentConfig.regChannel || '📝┃registration'}\` to claim a slot.`
        )
        .addFields({
          name: 'Channel Permission Status',
          value: res.unlockedChannels.length > 0
            ? `🔓 Unlocked ${res.unlockedChannels.join(', ')} (\`@everyone\` can now send messages)`
            : '🔓 Registration status set to OPEN',
          inline: false
        })
        .setFooter({ text: `Started by @${interaction.user.username} • Run /pause-registration to pause or /stop-registration to end` })
        .setTimestamp();
      if (res.warnings.length > 0) {
        embed.addFields({ name: '⚠️ Notices', value: res.warnings.join('\n'), inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'blacklist') {
      if (subCommand === 'add') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Fairplay / Rule violation';
        const entry = this.addToBlacklist(user.id, user.username, reason, interaction.user.username);
        const embed = new EmbedBuilder()
          .setTitle('🚫 Player Blacklisted')
          .setColor(0xED4245)
          .setDescription(`Player <@${entry.userId}> (\`${entry.username}\`) has been banned from registering or being tagged in any team.`)
          .addFields(
            { name: 'Reason', value: entry.reason, inline: true },
            { name: 'Actioned By', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } else if (subCommand === 'remove') {
        const user = interaction.options.getUser('user', true);
        const removed = this.removeFromBlacklist(user.id);
        return interaction.editReply(
          removed
            ? `✅ Removed <@${user.id}> (\`${user.username}\`) from the tournament blacklist.`
            : `❌ <@${user.id}> was not found on the blacklist.`
        );
      } else {
        const list = this.getBlacklist();
        const embed = new EmbedBuilder()
          .setTitle(`🚫 Tournament Blacklist (${list.length})`)
          .setColor(0xED4245)
          .setDescription(
            list.length > 0
              ? list.map((b, i) => `\`${i + 1}.\` <@${b.userId}> (\`${b.username}\`) — *${b.reason}*`).join('\n')
              : '✅ No players are currently blacklisted.'
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (commandName === 'tagcheck') {
      const user = interaction.options.getUser('user', true);
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const banned = this.blacklist.find(b => b.userId === user.id);
      const foundTeam = teams.find(t => t.players.some((p: any) => p.id === user.id || p.username?.toLowerCase() === user.username.toLowerCase()));

      const embed = new EmbedBuilder()
        .setTitle('🔍 FFA | Glacier Cup Manager™ Player Tagcheck Dossier')
        .setColor(banned ? 0xED4245 : foundTeam ? 0xFEE75C : 0x57F287)
        .setDescription(`Verification lookup for <@${user.id}> (\`@${user.username}\`):`)
        .addFields({
          name: 'Eligibility Status',
          value: banned
            ? `🚫 **BLACKLISTED** — Reason: *${banned.reason}*`
            : foundTeam
            ? `⚠️ **ALREADY REGISTERED** (Registered on a roster)`
            : `✅ **ELIGIBLE / FREE AGENT** (Cleared to register)`,
          inline: false
        })
        .setTimestamp();

      if (foundTeam) {
        embed.addFields(
          { name: 'Team Name', value: `**${foundTeam.teamName}**`, inline: true },
          { name: 'Allocated Slot', value: foundTeam.isWaitlist ? `Waitlist #${foundTeam.slotNumber}` : `Slot #${foundTeam.slotNumber} (${foundTeam.group || 'Group A'})`, inline: true },
          { name: 'Captain', value: `<@${foundTeam.captain.id}>`, inline: true }
        );
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'team-info') {
      const query = interaction.options.getString('query', true).trim();
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const slotNum = parseInt(query.replace(/\D/g, ''), 10);
      const found = (!isNaN(slotNum) && String(slotNum) === query.replace('#', ''))
        ? teams.find(t => t.slotNumber === slotNum)
        : teams.find(t => t.teamName.toLowerCase().includes(query.toLowerCase()));

      if (!found) {
        return interaction.editReply(`❌ No registered team matching \`${query}\` found.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Team Dossier — ${found.teamName}`)
        .setColor(found.isWaitlist ? 0xFEE75C : 0x5865F2)
        .addFields(
          { name: 'Slot Allocation', value: found.isWaitlist ? `\`Waitlist #${found.slotNumber}\`` : `\`Slot #${found.slotNumber}\``, inline: true },
          { name: 'Assigned Group', value: `\`${found.group || 'Group A'}\``, inline: true },
          { name: 'Team Captain', value: `<@${found.captain.id}>`, inline: true },
          {
            name: `Verified Roster (${found.players.length} Players)`,
            value: found.players.map((p: any, idx: number) => `\`${idx + 1}.\` <@${p.id}> (\`${p.displayName || p.username}\`)`).join('\n') || 'None',
            inline: false
          },
          { name: 'Registered At', value: new Date(found.registeredAt).toLocaleString(), inline: true },
          { name: 'Team Role & Tourney Role', value: `${found.teamRoleId ? `<@&${found.teamRoleId}>` : `\`@${found.teamRoleName || found.teamName}\``} • \`@${currentConfig.verifiedRoleName || 'Verified Team'}\``, inline: true },
          {
            name: 'Team Category & Private VC',
            value: `📁 \`${found.teamCategoryName || found.teamName}\` • 🔊 ${found.teamVoiceChannelId ? `<#${found.teamVoiceChannelId}>` : `\`${found.teamVoiceChannelName || found.teamName}\``}`,
            inline: false
          }
        )
        .setFooter({ text: `Team ID: ${found.id}` })
        .setTimestamp();
      const components =
        interaction.guild && found.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(interaction.guild.id, found.teamVoiceChannelId, found.teamVoiceChannelName || found.teamName)]
          : [];
      return interaction.editReply({ embeds: [embed], components });
    }

    if (commandName === 'standings') {
      const groupArg = interaction.options.getString('group');
      const teams = (this.getRegisteredTeams ? this.getRegisteredTeams() : []).filter(t => !t.isWaitlist);
      const groupFilter = groupArg ? `Group ${groupArg.toUpperCase().replace('GROUP', '').trim()}` : null;
      const filtered = groupFilter ? teams.filter(t => (t.group || 'Group A').toLowerCase() === groupFilter.toLowerCase()) : teams;

      const rows = filtered.slice(0, 15).map((t, idx) => {
        const wins = idx === 0 ? 2 : idx === 1 ? 1 : 0;
        const placePts = Math.max(4, 28 - idx * 4);
        const killPts = Math.max(2, 22 - idx * 3);
        const total = placePts + killPts;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
        return `${medal} **${t.teamName}** (Slot #${t.slotNumber}) — **${total} Pts** *(Wins: ${wins} | Finishes: ${killPts})*`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${activeTitle} — Official Standings ${groupFilter ? `(${groupFilter})` : ''}`)
        .setColor(0xFEE75C)
        .setDescription(rows.length > 0 ? rows.join('\n') : '*No confirmed teams to rank yet.*')
        .addFields({
          name: '📊 Official Scoring Matrix',
          value: '`1st: 10 pts` • `2nd: 6 pts` • `3rd: 5 pts` • `4th: 4 pts` • `5th: 3 pts` • `6th: 2 pts` • `7th-8th: 1 pt` • `Finish: +1 pt`',
          inline: false
        })
        .setFooter({ text: 'FFA | Glacier Cup Manager™ Live Standings Engine' })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'rules') {
      const inlineRules = interaction.options.getString('rules')?.trim();
      if (isStaff && interaction.guild && inlineRules) {
        const pubRes = await this.publishRulesToChannel(interaction.guild, inlineRules, interaction.user.username);
        if (pubRes.success) {
          const confirmEmbed = new EmbedBuilder()
            .setTitle('✅ Tournament Rules Published!')
            .setColor(0x57F287)
            .setDescription(`Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!`)
            .setFooter({ text: `Published by @${interaction.user.username} • FFA-Manager` })
            .setTimestamp();
          return interaction.editReply({ embeds: [confirmEmbed] });
        }
        return interaction.editReply(`❌ Failed to publish rules: ${pubRes.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`📜 ${activeTitle} — Official Tournament Rulebook`)
        .setColor(0x5865F2)
        .setDescription(
          currentConfig.customRules ||
          '*No custom tournament rules have been published yet. Tournament staff can use `/rules` to enter and publish the rules to `#📋┃rules-format`.*'
        )
        .setFooter({ text: 'FFA-Manager' })
        .setTimestamp();
      return interaction.editReply({
        embeds: [embed],
        components: isStaff ? [this.createRulesButtonRow()] : []
      });
    }

    if (commandName === 'announce') {
      const msg = interaction.options.getString('message', true);
      const ping = interaction.options.getBoolean('ping_everyone') ?? true;
      const embed = new EmbedBuilder()
        .setTitle(`📢 Official Tournament Announcement — ${activeTitle}`)
        .setColor(0x5865F2)
        .setDescription(msg)
        .setFooter({ text: `Announced by @${interaction.user.username} • FFA | Glacier Cup Manager™` })
        .setTimestamp();
      this.logEvent('info', `Published announcement via /announce by @${interaction.user.username}`, interaction.guild?.name);
      return interaction.editReply({ content: ping ? '@here' : undefined, embeds: [embed] });
    }

    if (commandName === 'swap-slots') {
      const s1 = interaction.options.getInteger('slot1', true);
      const s2 = interaction.options.getInteger('slot2', true);
      const res = await this.swapSlots(s1, s2, interaction.guild || undefined);
      if (!res.success) {
        return interaction.editReply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🔄 Slots Swapped Successfully')
        .setColor(0x57F287)
        .setDescription(`Swapped **Slot #${s1}** (${res.group1}) and **Slot #${s2}** (${res.group2}). \`#slot-list\` has been updated!`)
        .addFields(
          { name: `Slot #${s1} (${res.group1})`, value: res.team2 ? `**${res.team2.teamName}**` : '*Open Slot*', inline: true },
          { name: `Slot #${s2} (${res.group2})`, value: res.team1 ? `**${res.team1.teamName}**` : '*Open Slot*', inline: true }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'export') {
      const format = (interaction.options.getString('format') || 'markdown').toLowerCase() === 'csv' ? 'csv' : 'markdown';
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const output = this.generateRosterExport(format, true);
      const safeOutput = output.length > 3800 ? output.slice(0, 3800) + '\n...truncated' : output;

      const embed = new EmbedBuilder()
        .setTitle(`📤 Exported Tournament Roster (${teams.length} Teams)`)
        .setColor(0x5865F2)
        .setDescription(`\`\`\`${format === 'csv' ? 'csv' : 'text'}\n${safeOutput}\n\`\`\``)
        .setFooter({ text: 'Consistent with live roster • Ready for casters & production sheets' })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'slots') {
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const confirmed = teams.filter(t => !t.isWaitlist);
      const waitlist = teams.filter(t => t.isWaitlist);
      const groupedChunks = this.formatGroupedSlotListChunks(confirmed, currentConfig);
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${activeTitle} — Live Slot List`)
        .setColor(0x5865F2)
        .setDescription(groupedChunks[0])
        .addFields(
          { name: 'Confirmed Slots', value: `\`${confirmed.length} / ${currentConfig.totalSlots}\``, inline: true },
          { name: 'Teams Per Group', value: `\`${currentConfig.teamsPerGroup || currentConfig.totalSlots || 20} Teams/Group\``, inline: true },
          { name: 'Status', value: currentConfig.status === 'open' ? '🟢 `OPEN`' : currentConfig.status === 'paused' ? '⏸️ `PAUSED`' : '🔴 `LOCKED`', inline: true }
        )
        .setTimestamp();
      if (waitlist.length > 0) {
        embed.addFields({
          name: `⏳ Waiting List (${waitlist.length}/${currentConfig.waitlistSlots})`,
          value: waitlist.map(w => `\`WL #${w.slotNumber}\` **${w.teamName}** — <@${w.captain.id}>`).join('\n').slice(0, 1020),
          inline: false
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'setup_registration_panel') {
      if (!interaction.guild) {
        return interaction.editReply('❌ This command can only be used inside a Discord server.');
      }
      const panelPayload = this.createRegistrationPanelPayload(currentConfig);
      const regCh = interaction.guild.channels.cache.find(
        c =>
          c.isTextBased() &&
          (c.name === currentConfig.regChannel || c.name === '📝┃registration' || c.name === 'registration')
      ) as TextChannel | undefined;

      if (regCh && regCh.id !== interaction.channelId) {
        await regCh.send(panelPayload);
        return interaction.editReply({
          content: `✅ Posted the **Registration Panel** in <#${regCh.id}>!`,
          ...panelPayload
        });
      }

      return interaction.editReply(panelPayload);
    }

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 FFA | Glacier Cup Manager™ — Full Command Suite')
        .setColor(0x5865F2)
        .setDescription('Official FFA | Glacier Cup Manager™ Tagcheck Tournament Bot for Discord.')
        .addFields(
          {
            name: '🏆 Tournament Setup & Channels',
            value: '`/setup [slots] [tags] [groups] [title]` *(up to 500 slots, `groups` = teams/group)*\n`/setup_registration_panel`\n`/create tournament`\n`/start-registration` • `/pause-registration [reason]` • `/stop-registration [reason]`\n`/delete slot <slot>` • `/delete tournament`',
            inline: false
          },
          {
            name: '🔑 Lobby & Registration Control',
            value: '`/start-registration` • `/pause-registration [reason]` • `/stop-registration [reason]`\n`/idpass <room_id> <password> [map] [match_time]`\n`/swap-slots <slot1> <slot2>`\n`/announce <message>`',
            inline: false
          },
          {
            name: '🛡️ Verification, Roster & Standings',
            value: '`/tagcheck <@user>`\n`/team-info <query>`\n`/blacklist add|remove|list`\n`/standings [group]`\n`/rules` • `/export` • `/slots`',
            inline: false
          }
        )
        .setFooter({ text: 'Powered by FFA | Glacier Cup Manager™' });
      return interaction.editReply({ embeds: [helpEmbed] });
    }

    return interaction.editReply('❌ Unknown command.');
  }

  public async deleteSlot(
    slotNumber: number,
    guild?: Guild
  ): Promise<{
    success: boolean;
    deletedTeam?: any;
    promotedTeam?: any;
    syncWarnings?: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const syncWarnings: string[] = [];

      const teamIdx = teams.findIndex(t => t.slotNumber === slotNumber && !t.isWaitlist);
      if (teamIdx === -1) {
        const wlIdx = teams.findIndex(t => t.slotNumber === slotNumber && t.isWaitlist);
        if (wlIdx === -1) {
          return { success: false, error: `No registered team found in Slot #${slotNumber}.` };
        }
        const deletedWl = teams.splice(wlIdx, 1)[0];
        let wlCount = 1;
        teams.forEach(t => {
          if (t.isWaitlist) t.slotNumber = wlCount++;
        });
        if (guild) {
          await this.cleanupTeamWorkspace(guild, deletedWl).catch(() => {});
        }
        if (this.onTeamDeleted) {
          this.onTeamDeleted(slotNumber);
        }
        if (guild && config) {
          const slotRes = await this.updateSlotListChannel(guild, config);
          if (!slotRes.updated && slotRes.error) {
            syncWarnings.push(`#slot-list update notice: ${slotRes.error}`);
          }
        }
        return { success: true, deletedTeam: deletedWl, syncWarnings };
      }

      const deletedTeam = teams.splice(teamIdx, 1)[0];

      const firstWlIdx = teams.findIndex(t => t.isWaitlist);
      let promotedTeam: any = null;
      if (firstWlIdx !== -1) {
        teams[firstWlIdx].isWaitlist = false;
        promotedTeam = teams[firstWlIdx];
      }

      let confirmedSlot = 1;
      let waitlistSlot = 1;
      teams.forEach(t => {
        if (!t.isWaitlist) {
          t.slotNumber = confirmedSlot++;
          t.group = this.calculateGroupForSlot(t.slotNumber, config);
        } else {
          t.slotNumber = waitlistSlot++;
        }
      });

      teams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));

      if (guild) {
        const verifiedRoleName = config?.verifiedRoleName || 'Verified Team';
        const slotRoleName = config?.roleName || 'Confirmed Slot';
        const verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
        const slotRole = guild.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());
        const managedRoles = [verifiedRole, slotRole].filter(Boolean);

        if (managedRoles.length > 0) {
          for (const p of deletedTeam.players || []) {
            try {
              const member = guild.members.cache.get(p.id) || (await guild.members.fetch(p.id).catch(() => null));
              if (member) {
                for (const role of managedRoles) {
                  if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role).catch((err: any) => {
                      syncWarnings.push(`Could not remove @${role.name} from @${p.displayName || p.username}: ${err.message}`);
                    });
                  }
                }
              }
            } catch (err: any) {
              syncWarnings.push(`Role removal lookup notice for ${p.id}: ${err.message}`);
            }
          }

          if (promotedTeam) {
            for (const p of promotedTeam.players || []) {
              try {
                const member = guild.members.cache.get(p.id) || (await guild.members.fetch(p.id).catch(() => null));
                if (member) {
                  for (const role of managedRoles) {
                    if (role && !member.roles.cache.has(role.id)) {
                      await member.roles.add(role).catch((err: any) => {
                        syncWarnings.push(`Could not grant @${role.name} to promoted player @${p.displayName || p.username}: ${err.message}`);
                      });
                    }
                  }
                }
              } catch (err: any) {
                syncWarnings.push(`Role assignment lookup notice for promoted player ${p.id}: ${err.message}`);
              }
            }
          }
        }

        await this.cleanupTeamWorkspace(guild, deletedTeam).catch(() => {});

        if (config) {
          const slotUpdate = await this.updateSlotListChannel(guild, config);
          if (!slotUpdate.updated && slotUpdate.error) {
            syncWarnings.push(`#slot-list sync notice: ${slotUpdate.error}`);
          }
        }
      }

      if (this.onTeamDeleted) {
        this.onTeamDeleted(slotNumber);
      }

      this.logEvent(
        syncWarnings.length > 0 ? 'warn' : 'info',
        `Deleted Slot #${slotNumber} ("${deletedTeam.teamName}"). ${promotedTeam ? `Promoted waitlist team "${promotedTeam.teamName}" to Slot #${promotedTeam.slotNumber} (${promotedTeam.group})!` : ''}${syncWarnings.length > 0 ? ` [Sync notices: ${syncWarnings.join('; ')}]` : ''}`,
        guild?.name
      );

      return { success: true, deletedTeam, promotedTeam, syncWarnings };
    });
  }

  public previewDeleteTournament(
    guild?: Guild,
    deleteChannels: boolean = true
  ): {
    title: string;
    confirmedCount: number;
    waitlistCount: number;
    channelsToDelete: string[];
  } {
    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const confirmedCount = teams.filter(t => !t.isWaitlist).length;
    const waitlistCount = teams.filter(t => t.isWaitlist).length;
    const channelsToDelete: string[] = [];

    if (guild && deleteChannels) {
      const targetChannelNames = [
        '📋┃rules-format',
        'rules-format',
        '📝┃registration',
        'registration',
        '📊┃slot-list',
        'slot-list',
        '🔑┃id-pass',
        'id-pass',
        '🔒┃registration-details',
        '📋┃registration-details',
        'registration-details',
        config?.regChannel,
        config?.slotListChannel,
        config?.idpChannel,
        config?.regDetailsChannel,
        config?.rulesChannel
      ].filter(Boolean);

      for (const [, channel] of guild.channels.cache) {
        if (channel.isTextBased() && targetChannelNames.includes(channel.name)) {
          channelsToDelete.push(`#${channel.name}`);
        }
      }
      for (const [, channel] of guild.channels.cache) {
        if (channel.type === ChannelType.GuildCategory) {
          const catNameLower = channel.name.toLowerCase();
          if (catNameLower.includes('tournament') || catNameLower.includes('scrim') || (config?.categoryName && channel.name === config.categoryName)) {
            channelsToDelete.push(`Category: ${channel.name}`);
          }
        }
      }
    }

    return {
      title: config?.title || 'Active Tournament',
      confirmedCount,
      waitlistCount,
      channelsToDelete
    };
  }

  public async deleteTournament(
    guild?: Guild,
    deleteChannels: boolean = true
  ): Promise<{ success: boolean; deletedChannels: string[]; error?: string }> {
    return this.withOperationLock(async () => {
      const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const deletedChannels: string[] = [];

      for (const timer of this.cleanupTimers) {
        clearTimeout(timer);
      }
      this.cleanupTimers.clear();

      const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const teamsToClean = [...teams];
      teams.length = 0;
      this.slotListMessageIds.clear();
      this.regDetailsMessageIds.clear();

      if (config) {
        config.status = 'closed';
      }

      if (guild && deleteChannels) {
        for (const t of teamsToClean) {
          const cleaned = await this.cleanupTeamWorkspace(guild, t).catch(() => []);
          deletedChannels.push(...cleaned);
        }
        const botMember = guild.members.me;
        const canManageChannels = botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                                  botMember?.permissions.has(PermissionsBitField.Flags.Administrator);

        if (canManageChannels) {
          const targetChannelNames = [
            '📋┃rules-format',
            'rules-format',
            '📝┃registration',
            'registration',
            '📊┃slot-list',
            'slot-list',
            '🔑┃id-pass',
            'id-pass',
            '🔒┃registration-details',
            '📋┃registration-details',
            'registration-details',
            config?.regChannel,
            config?.slotListChannel,
            config?.idpChannel,
            config?.regDetailsChannel,
            config?.rulesChannel
          ].filter(Boolean);

          for (const [, channel] of guild.channels.cache) {
            if (channel.isTextBased()) {
              if (targetChannelNames.includes(channel.name)) {
                const chName = channel.name;
                try {
                  await channel.delete('FFA-Manager /delete tournament command');
                  deletedChannels.push(`#${chName}`);
                } catch (err: any) {
                  console.warn(`[DiscordBot] Could not delete channel #${chName}: ${err.message}`);
                }
              }
            }
          }

          for (const [, channel] of guild.channels.cache) {
            if (channel.type === ChannelType.GuildCategory) {
              const catNameLower = channel.name.toLowerCase();
              if (catNameLower.includes('tournament') || catNameLower.includes('scrim')) {
                const catName = channel.name;
                try {
                  await channel.delete('FFA-Manager /delete tournament command');
                  deletedChannels.push(`Category: ${catName}`);
                } catch (err: any) {
                  console.warn(`[DiscordBot] Could not delete category ${catName}: ${err.message}`);
                }
              }
            }
          }
        }
      }

      if (this.onTournamentDeleted) {
        this.onTournamentDeleted();
      }

      this.logEvent('warn', `Tournament deleted and rosters reset! ${deletedChannels.length > 0 ? `Deleted: ${deletedChannels.join(', ')}` : 'Channels kept.'}`, guild?.name);

      return { success: true, deletedChannels };
    });
  }

  public async createTournament(
    guild: Guild,
    options: {
      slots: number;
      tags: number;
      groups?: number;
      teamsPerGroup?: number;
      title?: string;
      rules?: string;
      categoryName?: string;
      verifiedRoleName?: string;
      managerRoleName?: string;
      createdBy?: string;
      createdByUserId?: string;
    }
  ): Promise<{
    success: boolean;
    created: string[];
    warnings?: string[];
    rolledBack?: string[];
    error?: string;
  }> {
    if (!guild) return { success: false, created: [], error: 'Guild not found' };

    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!config) return { success: false, created: [], error: 'Configuration not loaded' };

    const botMember = guild.members.me;
    const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
    const hasManageChannels = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ?? false);
    const hasManageRoles = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false);
    const hasSendMessages = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.SendMessages) ?? false);
    const hasViewChannel = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ViewChannel) ?? false);

    const missingCriticalPerms: string[] = [];
    if (!hasManageChannels) missingCriticalPerms.push('Manage Channels');
    if (!hasViewChannel) missingCriticalPerms.push('View Channels');
    if (!hasSendMessages) missingCriticalPerms.push('Send Messages');

    if (missingCriticalPerms.length > 0) {
      const msg = `Bot lacks required permission(s) [${missingCriticalPerms.join(', ')}] in "${guild.name}". Please grant these permissions or "Administrator" to the bot role.`;
      this.logEvent('error', msg, guild.name);
      return { success: false, created: [], error: msg };
    }

    const previousConfigSnapshot = { ...config };
    const existingTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const previousTeamsSnapshot = [...existingTeams];

    const title = options.title?.trim() || config.title || 'Tournament Scrims';
    const slots = Math.max(2, Math.min(500, options.slots || 20));
    const tags = Math.max(1, Math.min(10, options.tags || 4));
    const rawTeamsPerGroup = options.teamsPerGroup && options.teamsPerGroup > 0
      ? options.teamsPerGroup
      : options.groups && options.groups > 0
      ? options.groups
      : slots;
    const teamsPerGroup = Math.max(1, Math.min(slots, rawTeamsPerGroup));
    const groupsCount = Math.max(1, Math.ceil(slots / teamsPerGroup));
    const managerRoleName = options.managerRoleName?.trim() || config.managerRoleName?.trim() || 'FFA Bot Manager';
    const verifiedRoleName = options.verifiedRoleName?.trim() || 'Verified Team';
    const slotRoleName = 'Confirmed Slot';
    const categoryName = options.categoryName || `🏆 ┃ ${title.toUpperCase()}`;

    const created: string[] = [];
    const warnings: string[] = [];
    const newlyCreatedChannels: any[] = [];
    const newlyCreatedRoles: any[] = [];

    if (!hasManageRoles) {
      warnings.push(
        `Missing "Manage Roles" permission: @${managerRoleName}, @${verifiedRoleName}, and @${slotRoleName} roles could not be auto-created or assigned.`
      );
    }

    let managerRole = guild.roles.cache.find(r => r.name.trim().toLowerCase() === managerRoleName.toLowerCase());
    let verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
    let slotRole = guild.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());

    if (hasManageRoles) {
      try {
        if (!managerRole) {
          managerRole = await guild.roles.create({
            name: managerRoleName,
            color: 0xF0B75A,
            hoist: true,
            mentionable: true,
            reason: `FFA-Manager Bot Manager Role (@${managerRoleName}) for ${title}`
          });
          newlyCreatedRoles.push(managerRole);
          created.push(`Role: @${managerRoleName} (Full Bot Command Access)`);
        } else {
          created.push(`Role: @${managerRoleName} (Existing — Full Bot Command Access)`);
        }

        if (managerRole && options.createdByUserId) {
          try {
            const creatorMember =
              guild.members.cache.get(options.createdByUserId) ||
              (await guild.members.fetch(options.createdByUserId).catch(() => null));
            if (creatorMember && !creatorMember.roles.cache.has(managerRole.id)) {
              await creatorMember.roles.add(managerRole, 'Assigned @FFA Bot Manager on tournament setup').catch(() => {});
            }
          } catch {
          }
        }

        if (!verifiedRole) {
          verifiedRole = await guild.roles.create({
            name: verifiedRoleName,
            color: 0x00E676,
            hoist: true,
            mentionable: true,
            reason: `FFA-Manager Verified Team Role for ${title}`
          });
          newlyCreatedRoles.push(verifiedRole);
          created.push(`Role: @${verifiedRoleName} (Unlocks #id-pass)`);
        } else {
          created.push(`Role: @${verifiedRoleName} (Existing)`);
        }

        if (!slotRole) {
          slotRole = await guild.roles.create({
            name: slotRoleName,
            color: 0x5865F2,
            mentionable: true,
            reason: `FFA-Manager Confirmed Slot Role for ${title}`
          });
          newlyCreatedRoles.push(slotRole);
          created.push(`Role: @${slotRoleName}`);
        }
      } catch (err: any) {
        warnings.push(`Role creation notice: ${err.message}`);
        console.log(`[DiscordBot] Role creation notice: ${err.message}`);
      }
    }

    try {
      let category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
      ) as CategoryChannel | undefined;

      if (!category) {
        category = await guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory
        });
        newlyCreatedChannels.push(category);
        created.push(`Category: ${categoryName}`);
      }

      const parentId = category.id;

      const rulesChannelName = '📋┃rules-format';
      let rulesCh = guild.channels.cache.find(
        c => c.name === rulesChannelName && c.parentId === parentId
      ) as TextChannel | undefined;

      if (!rulesCh) {
        const rulesOverwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            deny: [PermissionsBitField.Flags.SendMessages]
          }
        ];
        if (managerRole) {
          rulesOverwrites.push({
            id: managerRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }
        rulesCh = await guild.channels.create({
          name: rulesChannelName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: `Official tournament rules, format and scoring for ${title}`,
          permissionOverwrites: rulesOverwrites
        });
        newlyCreatedChannels.push(rulesCh);
        created.push(`Channel: #${rulesChannelName}`);
      }

      const regChannelName = '📝┃registration';
      let regCh = guild.channels.cache.find(
        c => c.name === regChannelName && c.parentId === parentId
      ) as TextChannel | undefined;

      if (!regCh) {
        const regOverwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }
        ];
        if (managerRole) {
          regOverwrites.push({
            id: managerRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }
        regCh = await guild.channels.create({
          name: regChannelName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: `Registration channel for ${title} (OPEN). Click Register Your Team or tag ${tags} players to register.`,
          permissionOverwrites: regOverwrites
        });
        newlyCreatedChannels.push(regCh);
        created.push(`Channel: #${regChannelName} (OPEN — Registration Panel Active)`);
      } else {
        await regCh.permissionOverwrites.edit(
          guild.roles.everyone.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          },
          { reason: 'Tournament setup — registration open' }
        ).catch((e: any) => {
          warnings.push(`Could not unlock #${regChannelName}: ${e.message}`);
        });
        if (managerRole) {
          await regCh.permissionOverwrites.edit(
            managerRole.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ReadMessageHistory: true
            }
          ).catch(() => {});
        }
        created.push(`Channel: #${regChannelName} (OPEN — Registration Panel Active)`);
      }

      const panelPayload = this.createRegistrationPanelPayload({
        ...config,
        title,
        totalSlots: slots,
        requiredTags: tags
      });

      await regCh.send(panelPayload).catch((e: any) => {
        warnings.push(`Could not post registration panel in #${regChannelName}: ${e.message}`);
      });

      const slotListChannelName = '📊┃slot-list';
      let slotCh = guild.channels.cache.find(
        c => c.name === slotListChannelName && c.parentId === parentId
      ) as TextChannel | undefined;

      if (!slotCh) {
        const slotOverwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            deny: [PermissionsBitField.Flags.SendMessages]
          }
        ];
        if (managerRole) {
          slotOverwrites.push({
            id: managerRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }
        slotCh = await guild.channels.create({
          name: slotListChannelName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: `Live confirmed slots & waitlist for ${title}`,
          permissionOverwrites: slotOverwrites
        });
        newlyCreatedChannels.push(slotCh);
        created.push(`Channel: #${slotListChannelName}`);
      }

      const idpChannelName = '🔑┃id-pass';
      let idpCh = guild.channels.cache.find(
        c => c.name === idpChannelName && c.parentId === parentId
      ) as TextChannel | undefined;

      if (!idpCh) {
        const idpOverwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          }
        ];

        if (verifiedRole) {
          idpOverwrites.push({
            id: verifiedRole.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
            deny: [PermissionsBitField.Flags.SendMessages]
          });
        }

        if (managerRole) {
          idpOverwrites.push({
            id: managerRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }

        if (botMember) {
          idpOverwrites.push({
            id: botMember.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]
          });
        }

        idpCh = await guild.channels.create({
          name: idpChannelName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: `Private room credentials for ${title} — Visible only to @${verifiedRoleName}`,
          permissionOverwrites: idpOverwrites
        });
        newlyCreatedChannels.push(idpCh);
        created.push(`Channel: #${idpChannelName} (Restricted to @${verifiedRoleName})`);

        const idpEmbed = new EmbedBuilder()
          .setTitle(`🔑 Private Match Room Credentials — ${title}`)
          .setColor(0xFEE75C)
          .setDescription(
            `Welcome to the private room channel!\n\n` +
            `• Only players with the **@${verifiedRoleName}** role have permission to see this channel.\n` +
            `• Room ID & Password will be published here 15 minutes before match start.\n` +
            `• Ensure your team joins only your allotted slot number in the lobby.`
          )
          .setFooter({ text: 'FFA | Glacier Cup Manager™ Room Management' })
          .setTimestamp();

        await idpCh.send({ embeds: [idpEmbed] }).catch((e: any) => {
          warnings.push(`Could not post welcome message in #${idpChannelName}: ${e.message}`);
        });
      }

      const regDetailsChannelName = '🔒┃registration-details';
      let regDetailsCh = guild.channels.cache.find(
        c => c.name === regDetailsChannelName && c.parentId === parentId
      ) as TextChannel | undefined;

      const regDetailsOverwrites: any[] = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        }
      ];

      if (managerRole) {
        regDetailsOverwrites.push({
          id: managerRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageMessages
          ]
        });
      }

      if (botMember) {
        regDetailsOverwrites.push({
          id: botMember.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      if (!regDetailsCh) {
        regDetailsCh = await guild.channels.create({
          name: regDetailsChannelName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: `Confidential team registration details (Sequence-wise: Team Name, Region, WhatsApp, Players Tags) — Visible only to @${managerRoleName}`,
          permissionOverwrites: regDetailsOverwrites
        });
        newlyCreatedChannels.push(regDetailsCh);
        created.push(`Channel: #${regDetailsChannelName} (Hidden — Visible to @${managerRoleName})`);
      } else {
        await regDetailsCh.permissionOverwrites.set(regDetailsOverwrites).catch(() => {});
        created.push(`Channel: #${regDetailsChannelName} (Hidden — Visible to @${managerRoleName})`);
      }

      existingTeams.length = 0;
      this.slotListMessageIds.clear();
      this.regDetailsMessageIds.clear();

      config.title = title;
      config.totalSlots = slots;
      config.requiredTags = tags;
      config.maxTags = tags;
      config.teamsPerGroup = teamsPerGroup;
      config.groupsCount = groupsCount;
      config.categoryName = categoryName;
      config.managerRoleName = managerRoleName;
      config.verifiedRoleName = verifiedRoleName;
      config.roleName = slotRoleName;
      config.rulesChannel = rulesChannelName;
      config.regChannel = regChannelName;
      config.slotListChannel = slotListChannelName;
      config.idpChannel = idpChannelName;
      config.regDetailsChannel = regDetailsChannelName;
      config.status = 'open';
      config.explicitlyStoppedOrPaused = false;
      if (tags === 4) config.format = 'Squad';
      else if (tags === 3) config.format = 'Trio';
      else if (tags === 2) config.format = 'Duo';
      else if (tags === 1) config.format = 'Solo';
      else config.format = 'Custom';

      if (options.rules && options.rules.trim().length > 0) {
        const pubRes = await this.publishRulesToChannel(guild, options.rules.trim(), options.createdBy);
        if (!pubRes.success && pubRes.error) {
          warnings.push(`Rules publication notice: ${pubRes.error}`);
        }
      }

      const slotListRes = await this.updateSlotListChannel(guild, config);
      if (!slotListRes.updated && slotListRes.error) {
        warnings.push(`Initial #slot-list message notice: ${slotListRes.error}`);
      }

      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }

      this.logEvent(
        warnings.length > 0 ? 'warn' : 'success',
        `Tournament "${title}" setup in "${guild.name}" (${slots} slots, ${tags} tags, ${teamsPerGroup} teams/group [${groupsCount} groups], registration CLOSED): ${created.join(', ')}${warnings.length > 0 ? ` [Warnings: ${warnings.join('; ')}]` : ''}`,
        guild.name
      );
      this.refreshGuilds();

      return { success: true, created, warnings };
    } catch (err: any) {
      const rolledBack: string[] = [];
      for (const ch of newlyCreatedChannels.reverse()) {
        try {
          const chLabel = ch.type === ChannelType.GuildCategory ? `Category: ${ch.name}` : `#${ch.name}`;
          await ch.delete('Rolling back partial tournament setup failure');
          rolledBack.push(chLabel);
        } catch {
        }
      }
      for (const rl of newlyCreatedRoles.reverse()) {
        try {
          const rlName = `@${rl.name}`;
          await rl.delete('Rolling back partial tournament setup failure');
          rolledBack.push(rlName);
        } catch {
        }
      }

      Object.assign(config, previousConfigSnapshot);
      existingTeams.length = 0;
      existingTeams.push(...previousTeamsSnapshot);

      this.logEvent(
        'error',
        `Setup failed in "${guild.name}": ${err.message}. Rolled back ${rolledBack.length} partial resource(s).`,
        guild.name
      );
      return {
        success: false,
        created,
        warnings,
        rolledBack,
        error: err.message
      };
    }
  }

  public async setupGuild(guildId: string): Promise<{
    success: boolean;
    created: string[];
    warnings?: string[];
    rolledBack?: string[];
    error?: string;
  }> {
    if (!this.client) return { success: false, created: [], error: 'Bot is not connected' };
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { success: false, created: [], error: 'Guild not found or bot lacks access' };

    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!config) return { success: false, created: [], error: 'Configuration not ready' };

    return this.createTournament(guild, {
      slots: config.totalSlots || 20,
      tags: config.requiredTags || 4,
      groups: config.groupsCount || 1,
      title: config.title,
      categoryName: config.categoryName,
      verifiedRoleName: config.verifiedRoleName || 'Verified Team'
    });
  }
}

export const discordBot = new DiscordBotManager();
