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
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __botFilename = fileURLToPath(import.meta.url);
const __botDirname = path.dirname(__botFilename);

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

const EMOJI = {
  done: '<a:done:1470353529049845946>',
  alert: '<a:alertcircle:1470353569310965762>',
  divider: '<a:divider1:1469614109946282057>',
  dividerBar: '<a:divider1:1469614109946282057>'.repeat(8),
  giveaway: '<a:giveaway1:1477135683549265931>',
  golden: '<:golden4:1503940741108596837>',
  sword: '<:swordyellow:1503941574370001036>',
  admin: '<:rnx_admin_3:1503210259114889286>'
} as const;

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
  private pendingRulesPrompts = new Map<string, { guildId: string; channelId: string; tournamentId?: string; expiresAt: number }>();
  private pendingRegistrationDrafts = new Map<
    string,
    { region: 'India' | 'Bangladesh' | 'Pakistan'; regionSelected: boolean; playerIds: string[]; tournamentId?: string; updatedAt: number }
  >();
  private operationQueue: Promise<any> = Promise.resolve();
  private inFlightPlayerIds = new Set<string>();
  private slotListMessageIds = new Map<string, string[]>();
  private regDetailsMessageIds = new Map<string, string[]>();
  private slotListUpdateTimers = new Map<string, NodeJS.Timeout>();
  private cleanupTimers = new Set<NodeJS.Timeout>();
  private missingManageMessagesLogged = new Set<string>();
  private stayVoiceChannels = new Map<string, string>(); // guildId -> channelId
  private isReconnectingVoice = new Map<string, boolean>();

  public getPersistedBotData() {
    return {
      blacklist: this.blacklist,
      slotListMessageIds: Object.fromEntries(this.slotListMessageIds),
      regDetailsMessageIds: Object.fromEntries(this.regDetailsMessageIds),
      stayVoiceChannels: Object.fromEntries(this.stayVoiceChannels)
    };
  }

  public restorePersistedBotData(data: any) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.blacklist)) {
      this.blacklist = data.blacklist;
    }
    if (data.slotListMessageIds && typeof data.slotListMessageIds === 'object') {
      this.slotListMessageIds = new Map(
        Object.entries(data.slotListMessageIds).filter(([, v]) => Array.isArray(v)) as [string, string[]][]
      );
    }
    if (data.regDetailsMessageIds && typeof data.regDetailsMessageIds === 'object') {
      this.regDetailsMessageIds = new Map(
        Object.entries(data.regDetailsMessageIds).filter(([, v]) => Array.isArray(v)) as [string, string[]][]
      );
    }
    if (data.stayVoiceChannels && typeof data.stayVoiceChannels === 'object') {
      for (const [gId, chId] of Object.entries(data.stayVoiceChannels)) {
        if (typeof chId === 'string' && chId.trim().length > 0) {
          this.stayVoiceChannels.set(gId, chId.trim());
        }
      }
    }
  }

  public async withOperationLock<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.operationQueue.then(() => task());
    this.operationQueue = next.catch(() => {});
    return next;
  }

  private ensureGuildChannelMap(config: any, guildId: string) {
    if (!config) return null;
    if (!config.guildChannels || typeof config.guildChannels !== 'object') {
      config.guildChannels = {};
    }
    if (!config.guildChannels[guildId] || typeof config.guildChannels[guildId] !== 'object') {
      config.guildChannels[guildId] = {};
    }
    return config.guildChannels[guildId];
  }

  public ensureTournamentsRegistry(rootConfig?: any): Record<string, any> {
    const cfg = rootConfig || (this.getTournamentConfig ? this.getTournamentConfig() : null);
    if (!cfg) return {};
    if (!cfg.tournaments || typeof cfg.tournaments !== 'object') {
      cfg.tournaments = {};
    }
    if (
      Object.keys(cfg.tournaments).length === 0 &&
      (cfg.categoryId || cfg.regChannelId || cfg.slotListChannelId || (cfg.totalSlots && cfg.totalSlots > 0))
    ) {
      const initialId = cfg.id || 'tourney-initial';
      cfg.id = initialId;
      const snapshot = { ...cfg };
      delete snapshot.tournaments;
      cfg.tournaments[initialId] = snapshot;

      const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      for (const t of allTeams) {
        if (!t.tournamentId) {
          t.tournamentId = initialId;
        }
      }
    }
    return cfg.tournaments;
  }

  public getGuildTournaments(guildOrId?: Guild | string | null): any[] {
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!rootConfig) return [];
    const registry = this.ensureTournamentsRegistry(rootConfig);
    const all = Object.values(registry);
    if (!guildOrId) return all;
    const guildId = typeof guildOrId === 'string' ? guildOrId : guildOrId.id;
    const guildObj =
      typeof guildOrId === 'string'
        ? this.client?.guilds?.cache?.get(guildOrId)
        : guildOrId;
    return all.filter(
      (t: any) =>
        (guildId && t.guildId === guildId) ||
        (guildObj?.channels?.cache && t.categoryId && guildObj.channels.cache.has(t.categoryId)) ||
        (guildObj?.channels?.cache && t.regChannelId && guildObj.channels.cache.has(t.regChannelId))
    );
  }

  public syncTournamentToRootConfig(tConfig: any, makeActiveOnRoot: boolean = false) {
    if (!tConfig || !tConfig.id) return;
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!rootConfig) return;
    const registry = this.ensureTournamentsRegistry(rootConfig);
    const copy = { ...tConfig };
    delete copy.tournaments;
    registry[tConfig.id] = copy;

    if (makeActiveOnRoot || rootConfig.id === tConfig.id || !rootConfig.id) {
      const fieldsToSync = [
        'id',
        'guildId',
        'createdAt',
        'title',
        'totalSlots',
        'requiredTags',
        'maxTags',
        'teamsPerGroup',
        'groupsCount',
        'format',
        'status',
        'explicitlyStoppedOrPaused',
        'categoryId',
        'categoryName',
        'rulesChannelId',
        'rulesChannel',
        'regChannelId',
        'regChannel',
        'slotListChannelId',
        'slotListChannel',
        'idpChannelId',
        'idpChannel',
        'regDetailsChannelId',
        'regDetailsChannel',
        'managerRoleId',
        'managerRoleName',
        'verifiedRoleId',
        'verifiedRoleName',
        'slotRoleId',
        'roleName',
        'customRules'
      ];
      for (const f of fieldsToSync) {
        if (copy[f] !== undefined) {
          rootConfig[f] = copy[f];
        }
      }
    }
  }

  public reconcileActiveTournaments(): boolean {
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!rootConfig) return false;
    const registry = this.ensureTournamentsRegistry(rootConfig);
    const isBotReady = Boolean(this.client && this.client.isReady());
    let modified = false;

    if (isBotReady && this.client) {
      for (const [tid, t] of Object.entries(registry)) {
        if (!t) {
          delete registry[tid];
          modified = true;
          continue;
        }
        const guild = t.guildId
          ? this.client.guilds.cache.get(t.guildId)
          : Array.from(this.client.guilds.cache.values())[0];
        if (guild) {
          const hasAnyTrackedChannel = Boolean(
            (t.categoryId && guild.channels.cache.has(t.categoryId)) ||
              (t.regChannelId && guild.channels.cache.has(t.regChannelId)) ||
              (t.slotListChannelId && guild.channels.cache.has(t.slotListChannelId)) ||
              (t.rulesChannelId && guild.channels.cache.has(t.rulesChannelId)) ||
              (t.idpChannelId && guild.channels.cache.has(t.idpChannelId))
          );
          if (!hasAnyTrackedChannel) {
            delete registry[tid];
            modified = true;
          }
        }
      }
    }

    const remainingTourneys = (Object.values(registry) as any[]).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );

    if (remainingTourneys.length > 0) {
      const currentActiveExists = rootConfig.id && registry[rootConfig.id];
      if (!currentActiveExists) {
        this.syncTournamentToRootConfig(remainingTourneys[0], true);
        modified = true;
      }
      if (modified && this.onConfigUpdated) {
        this.onConfigUpdated();
      }
      return true;
    }

    let hasLiveLegacyChannel = false;
    if (isBotReady && this.client) {
      for (const [, g] of this.client.guilds.cache) {
        if (
          (rootConfig.categoryId && g.channels.cache.has(rootConfig.categoryId)) ||
          (rootConfig.regChannelId && g.channels.cache.has(rootConfig.regChannelId)) ||
          (rootConfig.slotListChannelId && g.channels.cache.has(rootConfig.slotListChannelId))
        ) {
          hasLiveLegacyChannel = true;
          break;
        }
      }
    }

    if (!hasLiveLegacyChannel && (isBotReady || (!rootConfig.id && !rootConfig.categoryId && !rootConfig.regChannelId))) {
      if (
        rootConfig.id !== '' ||
        rootConfig.totalSlots !== 0 ||
        rootConfig.status !== 'closed' ||
        !rootConfig.explicitlyStoppedOrPaused
      ) {
        rootConfig.id = '';
        rootConfig.totalSlots = 0;
        rootConfig.teamsPerGroup = 0;
        rootConfig.groupsCount = 0;
        rootConfig.status = 'closed';
        rootConfig.explicitlyStoppedOrPaused = true;
        rootConfig.categoryName = '';
        rootConfig.categoryId = '';
        rootConfig.rulesChannelId = '';
        rootConfig.regChannelId = '';
        rootConfig.slotListChannelId = '';
        rootConfig.idpChannelId = '';
        rootConfig.regDetailsChannelId = '';
        rootConfig.verifiedRoleId = '';
        rootConfig.slotRoleId = '';
        rootConfig.guildChannels = {};
        const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
        if (allTeams.length > 0) {
          allTeams.splice(0, allTeams.length);
        }
        modified = true;
      }
    }

    if (modified && this.onConfigUpdated) {
      this.onConfigUpdated();
    }
    return hasLiveLegacyChannel;
  }

  public resolveTournamentContext(
    guild?: Guild | null,
    channelId?: string | null,
    explicitTournamentId?: string | null
  ): any {
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (!rootConfig) return null;
    const registry = this.ensureTournamentsRegistry(rootConfig);
    const list = Object.values(registry);

    if (explicitTournamentId && explicitTournamentId !== 'default' && registry[explicitTournamentId]) {
      return registry[explicitTournamentId];
    }

    if (channelId) {
      const byDirectChannel = list.find(
        (t: any) =>
          t.regChannelId === channelId ||
          t.slotListChannelId === channelId ||
          t.rulesChannelId === channelId ||
          t.idpChannelId === channelId ||
          t.regDetailsChannelId === channelId ||
          t.categoryId === channelId
      );
      if (byDirectChannel) {
        return byDirectChannel;
      }

      if (guild) {
        const ch = guild.channels.cache.get(channelId) as any;
        if (ch?.parentId) {
          const byCategory = list.find((t: any) => t.categoryId && t.categoryId === ch.parentId);
          if (byCategory) {
            return byCategory;
          }
        }
      }
    }

    if (guild) {
      const guildTourneys = this.getGuildTournaments(guild);
      if (guildTourneys.length > 0) {
        if (rootConfig.id) {
          const activeInGuild = guildTourneys.find((t: any) => t.id === rootConfig.id);
          if (activeInGuild) return activeInGuild;
        }
        return guildTourneys[guildTourneys.length - 1];
      }
    }

    if (rootConfig.id && registry[rootConfig.id]) {
      return registry[rootConfig.id];
    }

    return rootConfig;
  }

  public getTeamsForTournament(tConfig?: any): any[] {
    const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    for (let i = allTeams.length - 1; i >= 0; i--) {
      const cleanedExisting = (allTeams[i].teamName || '').replace(/^<\s*|\s*>$/g, '').trim().toLowerCase();
      if (cleanedExisting === 'team name' || cleanedExisting === 'your team' || cleanedExisting === 'your team name') {
        allTeams.splice(i, 1);
      }
    }
    if (!tConfig || !tConfig.id) {
      return allTeams;
    }
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const registry = rootConfig ? this.ensureTournamentsRegistry(rootConfig) : {};
    const tourneyCount = Object.keys(registry).length;

    return allTeams.filter((t: any) => {
      if (t.tournamentId) {
        return t.tournamentId === tConfig.id;
      }
      if (tConfig.regChannelId && t.channelId === tConfig.regChannelId) {
        return true;
      }
      return tourneyCount <= 1;
    });
  }

  public resolveTournamentCategory(guild: Guild | undefined | null, config: any): CategoryChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.categoryId || guildMap?.categoryId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.type === ChannelType.GuildCategory) {
        if (config && config.categoryName !== byId.name) {
          config.categoryName = byId.name;
        }
        return byId as CategoryChannel;
      }
    }

    const cfgCatName = (config?.categoryName || '').replace(/^🏆\s*┃?\s*/i, '').trim().toLowerCase();
    const cfgTitle = (config?.title || '').trim().toLowerCase();
    const found = guild.channels.cache.find(
      c =>
        c.type === ChannelType.GuildCategory &&
        ((cfgCatName &&
          (c.name.trim().toLowerCase() === cfgCatName ||
            c.name.replace(/^🏆\s*┃?\s*/i, '').trim().toLowerCase() === cfgCatName)) ||
          (cfgTitle &&
            (c.name.trim().toLowerCase() === cfgTitle ||
              c.name.replace(/^🏆\s*┃?\s*/i, '').trim().toLowerCase() === cfgTitle)))
    ) as CategoryChannel | undefined;

    if (found && config) {
      config.categoryId = found.id;
      config.categoryName = found.name;
    }
    return found;
  }

  public resolveRulesChannel(guild: Guild | undefined | null, config: any): TextChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.rulesChannelId || guildMap?.rulesChannelId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.isTextBased()) {
        if (config && config.rulesChannel !== byId.name) {
          config.rulesChannel = byId.name;
        }
        return byId as TextChannel;
      }
    }

    const candidates = new Set(
      [
        config?.rulesChannel,
        'tournament-rules',
        'rules-format',
        '📋┃rules-format',
        'rules'
      ]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase().replace(/^#/, ''))
    );

    const found = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (!config?.categoryId || c.parentId === config.categoryId) &&
        (c.id === config?.rulesChannel || candidates.has(c.name.toLowerCase()))
    ) as TextChannel | undefined;

    if (found && config) {
      config.rulesChannelId = found.id;
      config.rulesChannel = found.name;
    }
    return found;
  }

  public resolveRegistrationChannel(guild: Guild | undefined | null, config: any): TextChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.regChannelId || guildMap?.regChannelId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.isTextBased()) {
        if (config && config.regChannel !== byId.name) {
          config.regChannel = byId.name;
        }
        return byId as TextChannel;
      }
    }

    const candidates = new Set(
      [
        config?.regChannel,
        'tournament-registration',
        'registration',
        '📝┃registration'
      ]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase().replace(/^#/, ''))
    );

    const found = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (!config?.categoryId || c.parentId === config.categoryId) &&
        (c.id === config?.regChannel || candidates.has(c.name.toLowerCase()))
    ) as TextChannel | undefined;

    if (found && config) {
      config.regChannelId = found.id;
      config.regChannel = found.name;
    }
    return found;
  }

  public resolveSlotListChannel(guild: Guild | undefined | null, config: any): TextChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.slotListChannelId || guildMap?.slotListChannelId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.isTextBased()) {
        if (config && config.slotListChannel !== byId.name) {
          config.slotListChannel = byId.name;
        }
        return byId as TextChannel;
      }
    }

    const candidates = new Set(
      [
        config?.slotListChannel,
        'slot-list',
        '📊┃slot-list'
      ]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase().replace(/^#/, ''))
    );

    const found = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (!config?.categoryId || c.parentId === config.categoryId) &&
        (c.id === config?.slotListChannel || candidates.has(c.name.toLowerCase()))
    ) as TextChannel | undefined;

    if (found && config) {
      config.slotListChannelId = found.id;
      config.slotListChannel = found.name;
    }
    return found;
  }

  public resolveRegDetailsChannel(guild: Guild | undefined | null, config: any): TextChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.regDetailsChannelId || guildMap?.regDetailsChannelId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.isTextBased()) {
        if (config && config.regDetailsChannel !== byId.name) {
          config.regDetailsChannel = byId.name;
        }
        return byId as TextChannel;
      }
    }

    const candidates = new Set(
      [
        config?.regDetailsChannel,
        'registration-details',
        '🔒┃registration-details',
        '📋┃registration-details'
      ]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase().replace(/^#/, ''))
    );

    const found = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (!config?.categoryId || c.parentId === config.categoryId) &&
        (c.id === config?.regDetailsChannel || candidates.has(c.name.toLowerCase()))
    ) as TextChannel | undefined;

    if (found && config) {
      config.regDetailsChannelId = found.id;
      config.regDetailsChannel = found.name;
    }
    return found;
  }

  public resolveIdpChannel(guild: Guild | undefined | null, config: any): TextChannel | undefined {
    if (!guild) return undefined;
    const guildMap = config?.guildChannels?.[guild.id];
    const targetId = config?.idpChannelId || guildMap?.idpChannelId;
    if (targetId) {
      const byId = guild.channels.cache.get(targetId);
      if (byId && byId.isTextBased()) {
        if (config && config.idpChannel !== byId.name) {
          config.idpChannel = byId.name;
        }
        return byId as TextChannel;
      }
    }

    const candidates = new Set(
      [
        config?.idpChannel,
        'tournament-idp',
        'id-pass',
        '🔑┃id-pass'
      ]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase().replace(/^#/, ''))
    );

    const found = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        (!config?.categoryId || c.parentId === config.categoryId) &&
        (c.id === config?.idpChannel || candidates.has(c.name.toLowerCase()))
    ) as TextChannel | undefined;

    if (found && config) {
      config.idpChannelId = found.id;
      config.idpChannel = found.name;
    }
    return found;
  }

  public findUserTeamInTournament(userId: string, config: any) {
    const normId = this.normalizeMemberId(userId);
    if (!normId) return null;
    const teams = this.getTeamsForTournament(config);
    return (
      teams.find(t => this.normalizeMemberId(t.captain?.id) === normId) ||
      teams.find(t => this.getTeamMemberIds(t).has(normId)) ||
      null
    );
  }

  public createCaptainControlsRow(team: any, config: any) {
    const tId = config?.id || team?.tournamentId || '';
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`captain_edit_roster:${team.id}:${tId}`)
        .setLabel('✏️ Edit Roster')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`captain_cancel_slot:${team.id}:${tId}`)
        .setLabel('🗑️ Cancel My Slot')
        .setStyle(ButtonStyle.Danger)
    );
  }

  public createCaptainEditRosterModal(team: any, config: any) {
    const tags = Math.max(1, Math.min(10, config?.requiredTags || team?.players?.length || 4));
    const tId = config?.id || team?.tournamentId || '';
    const modal = new ModalBuilder()
      .setCustomId(`submit_captain_edit_roster:${team.id}:${tId}`)
      .setTitle(`✏️ Edit Roster — ${team.teamName}`.slice(0, 45));

    const teamNameLabel = new LabelBuilder()
      .setLabel('1. Team Name:')
      .setDescription('Keep or update your squad name')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('edit_team_name')
          .setStyle(TextInputStyle.Short)
          .setValue(String(team.teamName || '').slice(0, 60))
          .setMinLength(2)
          .setMaxLength(60)
          .setRequired(true)
      );

    const playersSelect = new UserSelectMenuBuilder()
      .setCustomId('edit_player_tags')
      .setPlaceholder(`Select ${tags} player${tags > 1 ? 's' : ''} for your roster`.slice(0, 150))
      .setMinValues(tags)
      .setMaxValues(tags)
      .setRequired(true);

    const existingPlayerIds = Array.isArray(team.players)
      ? team.players
          .map((p: any) => this.normalizeMemberId(p?.id))
          .filter((id: string) => isValidDiscordSnowflake(id))
          .slice(0, tags)
      : [];

    if (existingPlayerIds.length > 0) {
      playersSelect.setDefaultUsers(...existingPlayerIds);
    }

    const playersLabel = new LabelBuilder()
      .setLabel(`2. Updated Roster (${tags} Players):`.slice(0, 45))
      .setDescription(`Select the ${tags} players for your updated squad roster`.slice(0, 100))
      .setUserSelectMenuComponent(playersSelect);

    modal.addLabelComponents(teamNameLabel, playersLabel);
    return modal;
  }

  public async buildMyTeamPayload(guild: Guild | null | undefined, userId: string, config: any) {
    const team = this.findUserTeamInTournament(userId, config);
    if (!team) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.alert} No Registered Team Found`)
        .setColor(0xED4245)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `You (<@${userId}>) are not currently registered on any team in **${config?.title || 'this tournament'}**.\n` +
          `Head over to \`#${config?.regChannel || 'tournament-registration'}\` to register your squad!\n` +
          `${EMOJI.dividerBar}`
        )
        .setTimestamp();
      return { embeds: [notFoundEmbed], components: [] };
    }

    const isCaptain = this.normalizeMemberId(team.captain?.id) === this.normalizeMemberId(userId);
    const isRegOpen = config?.status === 'open' && !config?.explicitlyStoppedOrPaused;

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.golden} My Team Dashboard — ${team.teamName}`)
      .setColor(team.isWaitlist ? 0xFEE75C : 0x57F287)
      .setDescription(
        `${EMOJI.dividerBar}\n` +
        (isCaptain
          ? `${EMOJI.done} You are the **Team Captain** of **${team.teamName}**.\n` +
            (isRegOpen
              ? `Use the buttons below to **Edit Roster** (replace player tags) or **Cancel My Slot** while registration is open.`
              : `🔒 Registration is currently locked — self-service roster edits and slot cancellation are closed.`)
          : `You are a registered roster member of **${team.teamName}** (Captain: <@${team.captain.id}>). Only the Team Captain can edit the roster or cancel the slot.`) +
        `\n${EMOJI.dividerBar}`
      )
      .addFields(
        {
          name: `${EMOJI.golden} Slot Allocation`,
          value: team.isWaitlist ? `\`Waitlist #${team.slotNumber}\`` : `\`Slot #${team.slotNumber}\` (${team.group || 'Group A'})`,
          inline: true
        },
        { name: `${EMOJI.admin} Team Captain`, value: `<@${team.captain.id}>`, inline: true },
        { name: `${EMOJI.sword} Region`, value: `\`${team.region || 'India'}\``, inline: true },
        {
          name: `${EMOJI.done} Verified Roster (${(team.players || []).length} Players)`,
          value: (team.players || []).map((p: any, idx: number) => `${EMOJI.sword} \`${idx + 1}.\` <@${p.id}> (\`${p.displayName || p.username}\`)`).join('\n') || 'None',
          inline: false
        },
        {
          name: `${EMOJI.golden} Team Voice Channel & Role`,
          value: `${team.teamVoiceChannelId ? `🔊 <#${team.teamVoiceChannelId}>` : `\`${team.teamVoiceChannelName || team.teamName}\``} • ${team.teamRoleId ? `<@&${team.teamRoleId}>` : `\`@${team.teamRoleName || team.teamName}\``}`,
          inline: false
        }
      )
      .setFooter({ text: `Team ID: ${team.id} • FFA | Glacier Cup Manager™` })
      .setTimestamp();

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (isCaptain && isRegOpen) {
      components.push(this.createCaptainControlsRow(team, config));
    }
    if (guild && team.teamVoiceChannelId) {
      const voiceUrl = await this.resolveVoiceConnectUrl(guild, team.teamVoiceChannelId, team.teamVoiceInviteUrl);
      components.push(
        this.createVoiceConnectButtonRow(guild.id, team.teamVoiceChannelId, team.teamVoiceChannelName || team.teamName, voiceUrl)
      );
    }

    return { embeds: [embed], components };
  }

  public async handleCaptainEditRosterModal(interaction: ModalSubmitInteraction, team: any, config: any) {
    await interaction.deferReply({ ephemeral: true });

    const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
    const isCaptain = this.normalizeMemberId(team.captain?.id) === this.normalizeMemberId(interaction.user.id);
    if (!isCaptain && !isStaff) {
      await interaction.editReply('❌ Only the registered **Team Captain** (or tournament staff) can edit this team\'s roster.');
      return;
    }

    const isRegOpen = config?.status === 'open' && !config?.explicitlyStoppedOrPaused;
    if (!isRegOpen && !isStaff) {
      await interaction.editReply('🔒 **Registration is closed.** Roster changes are locked after registration closes.');
      return;
    }

    const updatedTeamName = (interaction.fields.getTextInputValue('edit_team_name') || team.teamName || '').trim();
    const rawPlayersField = (interaction.fields as any).fields?.get?.('edit_player_tags');
    let selectedModalUsers: any = null;
    let selectedModalMembers: any = null;
    const taggedUserIds: string[] = [];

    if (rawPlayersField && Array.isArray(rawPlayersField.values)) {
      try {
        selectedModalUsers = interaction.fields.getSelectedUsers('edit_player_tags');
        selectedModalMembers = interaction.fields.getSelectedMembers('edit_player_tags');
      } catch {
        selectedModalUsers = rawPlayersField.users || null;
        selectedModalMembers = rawPlayersField.members || null;
      }
      for (const uid of rawPlayersField.values) {
        if (uid && isValidDiscordSnowflake(uid) && !taggedUserIds.includes(uid)) {
          taggedUserIds.push(uid);
        }
      }
    }

    const playersList: any[] = [];
    for (const uid of taggedUserIds) {
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

      if (u) {
        if (config?.disallowBots && u.bot) {
          await interaction.editReply(`❌ **Tagcheck Notice:** Bot <@${u.id}> cannot be registered as a tournament player.`);
          return;
        }
        playersList.push({
          id: uid,
          username: u.username,
          displayName: fetchedMember?.displayName || fetchedMember?.nick || u.displayName || u.username,
          avatar: (typeof u.displayAvatarURL === 'function' ? u.displayAvatarURL() : null) || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          isBot: Boolean(u.bot)
        });
      } else {
        playersList.push({
          id: uid,
          username: `user_${uid.slice(-4)}`,
          displayName: `Player ${uid.slice(-4)}`,
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          isBot: false
        });
      }
    }

    const otherTeams = this.getTeamsForTournament(config).filter(t => t.id !== team.id);
    const validation = this.validateTeamRegistrationRoster({
      teamName: updatedTeamName,
      captainId: team.captain.id,
      players: playersList,
      config,
      existingTeams: otherTeams
    });

    if (!validation.valid) {
      await interaction.editReply(`❌ **${validation.error || 'Roster validation failed.'}**`);
      return;
    }

    const previousMemberIds = this.getTeamMemberIds(team);
    team.teamName = updatedTeamName;
    team.players = playersList.map(({ isBot, ...rest }) => rest);

    if (interaction.guild) {
      const newMemberIds = this.getTeamMemberIds(team);
      const removedIds = Array.from(previousMemberIds).filter(id => !newMemberIds.has(id));
      if (removedIds.length > 0) {
        const verifiedRole = config?.verifiedRoleId ? interaction.guild.roles.cache.get(config.verifiedRoleId) : undefined;
        const slotRole = config?.slotRoleId ? interaction.guild.roles.cache.get(config.slotRoleId) : undefined;
        const teamRole = team.teamRoleId ? interaction.guild.roles.cache.get(team.teamRoleId) : undefined;
        const rolesToRemove = [verifiedRole, slotRole, teamRole].filter(Boolean);
        for (const rId of removedIds) {
          if (!/^\d{15,20}$/.test(rId)) continue;
          const mem = interaction.guild.members.cache.get(rId) || (await interaction.guild.members.fetch(rId).catch(() => null));
          if (mem && rolesToRemove.length > 0) {
            await mem.roles.remove(rolesToRemove as any).catch(() => {});
          }
        }
      }
      await this.syncTeamRolesForRegistration(interaction.guild, team, config).catch(() => {});
    }

    if (this.onConfigUpdated) {
      this.onConfigUpdated();
    }
    await this.syncGuildChannels(config, interaction.guild).catch(() => {});

    const updatedEmbed = new EmbedBuilder()
      .setTitle(`${EMOJI.done} Team Roster Updated Successfully!`)
      .setColor(0x57F287)
      .setDescription(
        `${EMOJI.dividerBar}\n` +
        `Your roster for **${team.teamName}** (${team.isWaitlist ? `Waitlist #${team.slotNumber}` : `Slot #${team.slotNumber} • ${team.group || 'Group A'}`}) has been updated and synced across \`#slot-list\`, \`#registration-details\`, and your private team voice channel!\n` +
        `${EMOJI.dividerBar}`
      )
      .addFields({
        name: `${EMOJI.done} Updated Roster (${team.players.length} Players)`,
        value: team.players.map((p: any, i: number) => `${EMOJI.sword} \`${i + 1}.\` <@${p.id}>`).join('\n'),
        inline: false
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [updatedEmbed] });
  }

  public normalizeMemberId(raw: unknown): string {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
    if (mentionMatch) return mentionMatch[1];
    return trimmed.replace(/^@/, '').trim();
  }

  public getTeamMemberIds(team: any): Set<string> {
    const ids = new Set<string>();
    if (!team) return ids;
    const capId = this.normalizeMemberId(team.captain?.id);
    if (capId) ids.add(capId);
    if (Array.isArray(team.players)) {
      for (const p of team.players) {
        const pid = this.normalizeMemberId(p?.id);
        if (pid) ids.add(pid);
      }
    }
    return ids;
  }

  public isMemberInFlight(memberIds: Iterable<string>): string | null {
    for (const rawId of memberIds) {
      const id = this.normalizeMemberId(rawId);
      if (id && this.inFlightPlayerIds.has(id)) {
        return id;
      }
    }
    return null;
  }

  public markMembersInFlight(memberIds: Iterable<string>, inFlight: boolean): void {
    for (const rawId of memberIds) {
      const id = this.normalizeMemberId(rawId);
      if (!id) continue;
      if (inFlight) {
        this.inFlightPlayerIds.add(id);
      } else {
        this.inFlightPlayerIds.delete(id);
      }
    }
  }

  public async resolveSubmittedPlayer(
    rawPlayer: any,
    guild?: Guild | null,
    existingTeams: any[] = []
  ): Promise<{ id: string; username: string; displayName: string; avatar: string; isBot?: boolean } | null> {
    if (!rawPlayer) return null;
    const rawId = typeof rawPlayer === 'string' ? rawPlayer : (rawPlayer.id || '');
    const rawUsername = typeof rawPlayer === 'string' ? rawPlayer : (rawPlayer.username || rawPlayer.displayName || rawId);
    const rawDisplay = typeof rawPlayer === 'string' ? rawPlayer : (rawPlayer.displayName || rawPlayer.username || rawId);

    const candidateId = this.normalizeMemberId(rawId);
    const candidateName = String(rawUsername || '').replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '').trim();
    const candidateNameLower = candidateName.toLowerCase();

    if (/^\d{15,20}$/.test(candidateId)) {
      const member =
        guild?.members.cache.get(candidateId) ||
        (guild ? await guild.members.fetch(candidateId).catch(() => null) : null);
      const user =
        member?.user ||
        this.client?.users.cache.get(candidateId) ||
        (await this.client?.users.fetch(candidateId).catch(() => null));
      if (user) {
        return {
          id: user.id,
          username: user.username,
          displayName: member?.displayName || user.displayName || user.username,
          avatar: user.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`,
          isBot: Boolean(user.bot)
        };
      }
      return {
        id: candidateId,
        username: candidateName && !/^\d+$/.test(candidateName) ? candidateName : `user_${candidateId.slice(-4)}`,
        displayName: rawDisplay && !/^\d+$/.test(String(rawDisplay)) ? String(rawDisplay).replace(/^@/, '') : `Player ${candidateId.slice(-4)}`,
        avatar: rawPlayer?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${candidateId}`,
        isBot: false
      };
    }

    if (/^\d{15,20}$/.test(candidateName)) {
      return this.resolveSubmittedPlayer({ ...rawPlayer, id: candidateName }, guild, existingTeams);
    }

    if (candidateNameLower) {
      for (const team of existingTeams) {
        if (
          team.captain &&
          (String(team.captain.username || '').toLowerCase() === candidateNameLower ||
            String(team.captain.displayName || '').toLowerCase() === candidateNameLower)
        ) {
          const cid = this.normalizeMemberId(team.captain.id);
          if (cid) {
            return {
              id: cid,
              username: team.captain.username || candidateName,
              displayName: team.captain.displayName || team.captain.username || candidateName,
              avatar: team.captain.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${cid}`,
              isBot: false
            };
          }
        }
        for (const p of team.players || []) {
          if (
            String(p.username || '').toLowerCase() === candidateNameLower ||
            String(p.displayName || '').toLowerCase() === candidateNameLower
          ) {
            const pid = this.normalizeMemberId(p.id);
            if (pid) {
              return {
                id: pid,
                username: p.username || candidateName,
                displayName: p.displayName || p.username || candidateName,
                avatar: p.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${pid}`,
                isBot: false
              };
            }
          }
        }
      }
    }

    if (guild && candidateNameLower) {
      let foundMember = guild.members.cache.find(
        m =>
          m.user.username.toLowerCase() === candidateNameLower ||
          m.displayName.toLowerCase() === candidateNameLower ||
          m.user.globalName?.toLowerCase() === candidateNameLower
      );
      if (!foundMember) {
        const searched = await guild.members.fetch({ query: candidateName, limit: 5 }).catch(() => null);
        foundMember = searched?.find(
          m =>
            m.user.username.toLowerCase() === candidateNameLower ||
            m.displayName.toLowerCase() === candidateNameLower ||
            m.user.globalName?.toLowerCase() === candidateNameLower
        );
      }
      if (foundMember) {
        return {
          id: foundMember.id,
          username: foundMember.user.username,
          displayName: foundMember.displayName || foundMember.user.displayName || foundMember.user.username,
          avatar: foundMember.user.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${foundMember.id}`,
          isBot: Boolean(foundMember.user.bot)
        };
      }
    }

    const fallbackId = candidateId && !candidateId.startsWith('ply-') ? candidateId : candidateNameLower;
    if (!fallbackId) return null;

    return {
      id: fallbackId,
      username: candidateName || fallbackId,
      displayName: String(rawDisplay || candidateName || fallbackId).replace(/^@/, ''),
      avatar: rawPlayer?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fallbackId)}`,
      isBot: false
    };
  }

  public validateTeamRegistrationRoster(params: {
    teamName: string;
    captainId: string;
    players: { id: string; username?: string; displayName?: string; isBot?: boolean }[];
    config: any;
    existingTeams: any[];
  }): { valid: boolean; code?: string; error?: string } {
    const { teamName, captainId, players, config, existingTeams } = params;
    const cleanedName = (teamName || '').replace(/<@!?\d+>/g, '').replace(/^<\s*|\s*>$/g, '').trim();
    const lowerName = cleanedName.toLowerCase();

    const reservedNames = new Set([
      'team name',
      'your team',
      'your team name',
      '@everyone',
      'everyone',
      'here',
      'ffa bot manager',
      (config?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase(),
      (config?.verifiedRoleName || 'Verified Team').trim().toLowerCase(),
      (config?.roleName || 'Confirmed Slot').trim().toLowerCase()
    ]);

    if (!cleanedName || cleanedName.length < 2 || reservedNames.has(lowerName)) {
      return {
        valid: false,
        code: 'INVALID_TEAM_NAME',
        error: 'Invalid Team Name: Please specify a valid, unique team name (at least 2 characters).'
      };
    }

    const duplicateTeamByName = existingTeams.find(t => (t.teamName || '').trim().toLowerCase() === lowerName);
    if (duplicateTeamByName) {
      const slotDesc = duplicateTeamByName.isWaitlist
        ? `Waitlist #${duplicateTeamByName.slotNumber}`
        : `Slot #${duplicateTeamByName.slotNumber}`;
      return {
        valid: false,
        code: 'DUPLICATE_TEAM_NAME',
        error: `Team name **${duplicateTeamByName.teamName}** is already registered in ${slotDesc}.`
      };
    }

    const reqTags = Math.max(1, config?.requiredTags || 4);
    if (!Array.isArray(players) || players.length < reqTags) {
      return {
        valid: false,
        code: 'INSUFFICIENT_TAGS',
        error: `Tagcheck Notice: Exactly **${reqTags} players** are required for ${config?.format || 'this tournament'} (as configured during \`/setup\`). You provided **${players ? players.length : 0}**.`
      };
    }

    if (players.length > reqTags) {
      return {
        valid: false,
        code: 'EXCESSIVE_TAGS',
        error: `Tagcheck Notice: Only **${reqTags} players** are allowed per team (as configured during \`/setup\` — no extra players or tags). You provided **${players.length}**.`
      };
    }

    const seenInSubmittedPlayers = new Set<string>();
    const normalizedPlayerIds: string[] = [];

    for (const p of players) {
      const pid = this.normalizeMemberId(p?.id);
      if (!pid) {
        return {
          valid: false,
          code: 'INVALID_PLAYER_ID',
          error: 'EasyTag Notice: Every player in the roster must have a valid Discord user ID.'
        };
      }
      if (config?.disallowBots && p?.isBot) {
        return {
          valid: false,
          code: 'BOT_TAGGED',
          error: `Tagcheck Notice: Bot <@${pid}> cannot be registered as a tournament player.`
        };
      }
      if (seenInSubmittedPlayers.has(pid)) {
        const label = /^\d{15,20}$/.test(pid) ? `<@${pid}>` : `@${p?.displayName || p?.username || pid}`;
        return {
          valid: false,
          code: 'DUPLICATE_PLAYERS_IN_TEAM',
          error: `Tagcheck Notice: Duplicate member ${label} detected within the same team roster. Every player in a team must be a unique Discord user!`
        };
      }
      seenInSubmittedPlayers.add(pid);
      normalizedPlayerIds.push(pid);
    }

    const normCaptainId = this.normalizeMemberId(captainId) || normalizedPlayerIds[0] || '';
    const allSubmittedMemberIds = Array.from(new Set([normCaptainId, ...normalizedPlayerIds].filter(Boolean)));

    for (const memberId of allSubmittedMemberIds) {
      const banned = this.blacklist.find(b => this.normalizeMemberId(b.userId) === memberId);
      if (banned) {
        const label = /^\d{15,20}$/.test(memberId) ? `<@${memberId}>` : `@${banned.username || memberId}`;
        return {
          valid: false,
          code: 'PLAYER_BLACKLISTED',
          error: `Tagcheck Notice: Member ${label} is currently **BLACKLISTED** from this tournament (Reason: *${banned.reason}*).`
        };
      }
    }

    const inFlightId = this.isMemberInFlight(allSubmittedMemberIds);
    if (inFlightId) {
      const label = /^\d{15,20}$/.test(inFlightId) ? `<@${inFlightId}>` : `@${inFlightId}`;
      return {
        valid: false,
        code: 'MEMBER_IN_FLIGHT',
        error: `Tagcheck Notice: Member ${label} is currently being processed in another simultaneous registration request.`
      };
    }

    for (const existingTeam of existingTeams) {
      const existingMemberIds = this.getTeamMemberIds(existingTeam);
      const slotLabel = existingTeam.isWaitlist
        ? `Waitlist #${existingTeam.slotNumber}`
        : `Slot #${existingTeam.slotNumber}${existingTeam.group ? ` (${existingTeam.group})` : ''}`;

      if (normCaptainId && existingMemberIds.has(normCaptainId)) {
        const isExistingCaptain = this.normalizeMemberId(existingTeam.captain?.id) === normCaptainId;
        const roleLabel = isExistingCaptain ? 'the captain of' : 'a registered player in';
        const mention = /^\d{15,20}$/.test(normCaptainId) ? `<@${normCaptainId}>` : `@${normCaptainId}`;
        return {
          valid: false,
          code: 'MEMBER_ALREADY_IN_TEAM',
          error: `Tagcheck Notice: ${mention} is already registered as ${roleLabel} **${existingTeam.teamName}** (${slotLabel}). A member can belong to only one team until their existing registration is deleted!`
        };
      }

      for (const p of players) {
        const pid = this.normalizeMemberId(p.id);
        if (pid && existingMemberIds.has(pid)) {
          const isExistingCaptain = this.normalizeMemberId(existingTeam.captain?.id) === pid;
          const roleLabel = isExistingCaptain ? 'the captain of' : 'a registered player in';
          const mention = /^\d{15,20}$/.test(pid) ? `<@${pid}>` : `@${p.displayName || p.username || pid}`;
          return {
            valid: false,
            code: 'PLAYER_ALREADY_REGISTERED',
            error: `Tagcheck Notice: Player ${mention} is already registered as ${roleLabel} **${existingTeam.teamName}** (${slotLabel}). One member can belong to only one team!`
          };
        }
      }
    }

    return { valid: true };
  }

  public async syncTeamRolesForRegistration(guild: Guild, team: any, config: any): Promise<string[]> {
    const warnings: string[] = [];
    if (!guild || !team) return warnings;

    const allMemberIds = Array.from(this.getTeamMemberIds(team));
    if (!team.isWaitlist) {
      const verifiedRoleName = config?.verifiedRoleName || 'Verified Team';
      const slotRoleName = config?.roleName || 'Confirmed Slot';
      const verifiedRole =
        (config?.verifiedRoleId ? guild.roles.cache.get(config.verifiedRoleId) : undefined) ||
        guild.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
      const slotRole =
        (config?.slotRoleId ? guild.roles.cache.get(config.slotRoleId) : undefined) ||
        guild.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());
      const rolesToAdd = [verifiedRole, slotRole].filter(Boolean);

      if (rolesToAdd.length > 0) {
        for (const uid of allMemberIds) {
          if (!/^\d{15,20}$/.test(uid)) continue;
          try {
            const member = guild.members.cache.get(uid) || (await guild.members.fetch(uid).catch(() => null));
            if (member) {
              await member.roles.add(rolesToAdd as any).catch((err: any) => {
                warnings.push(`Could not assign tournament roles to <@${uid}>: ${err.message}`);
              });
            }
          } catch {
          }
        }
      }
    }

    if (config?.autoCreateTeamVoice !== false) {
      const wsResult = await this.provisionTeamWorkspace(guild, team, allMemberIds, config);
      if (wsResult.warnings.length > 0) {
        warnings.push(...wsResult.warnings);
      }
      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }
    }

    return warnings;
  }

  public async syncGuildChannels(config: any, targetGuild?: Guild | null): Promise<void> {
    if (!config) return;
    const guilds = targetGuild
      ? [targetGuild]
      : this.client
      ? Array.from(this.client.guilds.cache.values())
      : [];

    for (const g of guilds) {
      await this.updateSlotListChannel(g, config).catch(() => {});
    }
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
      .setTitle(`${EMOJI.giveaway} ${title}`)
      .setColor(0xF59E0B)
      .setDescription(
        `${EMOJI.dividerBar}\n` +
        `${EMOJI.sword} **Official Tournament Registration is OPEN!**\n` +
        `Tap **Register Your Team** below to submit your squad and claim your slot.\n\n` +
        `${EMOJI.golden} **Total Capacity:** \`${slots} Slots\`\n` +
        `${EMOJI.golden} **Required Roster:** \`${tags} Players / Team\`\n` +
        `${EMOJI.done} **Instant Verification:** Auto-assigns team role & private voice channel\n` +
        `${EMOJI.dividerBar}`
      )
      .setFooter({ text: `GLACIER CUP • ${title}` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(config?.id ? `register_team_panel_btn:${config.id}` : 'register_team_panel_btn')
        .setLabel('Register Your Team')
        .setEmoji('🏆')
        .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [panelEmbed], components: [row] };
  }

  public async sendRegistrationPanel(guild: Guild, config: any): Promise<{ success: boolean; channelName?: string; error?: string }> {
    const regCh = this.resolveRegistrationChannel(guild, config);

    if (!regCh) {
      return { success: false, error: `Registration channel (#${config?.regChannel || 'tournament-registration'}) not found.` };
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
      .setTitle(`${EMOJI.giveaway} ${title} — Team Registration`)
      .setColor(0xF59E0B)
      .setDescription(
        `${EMOJI.dividerBar}\n` +
        `Select your **Region** from the dropdown below (and optionally pre-select your **${tags} Players Tags**) to open the registration form:\n\n` +
        `${EMOJI.sword} **Team Name:** Required (Unique team name)\n` +
        `${EMOJI.golden} **Region:** \`${draft?.regionSelected ? `${currentRegion} (${countryCode})` : 'Select from dropdown (India, Bangladesh, Pakistan)'}\`\n` +
        `${EMOJI.golden} **WhatsApp No:** Auto-prefixed with \`${countryCode}\` when **${currentRegion}** is selected\n` +
        `${EMOJI.admin} **Players Tags:** **Exactly ${tags} players required** *(as set during setup)*` +
        (selectedPlayers.length > 0
          ? `\n\n${EMOJI.done} **Pre-selected Players (${selectedPlayers.length}/${tags}):** ${selectedPlayers.map(id => `<@${id}>`).join(', ')}`
          : '') +
        `\n${EMOJI.dividerBar}`
      )
      .setFooter({ text: 'Selecting a Region opens the Team Registration form with your country code pre-filled' });

    const tourneySuffix = config?.id ? `:${config.id}` : '';
    const regionSelect = new StringSelectMenuBuilder()
      .setCustomId(`reg_region_select${tourneySuffix}`)
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
      .setCustomId(`reg_players_select${tourneySuffix}`)
      .setPlaceholder(`👥 Players Tags: Select ${tags} players (Set in setup)`)
      .setMinValues(1)
      .setMaxValues(tags);

    const openModalBtn = new ButtonBuilder()
      .setCustomId(`reg_open_modal_btn${tourneySuffix}`)
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
    const modalCustomId = config?.id
      ? `submit_team_reg_modal:${region}:${config.id}`
      : `submit_team_reg_modal:${region}`;
    const modal = new ModalBuilder()
      .setCustomId(modalCustomId)
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

  private createRulesButtonRow(tournamentId?: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(tournamentId ? `open_rules_modal:${tournamentId}` : 'open_rules_modal')
        .setLabel('📜 Enter & Post Rules to #tournament-rules')
        .setStyle(ButtonStyle.Primary)
    );
  }

  private createDeleteConfirmRow(deleteChannels: boolean, tournamentId?: string) {
    const suffix = tournamentId ? `:${tournamentId}` : '';
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_delete_tourney:${deleteChannels ? '1' : '0'}${suffix}`)
        .setLabel('🗑️ Confirm Delete Tournament')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete_tourney')
        .setLabel('✖️ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  private createRulesModal(existingRules?: string, tournamentId?: string) {
    const modal = new ModalBuilder()
      .setCustomId(tournamentId ? `submit_rules_modal:${tournamentId}` : 'submit_rules_modal')
      .setTitle('Tournament Rules & Format');

    const rulesInput = new TextInputBuilder()
      .setCustomId('rules_text')
      .setLabel('Enter Rules & Format to post in #tournament-rules')
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
    authorName?: string,
    targetConfig?: any
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    const config = targetConfig || this.resolveTournamentContext(guild, null);
    if (config) {
      config.customRules = rulesText;
      this.syncTournamentToRootConfig(config);
      if (this.onConfigUpdated) this.onConfigUpdated();
    }
    const title = config?.title || `${guild.name} Tournament`;

    let rulesCh = this.resolveRulesChannel(guild, config);

    if (!rulesCh) {
      const category = this.resolveTournamentCategory(guild, config);

      try {
        rulesCh = await guild.channels.create({
          name: 'tournament-rules',
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
        if (config) {
          config.rulesChannelId = rulesCh.id;
          config.rulesChannel = rulesCh.name;
          this.syncTournamentToRootConfig(config);
          if (this.onConfigUpdated) this.onConfigUpdated();
        }
      } catch (err: any) {
        return { success: false, error: `Could not find or create #tournament-rules: ${err.message}` };
      }
    }

    try {
      const rulesEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.admin} ${title} — Official Tournament Rulebook`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n${rulesText}\n${EMOJI.dividerBar}`)
        .setFooter({ text: authorName ? `Published by @${authorName} • FFA-Manager` : 'FFA-Manager' })
        .setTimestamp();

      await rulesCh.send({ embeds: [rulesEmbed] });
      this.logEvent('success', `Published custom tournament rules to #${rulesCh.name} (${title})`, guild.name);
      return { success: true, channelId: rulesCh.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public getAvailableTextChannels(guildId?: string): Array<{
    id: string;
    name: string;
    guildId: string;
    guildName: string;
    isRulesChannel: boolean;
  }> {
    if (!this.client || !this.client.isReady()) return [];
    const channels: Array<{
      id: string;
      name: string;
      guildId: string;
      guildName: string;
      isRulesChannel: boolean;
    }> = [];

    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const rulesNames = new Set([
      'rules',
      'tournament-rules',
      'rules-format',
      '📋┃rules-format',
      (rootConfig?.rulesChannel || '').toLowerCase()
    ]);

    const targetGuilds = guildId
      ? [this.client.guilds.cache.get(guildId)].filter(Boolean)
      : Array.from(this.client.guilds.cache.values());

    for (const g of targetGuilds) {
      if (!g) continue;
      for (const [, ch] of g.channels.cache) {
        if (ch.isTextBased() && ch.type === ChannelType.GuildText) {
          const cleanName = ch.name.toLowerCase().replace(/^[^\w]+/, '');
          const isRules =
            ch.id === rootConfig?.rulesChannelId ||
            rulesNames.has(ch.name.toLowerCase()) ||
            cleanName.includes('rule');

          channels.push({
            id: ch.id,
            name: ch.name,
            guildId: g.id,
            guildName: g.name,
            isRulesChannel: isRules
          });
        }
      }
    }

    return channels.sort((a, b) =>
      a.isRulesChannel === b.isRulesChannel ? a.name.localeCompare(b.name) : a.isRulesChannel ? -1 : 1
    );
  }

  public async sendCustomEmbed(payload: {
    channelId?: string;
    guildId?: string;
    content?: string;
    embed: {
      title?: string;
      description?: string;
      url?: string;
      color?: string | number;
      author?: {
        name?: string;
        icon_url?: string;
        url?: string;
      };
      thumbnail?: {
        url?: string;
      };
      image?: {
        url?: string;
      };
      footer?: {
        text?: string;
        icon_url?: string;
      };
      timestamp?: boolean | string;
      fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
      }>;
    };
    tournamentId?: string;
  }): Promise<{
    success: boolean;
    channelId?: string;
    channelName?: string;
    messageId?: string;
    error?: string;
  }> {
    if (!this.client || !this.client.isReady()) {
      return { success: false, error: 'Discord bot is offline. Please ensure bot token is configured and bot is online.' };
    }

    let targetChannel: TextChannel | null = null;
    let targetGuild: Guild | null = null;

    if (payload.channelId) {
      try {
        const ch =
          this.client.channels.cache.get(payload.channelId) ||
          (await this.client.channels.fetch(payload.channelId).catch(() => null));
        if (ch && ch.isTextBased() && 'guild' in ch) {
          targetChannel = ch as TextChannel;
          targetGuild = ch.guild as Guild;
        }
      } catch {
        // continue
      }
    }

    if (!targetChannel) {
      const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const targetConfig =
        payload.tournamentId && rootConfig?.tournaments?.[payload.tournamentId]
          ? rootConfig.tournaments[payload.tournamentId]
          : rootConfig;

      const guild = payload.guildId
        ? this.client.guilds.cache.get(payload.guildId)
        : this.client.guilds.cache.first();

      if (!guild) {
        return { success: false, error: 'No Discord servers found where this bot is present.' };
      }

      targetGuild = guild;
      targetChannel = this.resolveRulesChannel(guild, targetConfig) || null;

      if (!targetChannel) {
        const textCh = guild.channels.cache.find(
          c => c.isTextBased() && c.type === ChannelType.GuildText
        ) as TextChannel | undefined;
        if (textCh) {
          targetChannel = textCh;
        } else {
          return { success: false, error: `Could not find a text channel in "${guild.name}" to publish the embed.` };
        }
      }
    }

    try {
      const eData = payload.embed || {};
      const embed = new EmbedBuilder();

      if (eData.title && eData.title.trim()) {
        embed.setTitle(eData.title.trim().slice(0, 256));
      }

      if (eData.description && eData.description.trim()) {
        embed.setDescription(eData.description.trim().slice(0, 4096));
      }

      if (eData.url && eData.url.trim() && /^https?:\/\//i.test(eData.url.trim())) {
        embed.setURL(eData.url.trim());
      }

      let parsedColor = 0x38BDF8;
      if (eData.color !== undefined && eData.color !== null) {
        if (typeof eData.color === 'number') {
          parsedColor = eData.color;
        } else if (typeof eData.color === 'string') {
          const hex = eData.color.replace(/^#/, '').trim();
          const num = parseInt(hex, 16);
          if (!isNaN(num)) parsedColor = num;
        }
      }
      embed.setColor(parsedColor);

      if (eData.author?.name?.trim()) {
        embed.setAuthor({
          name: eData.author.name.trim().slice(0, 256),
          iconURL: eData.author.icon_url?.trim() || undefined,
          url: eData.author.url?.trim() || undefined
        });
      }

      if (eData.thumbnail?.url?.trim() && /^https?:\/\//i.test(eData.thumbnail.url.trim())) {
        embed.setThumbnail(eData.thumbnail.url.trim());
      }

      if (eData.image?.url?.trim() && /^https?:\/\//i.test(eData.image.url.trim())) {
        embed.setImage(eData.image.url.trim());
      }

      if (eData.footer?.text?.trim()) {
        embed.setFooter({
          text: eData.footer.text.trim().slice(0, 2048),
          iconURL: eData.footer.icon_url?.trim() || undefined
        });
      }

      if (eData.timestamp) {
        if (typeof eData.timestamp === 'string') {
          const d = new Date(eData.timestamp);
          embed.setTimestamp(!isNaN(d.getTime()) ? d : new Date());
        } else {
          embed.setTimestamp();
        }
      }

      if (Array.isArray(eData.fields)) {
        for (const f of eData.fields.slice(0, 25)) {
          if (f.name && f.name.trim() && f.value && f.value.trim()) {
            embed.addFields({
              name: f.name.trim().slice(0, 256),
              value: f.value.trim().slice(0, 1024),
              inline: Boolean(f.inline)
            });
          }
        }
      }

      const sendOptions: any = { embeds: [embed] };
      if (payload.content && payload.content.trim()) {
        sendOptions.content = payload.content.trim().slice(0, 2000);
      }

      const sent = await targetChannel.send(sendOptions);

      if (eData.description) {
        const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
        if (rootConfig) {
          rootConfig.customRules = eData.description;
          if (this.onConfigUpdated) this.onConfigUpdated();
        }
      }

      this.logEvent(
        'success',
        `Dispatched Discohook-style embed "${eData.title || 'Custom Rules'}" to #${targetChannel.name} in "${targetGuild?.name || 'Server'}"`,
        targetGuild?.name
      );

      return {
        success: true,
        channelId: targetChannel.id,
        channelName: targetChannel.name,
        messageId: sent.id
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send embed to Discord' };
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
      if (this.onConfigUpdated) this.onConfigUpdated();
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
    if (this.onConfigUpdated) this.onConfigUpdated();
    this.logEvent('warn', `Blacklisted player @${entry.username} (${cleanId}) — Reason: ${entry.reason}`);
    return entry;
  }

  public removeFromBlacklist(userId: string): boolean {
    const cleanId = userId.replace(/[<@!>]/g, '').trim();
    const idx = this.blacklist.findIndex(b => b.userId === cleanId || b.username.toLowerCase() === cleanId.toLowerCase());
    if (idx !== -1) {
      const removed = this.blacklist.splice(idx, 1)[0];
      if (this.onConfigUpdated) this.onConfigUpdated();
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
      return [`${EMOJI.golden} **Group A**\n*No teams registered yet.*`];
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
              .map(t => `${EMOJI.sword} \`#${t.slotNumber < 10 ? '0' + t.slotNumber : t.slotNumber}\` **${t.teamName}** — <@${t.captain.id}>`)
              .join('\n')
          : '*No teams in this group*';

      sections.push(`${EMOJI.golden} **Group ${groupLetter}**\n${teamLines}`);
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

    return chunks.length > 0 ? chunks : [`${EMOJI.golden} **Group A**\n*No teams registered yet.*`];
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
    playerIds: string[] = [],
    tournamentConfig?: any
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
    const categoryName = 'Team Voice Lobbies';
    const voiceChannelName = cleanTeamName;
    const warnings: string[] = [];

    team.teamRoleName = roleName;
    team.teamCategoryName = categoryName;
    team.teamVoiceChannelName = voiceChannelName;

    if (!guild) {
      return { roleName, categoryName, voiceChannelName, warnings };
    }

    const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
    const canManageRoles = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false);
    const canManageChannels = isAdmin || (botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels) ?? false);

    const uniquePlayerIds = Array.from(this.getTeamMemberIds(team));
    for (const rawPid of playerIds) {
      const normPid = this.normalizeMemberId(rawPid);
      if (normPid && !uniquePlayerIds.includes(normPid)) {
        uniquePlayerIds.push(normPid);
      }
    }

    const configForRoles = tournamentConfig || (this.getTournamentConfig ? this.getTournamentConfig() : null);
    const reservedRoleNames = new Set([
      '@everyone',
      'ffa bot manager',
      (configForRoles?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase(),
      (configForRoles?.verifiedRoleName || 'Verified Team').trim().toLowerCase(),
      (configForRoles?.roleName || 'Confirmed Slot').trim().toLowerCase()
    ]);

    const effectiveRoleName = reservedRoleNames.has(roleName.toLowerCase()) ? `Team ${roleName}` : roleName;
    team.teamRoleName = effectiveRoleName;

    let teamRole = team.teamRoleId ? guild.roles.cache.get(team.teamRoleId) : undefined;
    if (!teamRole && canManageRoles) {
      try {
        teamRole = await guild.roles.create({
          name: effectiveRoleName,
          color: 0x5865F2,
          hoist: false,
          mentionable: true,
          reason: `FFA-Manager Team Role for ${cleanTeamName} (Slot #${team.slotNumber})`
        });
      } catch (err: any) {
        warnings.push(`Could not create team role @${effectiveRoleName}: ${err.message}`);
      }
    } else if (!teamRole && !canManageRoles) {
      warnings.push(`Bot lacks "Manage Roles" permission to create team role @${effectiveRoleName}.`);
    }

    if (teamRole) {
      team.teamRoleId = teamRole.id;
      team.teamRoleName = teamRole.name;
    }

    const allowedSet = new Set(uniquePlayerIds);
    const resolvedMemberIds: string[] = [];
    for (const uid of uniquePlayerIds) {
      if (!/^\d{15,20}$/.test(uid)) continue;
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

    if (teamRole && canManageRoles) {
      for (const [, member] of guild.members.cache) {
        if (member.roles.cache.has(teamRole.id) && !allowedSet.has(member.id)) {
          await member.roles.remove(teamRole).catch(() => {});
        }
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
            PermissionsBitField.Flags.UseVAD,
            PermissionsBitField.Flags.CreateInstantInvite
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
            PermissionsBitField.Flags.UseVAD,
            PermissionsBitField.Flags.CreateInstantInvite
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
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.CreateInstantInvite
          ]
        });
      }

      const managerRoleName = (configForRoles?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase();
      const managerRole =
        (configForRoles?.managerRoleId ? guild.roles.cache.get(configForRoles.managerRoleId) : undefined) ||
        guild.roles.cache.find(
          r => r.name.trim().toLowerCase() === managerRoleName || r.name.trim().toLowerCase() === 'ffa bot manager'
        );
      if (managerRole) {
        overwrites.push({
          id: managerRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.CreateInstantInvite
          ]
        });
      }

      try {
        if (team.teamCategoryId) {
          const existingCat = guild.channels.cache.get(team.teamCategoryId);
          if (
            existingCat &&
            existingCat.type === ChannelType.GuildCategory &&
            existingCat.name.trim().toLowerCase() === categoryName.toLowerCase()
          ) {
            teamCategory = existingCat as CategoryChannel;
          }
        }

        if (!teamCategory) {
          teamCategory = guild.channels.cache.find(
            c =>
              c.type === ChannelType.GuildCategory &&
              c.name.trim().toLowerCase() === categoryName.toLowerCase() &&
              guild.channels.cache.filter(ch => ch.parentId === c.id).size < 50
          ) as CategoryChannel | undefined;
        }

        if (!teamCategory) {
          const categoryOverwrites: any[] = [];
          if (botMember) {
            categoryOverwrites.push({
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
          if (managerRole) {
            categoryOverwrites.push({
              id: managerRole.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.MoveMembers
              ]
            });
          }

          teamCategory = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites: categoryOverwrites,
            reason: `FFA-Manager Shared Team Voice Lobbies Category`
          });
        }

        team.teamCategoryId = teamCategory.id;
        team.teamCategoryName = teamCategory.name;

        if (team.teamVoiceChannelId) {
          const existingVc = guild.channels.cache.get(team.teamVoiceChannelId);
          if (existingVc && existingVc.type === ChannelType.GuildVoice) {
            voiceChannel = existingVc;
          }
        }

        if (!voiceChannel) {
          voiceChannel = await guild.channels.create({
            name: voiceChannelName,
            type: ChannelType.GuildVoice,
            parent: teamCategory.id,
            permissionOverwrites: overwrites,
            reason: `FFA-Manager Private Voice Channel for ${cleanTeamName} (Slot #${team.slotNumber})`
          });
        } else {
          if (voiceChannel.parentId !== teamCategory.id) {
            await voiceChannel.setParent(teamCategory.id, { lockPermissions: false }).catch(() => {});
          }
          await voiceChannel.permissionOverwrites.set(overwrites).catch(() => {});
        }

        team.teamVoiceChannelId = voiceChannel.id;
        team.teamVoiceChannelName = voiceChannel.name;

        if (typeof voiceChannel.createInvite === 'function') {
          try {
            const invite = await voiceChannel.createInvite({
              maxAge: 0,
              maxUses: 0,
              unique: false,
              reason: `Direct voice channel join link for ${cleanTeamName}`
            });
            if (invite?.url) {
              team.teamVoiceInviteUrl = invite.url;
            }
          } catch {
          }
        }
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

  private async resolveVoiceConnectUrl(
    guild: Guild,
    voiceChannelId: string,
    existingInviteUrl?: string
  ): Promise<string> {
    if (existingInviteUrl && existingInviteUrl.startsWith('https://discord.gg/')) {
      return existingInviteUrl;
    }
    try {
      const ch =
        guild.channels.cache.get(voiceChannelId) ||
        (await guild.channels.fetch(voiceChannelId).catch(() => null));
      if (ch && ch.type === ChannelType.GuildVoice && typeof (ch as any).createInvite === 'function') {
        const invite = await (ch as any).createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: false,
          reason: 'Direct voice channel join button'
        });
        if (invite?.url) {
          return invite.url;
        }
      }
    } catch {
    }
    return `https://discord.com/channels/${guild.id}/${voiceChannelId}`;
  }

  private createVoiceConnectButtonRow(
    guildId: string,
    voiceChannelId: string,
    channelName: string,
    inviteUrl?: string
  ) {
    const cleanLabel = `🔊 Connect to ${channelName}`.slice(0, 80);
    const targetUrl = inviteUrl || `https://discord.com/channels/${guildId}/${voiceChannelId}`;
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(cleanLabel)
        .setStyle(ButtonStyle.Link)
        .setURL(targetUrl)
    );
  }

  public async cleanupTeamWorkspace(guild: Guild | undefined, team: any): Promise<string[]> {
    const cleaned: string[] = [];
    if (!guild || !team) return cleaned;

    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const config = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const otherTeamVoiceIds = new Set<string>();
    const otherTeamCategoryIds = new Set<string>();
    const otherTeamRoleIds = new Set<string>();

    for (const t of allTeams) {
      if (t.id !== team.id) {
        if (t.teamVoiceChannelId) otherTeamVoiceIds.add(t.teamVoiceChannelId);
        if (t.teamCategoryId) otherTeamCategoryIds.add(t.teamCategoryId);
        if (t.teamRoleId) otherTeamRoleIds.add(t.teamRoleId);
      }
    }
    if (config?.tournaments) {
      for (const tCfg of Object.values(config.tournaments) as any[]) {
        if (tCfg?.categoryId) otherTeamCategoryIds.add(tCfg.categoryId);
        if (tCfg?.verifiedRoleId) otherTeamRoleIds.add(tCfg.verifiedRoleId);
        if (tCfg?.slotRoleId) otherTeamRoleIds.add(tCfg.slotRoleId);
        if (tCfg?.managerRoleId) otherTeamRoleIds.add(tCfg.managerRoleId);
      }
    }

    const protectedRoleNames = new Set(
      [
        '@everyone',
        'ffa bot manager',
        (config?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase(),
        (config?.verifiedRoleName || 'Verified Team').trim().toLowerCase(),
        (config?.roleName || 'Confirmed Slot').trim().toLowerCase()
      ]
    );

    const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const isAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
    const botHighestRolePos = botMember?.roles?.highest?.position ?? 0;

    const cleanTeamName = (team.teamName || '').trim().toLowerCase();
    const cleanVcName = (team.teamVoiceChannelName || '').trim().toLowerCase();
    const cleanCatName = (team.teamCategoryName || '').trim().toLowerCase();

    // 1. Voice channel deletion
    const targetVc = team.teamVoiceChannelId
      ? guild.channels.cache.get(team.teamVoiceChannelId)
      : guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildVoice &&
            !otherTeamVoiceIds.has(c.id) &&
            ((cleanVcName && (c.name.toLowerCase() === cleanVcName || c.name.toLowerCase() === `🔊 ${cleanVcName}` || c.name.toLowerCase().replace(/^🔊\s*/, '') === cleanVcName)) ||
              (cleanTeamName && (c.name.toLowerCase() === cleanTeamName || c.name.toLowerCase() === `🔊 ${cleanTeamName}` || c.name.toLowerCase().replace(/^🔊\s*/, '') === cleanTeamName)))
        );

    if (targetVc) {
      try {
        const vcName = targetVc.name;
        await targetVc.delete(`FFA-Manager cleanup for team ${team.teamName}`);
        cleaned.push(`Voice: 🔊 ${vcName}`);
      } catch (err: any) {
        console.warn(`[DiscordBot] Notice deleting team voice channel: ${err.message}`);
      }
    }

    // 2. Category deletion (only if no other channels remain inside it)
    const targetCat = (
      team.teamCategoryId
        ? guild.channels.cache.get(team.teamCategoryId)
        : guild.channels.cache.find(
            c =>
              c.type === ChannelType.GuildCategory &&
              !otherTeamCategoryIds.has(c.id) &&
              ((cleanCatName && c.name.toLowerCase() === cleanCatName) ||
                (cleanTeamName && c.name.toLowerCase() === cleanTeamName))
          )
    ) as CategoryChannel | undefined;

    if (targetCat && targetCat.type === ChannelType.GuildCategory && !otherTeamCategoryIds.has(targetCat.id)) {
      const remainingChildren = guild.channels.cache.filter(c => c.parentId === targetCat.id);
      if (remainingChildren.size === 0) {
        try {
          const catName = targetCat.name;
          await targetCat.delete(`FFA-Manager cleanup for empty category ${catName}`);
          cleaned.push(`Category: ${catName}`);
        } catch (err: any) {
          console.warn(`[DiscordBot] Notice deleting team category: ${err.message}`);
        }
      }
    }

    // 3. Team role deletion
    const targetRole = team.teamRoleId
      ? guild.roles.cache.get(team.teamRoleId)
      : guild.roles.cache.find(
          r =>
            !protectedRoleNames.has(r.name.toLowerCase()) &&
            !otherTeamRoleIds.has(r.id) &&
            !r.managed &&
            (isAdmin || r.position < botHighestRolePos) &&
            ((team.teamRoleName && r.name.toLowerCase() === team.teamRoleName.toLowerCase()) ||
              (cleanTeamName && (r.name.toLowerCase() === cleanTeamName || r.name.toLowerCase() === `@${cleanTeamName}`)))
        );
    if (targetRole && !targetRole.managed && (isAdmin || targetRole.position < botHighestRolePos)) {
      try {
        const rName = targetRole.name;
        await targetRole.delete(`FFA-Manager cleanup for team ${team.teamName}`);
        cleaned.push(`Role: @${rName}`);
      } catch (err: any) {
        console.warn(`[DiscordBot] Notice deleting team role: ${err.message}`);
      }
    }

    return cleaned;
  }

  public async stopRegistration(
    targetGuild?: Guild,
    reason?: string,
    staffTag?: string,
    targetConfig?: any
  ): Promise<{
    success: boolean;
    lockedChannels: string[];
    warnings: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const config = targetConfig || this.resolveTournamentContext(targetGuild, null);
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
      this.syncTournamentToRootConfig(config);
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
        const regCh = this.resolveRegistrationChannel(guild, config);

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
              .setTitle(`${EMOJI.alert} ${config.title || 'Tournament'} — Registration Ended & Channel Locked`)
              .setColor(0xED4245)
              .setDescription(
                `${EMOJI.dividerBar}\n` +
                `${EMOJI.alert} Registration for **${config.title || 'this tournament'}** is now **CLOSED** and <#${regCh.id}> has been **LOCKED**.\n\n` +
                `${EMOJI.admin} **Reason:** ${closeReason}\n` +
                `${EMOJI.dividerBar}`
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
        `Registration STOPPED and #registration locked for "${config.title || 'Tournament'}" by ${staffTag || 'Staff'}: ${closeReason}`,
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
    guild?: Guild,
    targetConfig?: any
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
      const config = targetConfig || this.resolveTournamentContext(guild, null);
      const teams = this.getTeamsForTournament(config);

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

      const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      allTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));
      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }

      if (config) {
        await this.syncGuildChannels(config, guild);
      }

      this.logEvent(
        'info',
        `Swapped Slot #${slot1} (${groupForSlot1}) and Slot #${slot2} (${groupForSlot2}) in "${config.title || 'Tournament'}"`,
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

  public generateRosterExport(
    format: 'csv' | 'markdown' = 'markdown',
    includeWaitlist: boolean = true,
    targetConfig?: any
  ): string {
    const activeCfg = targetConfig || this.resolveTournamentContext(null, null);
    const rawTeams = this.getTeamsForTournament(activeCfg);
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
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildVoiceStates
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

  public async cleanOrphanChannels(): Promise<void> {
    if (!this.client || !this.client.isReady()) return;
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;

    for (const [, guild] of this.client.guilds.cache) {
      try {
        await guild.channels.fetch().catch(() => {});
        const category = this.resolveTournamentCategory(guild, rootConfig);

        for (const [, ch] of guild.channels.cache) {
          if (ch.isTextBased() && (ch.name === 'registration-details' || ch.name.includes('registration-details'))) {
            if (!ch.parentId) {
              if (category) {
                await (ch as TextChannel).setParent(category.id, { lockPermissions: false }).catch(() => {});
                this.logEvent('info', `Moved separate #${ch.name} under category "${category.name}" in "${guild.name}"`, guild.name);
              } else {
                await ch.delete('Deleting stray unparented registration-details channel').catch(() => {});
                this.logEvent('info', `Deleted stray separate #${ch.name} in "${guild.name}"`, guild.name);
                if (rootConfig && rootConfig.regDetailsChannelId === ch.id) {
                  rootConfig.regDetailsChannelId = '';
                  if (this.onConfigUpdated) this.onConfigUpdated();
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[DiscordBot] Orphan channel scan notice for "${guild.name}":`, err?.message || err);
      }
    }
  }

  public async init247VoiceChannels(): Promise<void> {
    if (!this.client || !this.client.isReady()) return;
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const envChannelId = process.env.STAY_VOICE_CHANNEL_ID || process.env.VOICE_CHANNEL_ID || process.env.VC_247_ID;

    if (rootConfig?.stayVoiceChannels && typeof rootConfig.stayVoiceChannels === 'object') {
      for (const [gId, chId] of Object.entries(rootConfig.stayVoiceChannels)) {
        if (typeof chId === 'string' && chId.trim().length > 0) {
          this.stayVoiceChannels.set(gId, chId.trim());
        }
      }
    }

    if (envChannelId && envChannelId.trim().length > 0) {
      const cleanEnvId = envChannelId.trim();
      for (const [, guild] of this.client.guilds.cache) {
        const found = guild.channels.cache.get(cleanEnvId);
        if (found && (found.type === ChannelType.GuildVoice || found.type === ChannelType.GuildStageVoice)) {
          this.stayVoiceChannels.set(guild.id, cleanEnvId);
          break;
        }
      }
    }

    for (const [guildId, channelId] of this.stayVoiceChannels.entries()) {
      await this.connectTo247Voice(guildId, channelId).catch(() => {});
    }
  }

  public async connectTo247Voice(
    guildId: string,
    channelId: string
  ): Promise<{ success: boolean; channelName?: string; error?: string }> {
    if (!this.client || !this.client.isReady()) {
      return { success: false, error: 'Discord client is not ready' };
    }
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return { success: false, error: 'Guild not found or bot lacks access' };
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return { success: false, error: 'Valid voice channel not found' };
    }

    const botMember = guild.members.me;
    if (botMember && !botMember.permissionsIn(channel).has(PermissionsBitField.Flags.Connect)) {
      return { success: false, error: `Bot lacks CONNECT permission in #${channel.name}` };
    }

    try {
      this.stayVoiceChannels.set(guildId, channelId);

      const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
      if (rootConfig) {
        if (!rootConfig.stayVoiceChannels) rootConfig.stayVoiceChannels = {};
        rootConfig.stayVoiceChannels[guildId] = channelId;
        if (this.onConfigUpdated) this.onConfigUpdated();
      }

      const existingConnection = getVoiceConnection(guildId);
      if (existingConnection && existingConnection.joinConfig.channelId === channelId) {
        return { success: true, channelName: channel.name };
      }

      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as any,
        selfDeaf: true,
        selfMute: true
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch {
          if (this.stayVoiceChannels.get(guildId) === channelId) {
            if (!this.isReconnectingVoice.get(guildId)) {
              this.isReconnectingVoice.set(guildId, true);
              this.logEvent('warn', `Voice connection dropped in "${guild.name}". Auto-rejoining 24/7 lobby #${channel.name}...`, guild.name);
              setTimeout(() => {
                this.isReconnectingVoice.delete(guildId);
                this.connectTo247Voice(guildId, channelId).catch(() => {});
              }, 3000);
            }
          }
        }
      });

      this.logEvent('success', `🔊 Bot connected 24/7 to voice channel "${channel.name}" in "${guild.name}".`, guild.name);
      return { success: true, channelName: channel.name };
    } catch (err: any) {
      this.logEvent('error', `Failed to join voice channel "${channel.name}": ${err.message}`, guild.name);
      return { success: false, error: err.message };
    }
  }

  public leave247Voice(guildId: string): { success: boolean; message: string } {
    this.stayVoiceChannels.delete(guildId);
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    if (rootConfig?.stayVoiceChannels) {
      delete rootConfig.stayVoiceChannels[guildId];
      if (this.onConfigUpdated) this.onConfigUpdated();
    }
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
      const guild = this.client?.guilds.cache.get(guildId);
      this.logEvent('info', `Disconnected 24/7 voice connection in "${guild?.name || guildId}".`, guild?.name);
      return { success: true, message: 'Successfully left voice channel and disabled 24/7 connection.' };
    }
    return { success: true, message: '24/7 voice connection disabled (was not connected).' };
  }

  public get247VoiceStatus(guildId: string): { is247: boolean; channelId?: string; channelName?: string; isConnected: boolean } {
    const channelId = this.stayVoiceChannels.get(guildId);
    const connection = getVoiceConnection(guildId);
    const guild = this.client?.guilds.cache.get(guildId);
    const channel = channelId && guild ? guild.channels.cache.get(channelId) : null;

    return {
      is247: Boolean(channelId),
      channelId,
      channelName: channel?.name,
      isConnected: Boolean(connection && connection.state.status === VoiceConnectionStatus.Ready)
    };
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

    this.client.on('clientReady', async () => {
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
      this.reconcileActiveTournaments();
      await this.cleanOrphanChannels().catch(() => {});
      await this.init247VoiceChannels().catch(() => {});

      this.client?.guilds.cache.forEach(guild => {
        guild.members.me?.setNickname('FFA-Manager').catch(() => {});
        const guildTourneys = this.getGuildTournaments(guild);
        if (guildTourneys.length > 0) {
          this.logEvent('info', `Connected to "${guild.name}" as FFA-Manager (${guildTourneys.length} active tournament(s)).`, guild.name);
        } else {
          this.logEvent('info', `Connected to "${guild.name}" as FFA-Manager. Ready for registrations. (Use /setup or !setup).`, guild.name);
        }
      });

      setTimeout(async () => {
        try {
          if (this.client?.user && !this.client.user.avatar) {
            const candidatePaths = [
              path.resolve(__botDirname, '../../public/assets/glacier-cup-logo.png'),
              path.resolve(__botDirname, 'public/assets/glacier-cup-logo.png'),
              path.resolve(process.cwd(), 'public/assets/glacier-cup-logo.png')
            ];
            const logoPath = candidatePaths.find((p) => fs.existsSync(p));
            if (logoPath) {
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

    this.client.on('channelUpdate', (_oldChannel, newChannel: any) => {
      try {
        const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
        const guildId = newChannel?.guild?.id;
        let updated = false;

        if (rootConfig && newChannel?.id && newChannel?.name) {
          const registry = this.ensureTournamentsRegistry(rootConfig);
          const configsToCheck = [rootConfig, ...Object.values(registry)];
          for (const cfg of configsToCheck) {
            const gMap = guildId ? cfg.guildChannels?.[guildId] : undefined;
            if (newChannel.id === cfg.categoryId || newChannel.id === gMap?.categoryId) {
              cfg.categoryName = newChannel.name;
              updated = true;
            }
            if (newChannel.id === cfg.rulesChannelId || newChannel.id === gMap?.rulesChannelId) {
              cfg.rulesChannel = newChannel.name;
              updated = true;
            }
            if (newChannel.id === cfg.regChannelId || newChannel.id === gMap?.regChannelId) {
              cfg.regChannel = newChannel.name;
              updated = true;
            }
            if (newChannel.id === cfg.slotListChannelId || newChannel.id === gMap?.slotListChannelId) {
              cfg.slotListChannel = newChannel.name;
              updated = true;
            }
            if (newChannel.id === cfg.regDetailsChannelId || newChannel.id === gMap?.regDetailsChannelId) {
              cfg.regDetailsChannel = newChannel.name;
              updated = true;
            }
            if (newChannel.id === cfg.idpChannelId || newChannel.id === gMap?.idpChannelId) {
              cfg.idpChannel = newChannel.name;
              updated = true;
            }
          }
        }

        const teams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
        for (const t of teams) {
          if (t.teamCategoryId && t.teamCategoryId === newChannel?.id && newChannel?.name) {
            t.teamCategoryName = newChannel.name;
            updated = true;
          }
          if (t.teamVoiceChannelId && t.teamVoiceChannelId === newChannel?.id && newChannel?.name) {
            t.teamVoiceChannelName = newChannel.name;
            updated = true;
          }
        }

        if (updated && this.onConfigUpdated) {
          this.onConfigUpdated();
        }
        this.refreshGuilds();
      } catch {
      }
    });

    this.client.on('channelDelete', () => {
      try {
        this.reconcileActiveTournaments();
        this.refreshGuilds();
      } catch {
      }
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

    this.client.on('voiceStateUpdate', (oldState, newState) => {
      try {
        if (newState.id === this.client?.user?.id) {
          if (!newState.channelId) {
            const targetVcId = this.stayVoiceChannels.get(oldState.guild.id);
            if (targetVcId) {
              this.logEvent('warn', `Bot was disconnected from voice in "${oldState.guild.name}". Auto-reconnecting 24/7 lobby in 3 seconds...`, oldState.guild.name);
              setTimeout(() => {
                this.connectTo247Voice(oldState.guild.id, targetVcId).catch(() => {});
              }, 3000);
            }
          }
        }
      } catch {
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isAutocomplete()) {
          await interaction.respond([]).catch(() => {});
          return;
        }

        if (interaction.isChatInputCommand()) {
          await this.handleInteraction(interaction);
          return;
        }

        if (interaction.isButton()) {
          if (
            interaction.customId === 'register_team_panel_btn' ||
            interaction.customId.startsWith('register_team_panel_btn:')
          ) {
            const btnTourneyId = interaction.customId.includes(':')
              ? interaction.customId.split(':')[1]
              : undefined;
            const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, btnTourneyId);
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
            if (cfg.status === 'closed' && cfg.explicitlyStoppedOrPaused) {
              await interaction.reply({
                content: `🔴 Registrations for **${cfg.title || 'this tournament'}** have been **STOPPED** by tournament staff.`,
                ephemeral: true
              });
              return;
            }

            await interaction.showModal(this.createTeamRegistrationModal(cfg));
            return;
          }

          if (
            interaction.customId === 'reg_open_modal_btn' ||
            interaction.customId.startsWith('reg_open_modal_btn:')
          ) {
            const btnTourneyId = interaction.customId.includes(':')
              ? interaction.customId.split(':')[1]
              : undefined;
            const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, btnTourneyId);
            const draft = this.pendingRegistrationDrafts.get(interaction.user.id);
            const selectedRegion = draft?.region || 'India';
            const preselectedPlayers = draft?.playerIds || [];
            await interaction.showModal(this.createTeamRegistrationModal(cfg, selectedRegion, preselectedPlayers));
            return;
          }

          if (
            interaction.customId === 'open_rules_modal' ||
            interaction.customId.startsWith('open_rules_modal:')
          ) {
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            if (!isStaff) {
              await interaction.reply({
                content: '❌ **Access Restricted:** Only members with the **@FFA Bot Manager** role can set and publish tournament rules.',
                ephemeral: true
              });
              return;
            }
            const btnTourneyId = interaction.customId.includes(':')
              ? interaction.customId.split(':')[1]
              : undefined;
            const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, btnTourneyId);
            await interaction.showModal(this.createRulesModal(cfg?.customRules, cfg?.id));
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
            const parts = interaction.customId.split(':');
            const deleteChannels = parts[1] === '1';
            const targetTourneyId = parts[2] || undefined;
            const targetConfig = this.resolveTournamentContext(interaction.guild, interaction.channelId, targetTourneyId);
            await interaction.update({
              content: '⏳ **Deleting tournament category, voice channels, roles, channels, and resetting rosters...**',
              embeds: [],
              components: []
            });
            const result = await this.deleteTournament(interaction.guild || undefined, deleteChannels, targetConfig);
            const embed = new EmbedBuilder()
              .setTitle(`${EMOJI.alert} Tournament Deleted & All Tournament Assets Removed`)
              .setColor(0xED4245)
              .setDescription(
                `${EMOJI.dividerBar}\n` +
                `The tournament **${targetConfig?.title || 'Tournament'}** has been deleted by <@${interaction.user.id}>. Its category, voice channels, text channels, and roles have been removed from **${interaction.guild?.name || 'the server'}**.\n` +
                `${EMOJI.dividerBar}`
              )
              .addFields(
                {
                  name: `${EMOJI.golden} Deleted Categories`,
                  value: result.deletedCategories.length > 0 ? result.deletedCategories.slice(0, 10).join('\n') + (result.deletedCategories.length > 10 ? `\n...and ${result.deletedCategories.length - 10} more` : '') : '*(None)*',
                  inline: true
                },
                {
                  name: `${EMOJI.sword} Deleted Voice Channels`,
                  value: result.deletedVoiceChannels.length > 0 ? result.deletedVoiceChannels.slice(0, 10).join('\n') + (result.deletedVoiceChannels.length > 10 ? `\n...and ${result.deletedVoiceChannels.length - 10} more` : '') : '*(None)*',
                  inline: true
                },
                {
                  name: `${EMOJI.admin} Deleted Roles`,
                  value: result.deletedRoles.length > 0 ? result.deletedRoles.slice(0, 10).join('\n') + (result.deletedRoles.length > 10 ? `\n...and ${result.deletedRoles.length - 10} more` : '') : '*(None)*',
                  inline: true
                },
                {
                  name: `${EMOJI.golden} Deleted Text Channels`,
                  value: result.deletedTextChannels.length > 0 ? result.deletedTextChannels.join('\n') : '*(None)*',
                  inline: false
                },
                {
                  name: `${EMOJI.done} Cleared Rosters & Slots`,
                  value: `\`${result.clearedTeamsCount} Team(s) cleared\` • Tournament status set to CLOSED`,
                  inline: false
                }
              )
              .setFooter({ text: 'FFA | Glacier Cup Manager™ • Run /setup to launch a new tournament' })
              .setTimestamp();
            await interaction.editReply({ content: null, embeds: [embed], components: [] }).catch(() => {});
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

          if (interaction.customId.startsWith('captain_edit_roster:')) {
            const parts = interaction.customId.split(':');
            const teamId = parts[1];
            const btnTourneyId = parts[2] || undefined;
            const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, btnTourneyId);
            const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
            const team = allTeams.find(t => t.id === teamId) || this.findUserTeamInTournament(interaction.user.id, cfg);
            if (!team) {
              await interaction.reply({
                content: '❌ **Team Not Found:** Your team slot could not be located (it may have already been cancelled).',
                ephemeral: true
              });
              return;
            }
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            const isCaptain = this.normalizeMemberId(team.captain?.id) === this.normalizeMemberId(interaction.user.id);
            if (!isCaptain && !isStaff) {
              await interaction.reply({
                content: `❌ **Captain Only:** Only the registered Team Captain (<@${team.captain?.id}>) can edit the roster for **${team.teamName}**.`,
                ephemeral: true
              });
              return;
            }
            const isOpen = cfg && cfg.status === 'open' && !cfg.explicitlyStoppedOrPaused;
            if (!isOpen && !isStaff) {
              await interaction.reply({
                content: '🔒 **Registration Locked:** Self-service roster editing is only available while tournament registration is **OPEN**.',
                ephemeral: true
              });
              return;
            }
            await interaction.showModal(this.createCaptainEditRosterModal(team, cfg));
            return;
          }

          if (interaction.customId.startsWith('captain_cancel_slot:')) {
            const parts = interaction.customId.split(':');
            const teamId = parts[1];
            const btnTourneyId = parts[2] || undefined;
            const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, btnTourneyId);
            const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
            const team = allTeams.find(t => t.id === teamId) || this.findUserTeamInTournament(interaction.user.id, cfg);
            if (!team) {
              await interaction.reply({
                content: '❌ **Team Not Found:** Your team slot could not be located (it may have already been cancelled).',
                ephemeral: true
              });
              return;
            }
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
            const isCaptain = this.normalizeMemberId(team.captain?.id) === this.normalizeMemberId(interaction.user.id);
            if (!isCaptain && !isStaff) {
              await interaction.reply({
                content: `❌ **Captain Only:** Only the registered Team Captain (<@${team.captain?.id}>) can withdraw or cancel the slot for **${team.teamName}**.`,
                ephemeral: true
              });
              return;
            }
            const isOpen = cfg && cfg.status === 'open' && !cfg.explicitlyStoppedOrPaused;
            if (!isOpen && !isStaff) {
              await interaction.reply({
                content: '🔒 **Registration Locked:** Self-service slot cancellation is only available while tournament registration is **OPEN**.',
                ephemeral: true
              });
              return;
            }

            await interaction.deferReply({ ephemeral: true });
            const delRes = await this.deleteSlot(
              team.slotNumber,
              interaction.guild || undefined,
              { teamId: team.id, isWaitlist: team.isWaitlist, tournamentId: cfg?.id },
              cfg
            );

            if (!delRes.success || !delRes.deletedTeam) {
              await interaction.editReply(`❌ **Failed to cancel slot:** ${delRes.error || 'Could not remove slot.'}`);
              return;
            }

            const cancelEmbed = new EmbedBuilder()
              .setTitle(`${EMOJI.alert} Team Slot Cancelled & Withdrawn`)
              .setColor(0xED4245)
              .setDescription(
                `${EMOJI.dividerBar}\n` +
                `${EMOJI.done} Your team **${delRes.deletedTeam.teamName}** (${delRes.deletedTeam.isWaitlist ? `Waitlist #${delRes.deletedTeam.slotNumber}` : `Slot #${delRes.deletedTeam.slotNumber}`}) has been withdrawn from **${cfg?.title || 'the tournament'}**.\n` +
                `${EMOJI.dividerBar}`
              )
              .addFields({
                name: `${EMOJI.golden} Automatic Waitlist Promotion`,
                value: delRes.promotedTeam
                  ? `${EMOJI.giveaway} **${delRes.promotedTeam.teamName}** was automatically promoted from the waitlist into confirmed **Slot #${delRes.promotedTeam.slotNumber}** (${delRes.promotedTeam.group || 'Group A'})!`
                  : 'ℹ️ No waitlist teams were queued for promotion.',
                inline: false
              })
              .setFooter({ text: 'FFA | Glacier Cup Manager™ • Self-Service Captain Controls' })
              .setTimestamp();

            await interaction.editReply({ embeds: [cancelEmbed] });
            return;
          }

          if (
            interaction.customId === 'setup_preset_squad_20' ||
            interaction.customId === 'setup_preset_2grp_32' ||
            interaction.customId === 'setup_preset_4grp_48' ||
            interaction.customId === 'setup_preset_duo_24'
          ) {
            if (interaction.replied || interaction.deferred) return;
            const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, true);
            if (!isStaff) {
              await interaction.reply({
                content: '❌ Only members with the **@FFA Bot Manager** role can use tournament setup presets.',
                ephemeral: true
              }).catch(() => {});
              return;
            }

            let chosenSlots = 20;
            let chosenTags = 4;
            let chosenGroups = 1;
            let chosenTitle = 'Glacier Cup Squads';

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
            }).catch(() => {});

            if (!interaction.guild) {
              await interaction.editReply('❌ This command can only be used in a server.').catch(() => {});
              return;
            }

            const res = await this.createTournament(interaction.guild, {
              slots: chosenSlots,
              tags: chosenTags,
              groups: chosenGroups,
              title: chosenTitle,
              createdBy: interaction.user.tag,
              createdByUserId: interaction.user.id
            });

            if (res.success) {
              const doneEmbed = new EmbedBuilder()
                .setTitle(`${EMOJI.giveaway} Tournament Auto-Created!`)
                .setColor(res.warnings && res.warnings.length > 0 ? 0xFEE75C : 0x57F287)
                .setDescription(
                  `${EMOJI.dividerBar}\n` +
                  `${EMOJI.done} **${chosenTitle}** is ready in **${interaction.guild?.name}**!\n` +
                  `${EMOJI.dividerBar}`
                )
                .addFields(
                  { name: `${EMOJI.golden} Configuration`, value: `\`${chosenSlots} Slots\` • \`${chosenTags} Tags/Team\` • \`${chosenGroups} Group(s)\``, inline: false },
                  { name: `${EMOJI.admin} Created Channels & Role`, value: res.created.join('\n') || 'Channels ready', inline: false }
                )
                .setFooter({ text: 'Teams registering will be granted @Verified Team' });

              await interaction.editReply({ content: null, embeds: [doneEmbed], components: [] }).catch(() => {});
            } else {
              await interaction.editReply({ content: `❌ Failed to create tournament: ${res.error}`, embeds: [], components: [] }).catch(() => {});
            }
            return;
          }
        }

        if (
          interaction.isStringSelectMenu() &&
          (interaction.customId === 'reg_region_select' || interaction.customId.startsWith('reg_region_select:'))
        ) {
          const menuTourneyId = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : undefined;
          const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, menuTourneyId);
          const rawVal = interaction.values[0];
          const chosenRegion: 'India' | 'Bangladesh' | 'Pakistan' =
            rawVal === 'Bangladesh' ? 'Bangladesh' : rawVal === 'Pakistan' ? 'Pakistan' : 'India';
          await interaction.showModal(this.createTeamRegistrationModal(cfg, chosenRegion, []));
          return;
        }

        if (
          interaction.isUserSelectMenu() &&
          (interaction.customId === 'reg_players_select' || interaction.customId.startsWith('reg_players_select:'))
        ) {
          const menuTourneyId = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : undefined;
          const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, menuTourneyId);
          await interaction.showModal(this.createTeamRegistrationModal(cfg, 'India', interaction.values));
          return;
        }

        if (
          interaction.isModalSubmit() &&
          (interaction.customId === 'submit_team_reg_modal' || interaction.customId.startsWith('submit_team_reg_modal:'))
        ) {
          const parts = interaction.customId.split(':');
          const modalTourneyId = parts.length >= 3 ? parts.slice(2).join(':') : undefined;
          const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, modalTourneyId);
          if (!cfg) {
            await interaction.reply({ content: '❌ Tournament configuration not loaded.', ephemeral: true });
            return;
          }
          await this.handleModalRegistration(interaction, cfg);
          return;
        }

        if (
          interaction.isModalSubmit() &&
          (interaction.customId === 'submit_rules_modal' || interaction.customId.startsWith('submit_rules_modal:'))
        ) {
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
          const modalTourneyId = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : undefined;
          const pending = this.pendingRulesPrompts.get(`${interaction.guild.id}:${interaction.user.id}`);
          this.pendingRulesPrompts.delete(`${interaction.guild.id}:${interaction.user.id}`);
          const targetConfig = this.resolveTournamentContext(
            interaction.guild,
            interaction.channelId,
            modalTourneyId || pending?.tournamentId
          );

          const pubRes = await this.publishRulesToChannel(interaction.guild, rulesText, interaction.user.username, targetConfig);
          if (pubRes.success) {
            const confirmEmbed = new EmbedBuilder()
              .setTitle(`${EMOJI.done} Tournament Rules Published!`)
              .setColor(0x57F287)
              .setDescription(
                `${EMOJI.dividerBar}\n` +
                `${EMOJI.golden} Your custom tournament rules & format for **${targetConfig?.title || 'Tournament'}** have been posted in <#${pubRes.channelId}>!\n` +
                `${EMOJI.dividerBar}`
              )
              .setFooter({ text: `Published by @${interaction.user.username} • FFA-Manager` })
              .setTimestamp();
            await interaction.editReply({ embeds: [confirmEmbed] });
          } else {
            await interaction.editReply(`❌ Failed to publish rules: ${pubRes.error}`);
          }
          return;
        }

        if (
          interaction.isModalSubmit() &&
          interaction.customId.startsWith('submit_captain_edit_roster:')
        ) {
          const parts = interaction.customId.split(':');
          const teamId = parts[1];
          const modalTourneyId = parts[2] || undefined;
          const cfg = this.resolveTournamentContext(interaction.guild, interaction.channelId, modalTourneyId);
          const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
          const team = allTeams.find(t => t.id === teamId) || this.findUserTeamInTournament(interaction.user.id, cfg);
          if (!team || !cfg) {
            await interaction.reply({
              content: '❌ **Team or Tournament Not Found:** Could not locate your registered team.',
              ephemeral: true
            });
            return;
          }
          const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, false);
          const isCaptain = this.normalizeMemberId(team.captain?.id) === this.normalizeMemberId(interaction.user.id);
          if (!isCaptain && !isStaff) {
            await interaction.reply({
              content: `❌ **Captain Only:** Only the registered Team Captain (<@${team.captain?.id}>) can edit this roster.`,
              ephemeral: true
            });
            return;
          }
          const isOpen = cfg.status === 'open' && !cfg.explicitlyStoppedOrPaused;
          if (!isOpen && !isStaff) {
            await interaction.reply({
              content: '🔒 **Registration Locked:** Self-service roster edits are only permitted while registration is **OPEN**.',
              ephemeral: true
            });
            return;
          }
          await this.handleCaptainEditRosterModal(interaction, team, cfg);
          return;
        }

        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ This action or interaction is no longer active. Please run the command again.',
            ephemeral: true
          }).catch(() => {});
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

        const config = this.resolveTournamentContext(message.guild, message.channel.id);
        if (!config) return;

        const channelName = (message.channel as TextChannel).name;
        const content = message.content.trim();

        if (message.guild && content.length > 0 && !content.startsWith('!') && !content.startsWith('/')) {
          const promptKey = `${message.guild.id}:${message.author.id}`;
          const pending = this.pendingRulesPrompts.get(promptKey);
          if (pending && pending.channelId === message.channel.id && Date.now() < pending.expiresAt) {
            this.pendingRulesPrompts.delete(promptKey);
            const targetCfg = this.resolveTournamentContext(message.guild, message.channel.id, pending.tournamentId);
            const pubRes = await this.publishRulesToChannel(message.guild, content, message.author.username, targetCfg);
            if (pubRes.success) {
              const confirmEmbed = new EmbedBuilder()
                .setTitle(`${EMOJI.done} Tournament Rules Published!`)
                .setColor(0x57F287)
                .setDescription(
                  `${EMOJI.dividerBar}\n` +
                  `${EMOJI.golden} Your custom tournament rules & format for **${targetCfg?.title || 'Tournament'}** have been posted in <#${pubRes.channelId}>!\n` +
                  `${EMOJI.dividerBar}`
                )
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

        const resolvedRegCh = message.guild ? this.resolveRegistrationChannel(message.guild, config) : undefined;
        const isRegChannelById =
          (resolvedRegCh && message.channel.id === resolvedRegCh.id) ||
          (config.regChannelId && message.channel.id === config.regChannelId);
        const isRegChannelByNameFallback =
          !config.regChannelId &&
          !resolvedRegCh &&
          (message.channel.id === config.regChannel ||
            channelName === config.regChannel ||
            channelName === 'tournament-registration' ||
            channelName === '📝┃registration' ||
            channelName === 'registration');

        if (isRegChannelById || isRegChannelByNameFallback) {
          await this.handleRegistration(message, config);
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

    if (
      cmd !== 'slots' &&
      cmd !== 'active-tournament' &&
      cmd !== 'activetournament' &&
      cmd !== 'my-team' &&
      cmd !== 'myteam' &&
      !isStaff
    ) {
      return message.reply(
        `❌ **Access Restricted:** Only members with the **@${config?.managerRoleName || 'FFA Bot Manager'}** role can use staff bot commands. Players can register in \`#${config?.regChannel || 'tournament-registration'}\`, manage their team with \`/my-team\`, and check slots with \`!slots\` or \`/active-tournament\`.`
      );
    }

    if (cmd === 'my-team' || cmd === 'myteam') {
      const payload = await this.buildMyTeamPayload(message.guild, message.author.id, config);
      return message.reply({ embeds: payload.embeds, components: payload.components });
    }

    if (cmd === 'active-tournament' || cmd === 'activetournament') {
      const activeEmbed = this.buildActiveTournamentEmbed(message.guild, message.channel.id);
      return message.reply({ embeds: [activeEmbed] });
    }

    if (cmd === '247' || cmd === 'joinvc' || cmd === 'stayvc' || cmd === 'leavevc') {
      if (!isStaff) {
        return message.reply('❌ You need `Manage Channels` or `Administrator` permission to configure 24/7 Voice.');
      }
      if (!message.guild) return message.reply('❌ This command can only be used inside a Discord server.');

      const subAction = (cmd === 'leavevc' ? 'leave' : (args[0] || '').toLowerCase());
      if (subAction === 'leave' || subAction === 'stop' || subAction === 'disconnect') {
        const res = this.leave247Voice(message.guild.id);
        return message.reply(`🔇 ${res.message}`);
      }

      if (subAction === 'status' || (!args[0] && cmd !== 'joinvc')) {
        const status = this.get247VoiceStatus(message.guild.id);
        const embed = new EmbedBuilder()
          .setTitle('🔊 24/7 Voice Channel Status')
          .setColor(status.isConnected ? 0x57F287 : 0xED4245)
          .setDescription(
            status.is247
              ? `• **Target Channel:** <#${status.channelId}> (\`${status.channelName || status.channelId}\`)\n` +
                `• **Status:** ${status.isConnected ? '🟢 **Connected & Staying 24/7**' : '🟡 **Reconnecting...**'}\n` +
                `• **Auto-Reconnect:** Active on server reboots and disconnects`
              : '• **Status:** 🔴 **Disabled**\nUse `!247 join <#channel>` or `/voice-247` to activate.'
          )
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      let targetVc: any = null;
      const rawArg = subAction === 'join' ? args.slice(1).join(' ') : args.join(' ');
      if (rawArg) {
        const idMatch = rawArg.match(/^<#(\d+)>$/) || rawArg.match(/^(\d{15,20})$/);
        const searchId = idMatch ? idMatch[1] : null;
        if (searchId) {
          targetVc = message.guild.channels.cache.get(searchId);
        } else {
          targetVc = message.guild.channels.cache.find(
            (c: any) =>
              (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) &&
              c.name.toLowerCase().includes(rawArg.toLowerCase())
          );
        }
      } else {
        const authorVoice = message.member?.voice?.channel;
        if (authorVoice) {
          targetVc = authorVoice;
        }
      }

      if (!targetVc || (targetVc.type !== ChannelType.GuildVoice && targetVc.type !== ChannelType.GuildStageVoice)) {
        return message.reply('❌ Please specify a valid voice channel (e.g. `!247 join #General` or join a voice channel first).');
      }

      const res = await this.connectTo247Voice(message.guild.id, targetVc.id);
      if (!res.success) {
        return message.reply(`❌ Could not join voice channel: **${res.error}**`);
      }
      return message.reply(`🔊 **Bot locked 24/7 into <#${targetVc.id}>**! It will automatically reconnect if disconnected or if the server restarts.`);
    }

    if (cmd === 'help' || cmd === 'commands') {
      const helpEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} FFA | Glacier Cup Manager™ — Full Command Suite`)
        .setColor(0x5865F2)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `Official FFA | Glacier Cup Manager™ Tagcheck Tournament Bot for Discord. Supports both **Slash Commands** (\`/\`) and prefix commands (\`!\`).\n` +
          `${EMOJI.dividerBar}`
        )
        .addFields(
          {
            name: `${EMOJI.giveaway} Tournament Setup & Channels`,
            value: '`/setup [slots] [tags] [groups] [title]` — Auto-create category, channels & `@FFA Bot Manager` + `@Verified Team` roles and start registration immediately (up to 500 slots; `groups` = teams per group)\n`/active-tournament` — Check if any tournament is currently active in the server\n`/stop-registration [reason]` — Stop registration & lock `#tournament-registration`\n`/delete slot <slot>` — Remove team & promote waitlist\n`/delete tournament` — Preview & delete tournament',
            inline: false
          },
          {
            name: `${EMOJI.golden} Lobby & Registration Control`,
            value: '`/idpass <room_id> <pass> [map] [time]` — Broadcast Room ID & Pass to `#tournament-idp`\n`/stop-registration` — End registration & lock `#tournament-registration`\n`/swap-slots <slot1> <slot2>` — Swap two teams\' slot numbers & groups\n`/announce <message>` — Send official tournament announcement',
            inline: false
          },
          {
            name: `${EMOJI.admin} Verification, Roster & Standings`,
            value: '`/my-team` — Captain self-service: view your team, edit roster tags, or cancel your slot\n`/tagcheck <@user>` — Inspect if a player is already registered or banned\n`/team-info <slot_or_name>` — Full dossier for any registered team\n`/blacklist add|remove|list` — Ban/unban players from registering\n`/standings [group]` — View tournament points table\n`/rules` — Display official tournament rulebook\n`/export [format]` — Export clean roster list (Markdown / CSV)',
            inline: false
          },
          {
            name: `${EMOJI.sword} Registration Format`,
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
        const existingGuildTourneys = this.getGuildTournaments(message.guild);
        const defaultTourneyTitle = existingGuildTourneys.length > 0
          ? `${message.guild.name} Championship #${existingGuildTourneys.length + 1}`
          : `${message.guild.name} Championship`;
        const title = subArgs.slice(3).join(' ').trim() || defaultTourneyTitle;

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
            tournamentId: result.tournamentId,
            expiresAt: Date.now() + 10 * 60 * 1000
          });

          const successEmbed = new EmbedBuilder()
            .setTitle(`${EMOJI.giveaway} Tournament Setup Complete — Registration Open`)
            .setColor(result.warnings && result.warnings.length > 0 ? 0xFEE75C : 0x57F287)
            .setDescription(
              `${EMOJI.dividerBar}\n` +
              `${EMOJI.done} **${title}** has been provisioned in **${message.guild.name}**!\n` +
              `Registration is **OPEN** and the registration panel is active in \`#tournament-registration\`.\n` +
              `${EMOJI.dividerBar}`
            )
            .addFields(
              { name: `${EMOJI.sword} Slots & Tags`, value: `\`${slots} Slots\` • \`${tags} Tags/Team\``, inline: true },
              { name: `${EMOJI.golden} Group Allocation`, value: `\`${teamsPerGroup} Teams/Group\` (\`${groupsCount} Group(s)\`)`, inline: true },
              { name: `${EMOJI.done} Registration Status`, value: '`OPEN (Registration Active)`', inline: true },
              { name: `${EMOJI.admin} Created Category & Channels`, value: result.created.join('\n') || 'All channels active', inline: false },
              {
                name: `${EMOJI.golden} Registration Control`,
                value: `${EMOJI.done} Registration has started automatically and will continue until you run **\`/stop-registration\`**.`,
                inline: false
              }
            )
            .setFooter({ text: 'FFA-Manager • Registered teams will automatically receive @Verified Team' })
            .setTimestamp();

          if (result.warnings && result.warnings.length > 0) {
            successEmbed.addFields({
              name: `${EMOJI.alert} Partial Setup Warnings`,
              value: result.warnings.join('\n'),
              inline: false
            });
          }

          successEmbed.addFields({
            name: `${EMOJI.admin} Next Step — Provide Tournament Rules`,
            value: 'Please **reply with your Tournament Rules & Format** in this channel (or click the button below / use `/rules`) and I will publish them to `#tournament-rules`!',
            inline: false
          });

          return setupWaitMsg.edit({
            content: `${EMOJI.done} **Tournament Setup Complete! Registration is now OPEN in \`#tournament-registration\`:**`,
            embeds: [successEmbed],
            components: [this.createRulesButtonRow(result.tournamentId)]
          });
        } else {
          const rollbackNote = result.rolledBack && result.rolledBack.length > 0
            ? `\n🔄 **Rolled Back Partial Resources:** ${result.rolledBack.join(', ')}`
            : '';
          return setupWaitMsg.edit(`❌ **Setup Failed:** ${result.error || 'Check bot permissions'}${rollbackNote}`);
        }
      }

      const wizardEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} Tournament Setup & Auto-Generation Wizard`)
        .setColor(0x5865F2)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `Create a tournament instantly! The bot will validate permissions and automatically create:\n` +
          `${EMOJI.golden} **Tournament Category**\n` +
          `${EMOJI.admin} **#tournament-rules** (Information, format, & rules)\n` +
          `${EMOJI.sword} **#tournament-registration** (Tag-basis verification channel)\n` +
          `${EMOJI.golden} **#slot-list** (Live slots divided by Groups)\n` +
          `${EMOJI.giveaway} **#tournament-idp** (Public — Chat Locked)\n` +
          `${EMOJI.done} **@Verified Team Role** (Auto-assigned upon successful registration)\n\n` +
          `**Choose a quick preset below or reply with custom parameters:**\n` +
          `${EMOJI.dividerBar}`
        )
        .addFields(
          {
            name: `${EMOJI.sword} Quick Preset 1: Squad Scrims`,
            value: '`20 Slots` • `4 Tags` • `1 Group`',
            inline: true
          },
          {
            name: `${EMOJI.golden} Quick Preset 2: 2-Group Scrims`,
            value: '`32 Slots` • `4 Tags` • `2 Groups (A & B)`',
            inline: true
          },
          {
            name: `${EMOJI.giveaway} Quick Preset 3: 4-Group Championship`,
            value: '`48 Slots` • `4 Tags` • `4 Groups (A, B, C, D)`',
            inline: true
          },
          {
            name: `${EMOJI.sword} Quick Preset 4: Duo Scrims`,
            value: '`24 Slots` • `2 Tags` • `1 Group`',
            inline: true
          },
          {
            name: `${EMOJI.admin} Fast Command Syntax`,
            value: '`!setup <slots> <tags> <groups> [Tournament Name]`\n*Example:* `!setup 20 4 20 Glacier Cup S1`',
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
            tournamentId: res.tournamentId,
            expiresAt: Date.now() + 10 * 60 * 1000
          });

          const doneEmbed = new EmbedBuilder()
            .setTitle(`${EMOJI.giveaway} Tournament Auto-Created!`)
            .setColor(res.warnings && res.warnings.length > 0 ? 0xFEE75C : 0x57F287)
            .setDescription(
              `${EMOJI.dividerBar}\n` +
              `${EMOJI.done} **${chosenTitle}** is ready in **${interaction.guild?.name}**!\n` +
              `${EMOJI.dividerBar}`
            )
            .addFields(
              { name: `${EMOJI.golden} Configuration`, value: `\`${chosenSlots} Slots\` • \`${chosenTags} Tags/Team\` • \`${chosenGroups} Group(s)\``, inline: false },
              { name: `${EMOJI.admin} Created Channels & Role`, value: res.created.join('\n') || 'Channels ready', inline: false }
            )
            .setFooter({ text: 'Teams registering will be granted @Verified Team' });

          if (res.warnings && res.warnings.length > 0) {
            doneEmbed.addFields({
              name: `${EMOJI.alert} Partial Setup Warnings`,
              value: res.warnings.join('\n'),
              inline: false
            });
          }

          doneEmbed.addFields({
            name: `${EMOJI.admin} Next Step — Provide Tournament Rules`,
            value: 'Please **send your Tournament Rules & Format** in this channel (or click the button below) and I will post them in `#tournament-rules`!',
            inline: false
          });

          await promptMsg.edit({
            content: `${EMOJI.done} **Setup Complete! Please provide your tournament rules:**`,
            embeds: [doneEmbed],
            components: [this.createRulesButtonRow(res.tournamentId)]
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
      if (sub === 'close' || sub === 'stop') {
        const res = await this.stopRegistration(message.guild || undefined, 'Stopped by staff.', message.author.username, config);
        if (!res.success) return message.reply(`❌ ${res.error}`);
        return message.reply('🔴 **Tournament registrations are now CLOSED!**');
      } else if (sub === 'reset') {
        const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
        const tourneyTeams = this.getTeamsForTournament(config);
        if (message.guild) {
          for (const t of tourneyTeams) {
            await this.cleanupTeamWorkspace(message.guild, t).catch(() => {});
          }
        }
        const removeIds = new Set(tourneyTeams.map(t => t.id));
        for (let i = allTeams.length - 1; i >= 0; i--) {
          if (removeIds.has(allTeams[i].id)) allTeams.splice(i, 1);
        }
        config.status = 'open';
        config.explicitlyStoppedOrPaused = false;
        this.syncTournamentToRootConfig(config, false);
        if (this.onConfigUpdated) this.onConfigUpdated();
        await this.syncGuildChannels(config, message.guild);
        this.logEvent('warn', `Admin @${message.author.username} reset registrations via Discord command.`, message.guild?.name);
        return message.reply('🔄 **Tournament slots have been reset and registration channels updated.**');
      }
    }

    if (cmd === 'tagcheck' || cmd === 'gtagcheck') {
      const mentionedUser = message.mentions.users.first();
      const rawArg = args[0] || '';
      const idMatch = rawArg.match(/^<@!?(\d+)>$/) || rawArg.match(/^(\d{15,20})$/);

      if (mentionedUser || idMatch || (rawArg && isNaN(parseInt(rawArg, 10)))) {
        const targetId = this.normalizeMemberId(mentionedUser?.id || (idMatch ? idMatch[1] : rawArg));
        const targetName = mentionedUser?.username || targetId;
        const teams = this.getTeamsForTournament(config);
        const banned = this.blacklist.find(
          b => this.normalizeMemberId(b.userId) === targetId || b.username.toLowerCase() === targetName.toLowerCase()
        );
        const foundTeam = teams.find(
          t =>
            this.getTeamMemberIds(t).has(targetId) ||
            t.captain?.username?.toLowerCase() === targetName.toLowerCase() ||
            t.captain?.displayName?.toLowerCase() === targetName.toLowerCase() ||
            t.players.some(
              (p: any) =>
                p.username?.toLowerCase() === targetName.toLowerCase() ||
                p.displayName?.toLowerCase() === targetName.toLowerCase()
            )
        );

        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.admin} FFA | Glacier Cup Manager™ Player Tagcheck Dossier`)
          .setColor(banned ? 0xED4245 : foundTeam ? 0xFEE75C : 0x57F287)
          .setDescription(
            `${EMOJI.dividerBar}\n` +
            `Inspection results for <@${targetId}> (\`${targetName}\`):\n` +
            `${EMOJI.dividerBar}`
          )
          .addFields(
            {
              name: `${EMOJI.golden} Eligibility Status`,
              value: banned
                ? `${EMOJI.alert} **BLACKLISTED** — Reason: *${banned.reason}*`
                : foundTeam
                ? `${EMOJI.alert} **ALREADY REGISTERED** (Cannot join another team)`
                : `${EMOJI.done} **ELIGIBLE / FREE AGENT** (Cleared to register)`,
              inline: false
            }
          )
          .setTimestamp();

        if (foundTeam) {
          embed.addFields(
            { name: `${EMOJI.sword} Registered Team`, value: `**${foundTeam.teamName}**`, inline: true },
            { name: `${EMOJI.golden} Allocated Slot`, value: foundTeam.isWaitlist ? `Waitlist #${foundTeam.slotNumber}` : `Slot #${foundTeam.slotNumber} (${foundTeam.group || 'Group A'})`, inline: true },
            { name: `${EMOJI.admin} Team Captain`, value: `<@${foundTeam.captain.id}>`, inline: true }
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
      const teams = this.getTeamsForTournament(config);
      const confirmed = teams.filter(t => !t.isWaitlist);
      const waitlist = teams.filter(t => t.isWaitlist);
      const groupedChunks = this.formatGroupedSlotListChunks(confirmed, config);
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} ${config.title || 'Tournament'} — Live Slot List`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n${groupedChunks[0]}\n${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Confirmed Slots`, value: `\`${confirmed.length} / ${config.totalSlots}\``, inline: true },
          { name: `${EMOJI.sword} Teams Per Group`, value: `\`${config.teamsPerGroup || config.totalSlots || 20} Teams/Group\``, inline: true },
          { name: `${EMOJI.admin} Registration Status`, value: config.status === 'open' ? `${EMOJI.done} \`OPEN\`` : `${EMOJI.alert} \`LOCKED\``, inline: true }
        )
        .setTimestamp();
      if (waitlist.length > 0) {
        embed.addFields({
          name: `${EMOJI.alert} Waiting List (${waitlist.length}/${config.waitlistSlots})`,
          value: waitlist.map(w => `${EMOJI.golden} \`WL #${w.slotNumber}\` **${w.teamName}** — <@${w.captain.id}>`).join('\n').slice(0, 1020),
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
          `❌ **Failed to publish Room ID & Password:** ${res.error || 'Could not send to #tournament-idp.'}`
        );
      }
      const maskedId = roomId.length > 2 ? `***${roomId.slice(-2)}` : '***';
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.done} Room ID & Password Dispatched!`)
        .setColor(res.failedGuilds.length > 0 ? 0xFEE75C : 0x57F287)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `Credentials have been published to **#${config.idpChannel || 'tournament-idp'}** (${res.sentCount} channel(s) notified). Command message was auto-deleted to protect lobby credentials.\n` +
          `${EMOJI.dividerBar}`
        )
        .addFields(
          { name: `${EMOJI.golden} Room ID`, value: `\`${maskedId}\` *(See #tournament-idp)*`, inline: true },
          { name: `${EMOJI.admin} Password`, value: '`[REDACTED]` *(See #tournament-idp)*', inline: true },
          { name: `${EMOJI.sword} Map & Time`, value: `${mapName} • ${matchTime}`, inline: true }
        )
        .setTimestamp();

      if (res.failedGuilds.length > 0) {
        embed.addFields({
          name: `${EMOJI.alert} Publication Failures`,
          value: res.failedGuilds.map(f => `• **${f.guildName}**: ${f.reason}`).join('\n'),
          inline: false
        });
      }
      return (message.channel as TextChannel).send({ embeds: [embed] });
    }

    if (cmd === 'stop-registration' || cmd === 'stopreg' || cmd === 'lock') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const reason = args.join(' ') || 'Registration ended and channel locked by tournament administrator.';
      const res = await this.stopRegistration(message.guild || undefined, reason, message.author.username, config);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.alert} Tournament Registration Ended & Channel Locked`)
        .setColor(0xED4245)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `Registrations for **${config.title || 'Active Tournament'}** are now **CLOSED** and \`#${config.regChannel || 'tournament-registration'}\` has been **LOCKED**.\n` +
          `${EMOJI.admin} **Reason:** ${reason}\n` +
          `${EMOJI.dividerBar}`
        )
        .setFooter({ text: `Stopped by @${message.author.username}` })
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
          .setTitle(`${EMOJI.alert} Player Added to Tournament Blacklist`)
          .setColor(0xED4245)
          .setDescription(
            `${EMOJI.dividerBar}\n` +
            `Player <@${entry.userId}> (\`${entry.username}\`) is now banned from registering or being tagged in any squad.\n` +
            `${EMOJI.dividerBar}`
          )
          .addFields(
            { name: `${EMOJI.golden} Reason`, value: entry.reason, inline: true },
            { name: `${EMOJI.admin} Banned By`, value: `@${entry.addedBy}`, inline: true }
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
        return message.reply(removed ? `${EMOJI.done} Removed \`${targetId}\` from the tournament blacklist.` : `❌ Player \`${targetId}\` was not found on the blacklist.`);
      } else {
        const list = this.getBlacklist();
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.alert} Tournament Blacklist (${list.length})`)
          .setColor(0xED4245)
          .setDescription(
            `${EMOJI.dividerBar}\n` +
            (list.length > 0
              ? list.map((b, i) => `${EMOJI.golden} \`${i + 1}.\` <@${b.userId}> (\`${b.username}\`) — *${b.reason}*`).join('\n')
              : `${EMOJI.done} No players are currently blacklisted.`) +
            `\n${EMOJI.dividerBar}`
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
      const teams = this.getTeamsForTournament(config);
      const slotNum = parseInt(query.replace(/\D/g, ''), 10);
      const found = (!isNaN(slotNum) && String(slotNum) === query.replace('#', ''))
        ? teams.find(t => t.slotNumber === slotNum)
        : teams.find(t => t.teamName.toLowerCase().includes(query.toLowerCase()));

      if (!found) {
        return message.reply(`❌ No registered team matching \`${query}\` found.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.sword} Team Dossier — ${found.teamName}`)
        .setColor(found.isWaitlist ? 0xFEE75C : 0x5865F2)
        .setDescription(`${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Slot Allocation`, value: found.isWaitlist ? `\`Waitlist #${found.slotNumber}\`` : `\`Slot #${found.slotNumber}\``, inline: true },
          { name: `${EMOJI.golden} Assigned Group`, value: `\`${found.group || 'Group A'}\``, inline: true },
          { name: `${EMOJI.admin} Team Captain`, value: `<@${found.captain.id}>`, inline: true },
          {
            name: `${EMOJI.sword} Verified Roster (${found.players.length} Players)`,
            value: found.players.map((p: any, idx: number) => `${EMOJI.golden} \`${idx + 1}.\` <@${p.id}> (\`${p.displayName || p.username}\`)`).join('\n') || 'None',
            inline: false
          },
          { name: `${EMOJI.giveaway} Registered At`, value: new Date(found.registeredAt).toLocaleString(), inline: true },
          { name: `${EMOJI.admin} Team Role & Tourney Role`, value: `${found.teamRoleId ? `<@&${found.teamRoleId}>` : `\`@${found.teamRoleName || found.teamName}\``} • \`@${config.verifiedRoleName || 'Verified Team'}\``, inline: true },
          {
            name: `${EMOJI.done} Team Category & Private VC`,
            value: `📁 \`${found.teamCategoryName || found.teamName}\` • 🔊 ${found.teamVoiceChannelId ? `<#${found.teamVoiceChannelId}>` : `\`${found.teamVoiceChannelName || found.teamName}\``}`,
            inline: false
          }
        )
        .setFooter({ text: `Team ID: ${found.id}` })
        .setTimestamp();
      const voiceUrl =
        message.guild && found.teamVoiceChannelId
          ? await this.resolveVoiceConnectUrl(message.guild, found.teamVoiceChannelId, found.teamVoiceInviteUrl)
          : undefined;
      const components =
        message.guild && found.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(message.guild.id, found.teamVoiceChannelId, found.teamVoiceChannelName || found.teamName, voiceUrl)]
          : [];
      return message.reply({ embeds: [embed], components });
    }

    if (cmd === 'standings' || cmd === 'points' || cmd === 'leaderboard') {
      const teams = this.getTeamsForTournament(config).filter(t => !t.isWaitlist);
      const groupFilter = args[0] ? `Group ${args[0].toUpperCase().replace('GROUP', '').trim()}` : null;
      const filtered = groupFilter ? teams.filter(t => (t.group || 'Group A').toLowerCase() === groupFilter.toLowerCase()) : teams;

      const rows = filtered.slice(0, 15).map((t, idx) => {
        const wins = idx === 0 ? 2 : idx === 1 ? 1 : 0;
        const placePts = Math.max(4, 28 - idx * 4);
        const killPts = Math.max(2, 22 - idx * 3);
        const total = placePts + killPts;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${EMOJI.golden} \`#${idx + 1}\``;
        return `${medal} **${t.teamName}** (Slot #${t.slotNumber}) — **${total} Pts** *(Wins: ${wins} | Finishes: ${killPts})*`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} ${config.title} — Official Standings ${groupFilter ? `(${groupFilter})` : ''}`)
        .setColor(0xFEE75C)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          (rows.length > 0 ? rows.join('\n') : '*No confirmed teams to rank yet.*') +
          `\n${EMOJI.dividerBar}`
        )
        .addFields({
          name: `${EMOJI.sword} Official Scoring Matrix`,
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
        const pubRes = await this.publishRulesToChannel(message.guild, customText, message.author.username, config);
        if (pubRes.success) {
          const embed = new EmbedBuilder()
            .setTitle(`${EMOJI.done} Tournament Rules Published!`)
            .setColor(0x57F287)
            .setDescription(
              `${EMOJI.dividerBar}\n` +
              `${EMOJI.golden} Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!\n` +
              `${EMOJI.dividerBar}`
            )
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
          tournamentId: config?.id,
          expiresAt: Date.now() + 10 * 60 * 1000
        });
        const promptEmbed = new EmbedBuilder()
          .setTitle(`${EMOJI.admin} Set Tournament Rules & Format`)
          .setColor(0x5865F2)
          .setDescription(
            `${EMOJI.dividerBar}\n` +
            `Please **reply with your Tournament Rules & Format** as your next message in this channel (or click the button below), and I will publish it directly to \`#tournament-rules\`!\n` +
            `${EMOJI.dividerBar}`
          )
          .setFooter({ text: 'FFA-Manager Rules Publisher' });
        return message.reply({ embeds: [promptEmbed], components: [this.createRulesButtonRow(config?.id)] });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.admin} ${config.title} — Official Tournament Rulebook`)
        .setColor(0x5865F2)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          (config.customRules || '*No custom rules have been published yet. Staff can run `/rules` or `!rules <text>` to set and post rules to `#tournament-rules`.*') +
          `\n${EMOJI.dividerBar}`
        )
        .setFooter({ text: 'FFA-Manager' })
        .setTimestamp();
      return message.reply({
        embeds: [embed],
        components: isStaff ? [this.createRulesButtonRow(config?.id)] : []
      });
    }

    if (cmd === 'announce') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const announcementText = args.join(' ').trim();
      if (!announcementText) {
        return message.reply('❌ Usage: `!announce <your official tournament message>`');
      }
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} Official Tournament Announcement — ${config.title}`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n${announcementText}\n${EMOJI.dividerBar}`)
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
      const res = await this.swapSlots(s1, s2, message.guild || undefined, config);
      if (!res.success) {
        return message.reply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.done} Slots Swapped Successfully`)
        .setColor(0x57F287)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `Swapped **Slot #${s1}** (${res.group1}) and **Slot #${s2}** (${res.group2}). The \`#slot-list\` channel has been updated!\n` +
          `${EMOJI.dividerBar}`
        )
        .addFields(
          { name: `${EMOJI.golden} Slot #${s1} (${res.group1})`, value: res.team2 ? `**${res.team2.teamName}**` : '*Open Slot*', inline: true },
          { name: `${EMOJI.golden} Slot #${s2} (${res.group2})`, value: res.team1 ? `**${res.team1.teamName}**` : '*Open Slot*', inline: true }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (cmd === 'export') {
      if (!isStaff) return message.reply('❌ Permission denied.');
      const format = (args[0] || 'markdown').toLowerCase() === 'csv' ? 'csv' : 'markdown';
      const allTeams = this.getTeamsForTournament(config);
      const output = this.generateRosterExport(format, true, config);
      const safeOutput = output.length > 3800 ? output.slice(0, 3800) + '\n...truncated' : output;
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} Exported Tournament Roster (${allTeams.length} Teams)`)
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
        const result = await this.deleteSlot(slotNum, message.guild || undefined, { tournamentId: config?.id }, config);
        if (result.success && result.deletedTeam) {
          const embed = new EmbedBuilder()
            .setTitle(`${EMOJI.alert} Slot Deleted Successfully`)
            .setColor(result.syncWarnings && result.syncWarnings.length > 0 ? 0xFEE75C : 0xED4245)
            .setDescription(
              `${EMOJI.dividerBar}\n` +
              `**Slot #${slotNum}** (${result.deletedTeam.teamName}) has been removed.\n` +
              `${EMOJI.dividerBar}`
            )
            .addFields(
              { name: `${EMOJI.sword} Removed Team`, value: `**${result.deletedTeam.teamName}** (Captain: <@${result.deletedTeam.captain.id}>)`, inline: false },
              {
                name: `${EMOJI.golden} Waitlist Promotion`,
                value: result.promotedTeam
                  ? `${EMOJI.done} **${result.promotedTeam.teamName}** was auto-promoted from the waitlist to confirmed **Slot #${result.promotedTeam.slotNumber}** (${result.promotedTeam.group || 'Group A'})!`
                  : 'ℹ️ No teams on the waitlist to promote.',
                inline: false
              }
            )
            .setTimestamp();

          if (result.syncWarnings && result.syncWarnings.length > 0) {
            embed.addFields({
              name: `${EMOJI.alert} Role / Channel Sync Notice`,
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
          const preview = await this.previewDeleteTournament(message.guild || undefined, true, config);
          const previewEmbed = new EmbedBuilder()
            .setTitle(`${EMOJI.alert} Confirm Destructive Action — Delete Tournament`)
            .setColor(0xFEE75C)
            .setDescription(
              `${EMOJI.dividerBar}\n` +
              `You are about to delete **${preview.title}** and reset all registered rosters. Please review what will be removed and confirm below:\n` +
              `${EMOJI.dividerBar}`
            )
            .addFields(
              { name: `${EMOJI.sword} Rosters to Clear`, value: `\`${preview.confirmedCount} Confirmed\` • \`${preview.waitlistCount} Waitlist\``, inline: true },
              { name: `${EMOJI.golden} Categories to Delete`, value: preview.categoriesToDelete.length > 0 ? preview.categoriesToDelete.join('\n') : '*(None)*', inline: true },
              { name: `${EMOJI.sword} Voice Channels to Delete`, value: preview.voiceChannelsToDelete.length > 0 ? preview.voiceChannelsToDelete.slice(0, 8).join('\n') + (preview.voiceChannelsToDelete.length > 8 ? `\n...and ${preview.voiceChannelsToDelete.length - 8} more` : '') : '*(None)*', inline: false },
              { name: `${EMOJI.admin} Team Roles to Delete`, value: preview.rolesToDelete.length > 0 ? preview.rolesToDelete.slice(0, 8).join('\n') + (preview.rolesToDelete.length > 8 ? `\n...and ${preview.rolesToDelete.length - 8} more` : '') : '*(None)*', inline: true },
              { name: `${EMOJI.golden} Text Channels to Delete`, value: preview.textChannelsToDelete.length > 0 ? preview.textChannelsToDelete.join('\n') : '*(None)*', inline: true }
            )
            .setFooter({ text: 'Click Confirm below or run !delete tournament confirm' })
            .setTimestamp();

          return message.reply({
            embeds: [previewEmbed],
            components: [this.createDeleteConfirmRow(true, config?.id)]
          });
        }

        const result = await this.deleteTournament(message.guild || undefined, true, config);
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.alert} Tournament Deleted & All Tournament Assets Removed`)
          .setColor(0xED4245)
          .setDescription(
            `${EMOJI.dividerBar}\n` +
            `The active tournament has been deleted. All categories, voice channels, text channels, and team roles have been removed from **${message.guild?.name || 'the server'}**.\n` +
            `${EMOJI.dividerBar}`
          )
          .addFields(
            {
              name: `${EMOJI.golden} Deleted Categories`,
              value: result.deletedCategories.length > 0 ? result.deletedCategories.slice(0, 10).join('\n') + (result.deletedCategories.length > 10 ? `\n...and ${result.deletedCategories.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.sword} Deleted Voice Channels`,
              value: result.deletedVoiceChannels.length > 0 ? result.deletedVoiceChannels.slice(0, 10).join('\n') + (result.deletedVoiceChannels.length > 10 ? `\n...and ${result.deletedVoiceChannels.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.admin} Deleted Roles`,
              value: result.deletedRoles.length > 0 ? result.deletedRoles.slice(0, 10).join('\n') + (result.deletedRoles.length > 10 ? `\n...and ${result.deletedRoles.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.golden} Deleted Text Channels`,
              value: result.deletedTextChannels.length > 0 ? result.deletedTextChannels.join('\n') : '*(None)*',
              inline: false
            },
            {
              name: `${EMOJI.done} Cleared Rosters & Slots`,
              value: `\`${result.clearedTeamsCount} Team(s) cleared\` • Tournament status set to CLOSED`,
              inline: false
            }
          )
          .setFooter({ text: 'FFA | Glacier Cup Manager™ • Run /setup or !setup to create a new tournament' })
          .setTimestamp();
        return message.reply({ embeds: [embed] }).catch(() => {});
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

    if (config.status !== 'open' && config.explicitlyStoppedOrPaused) {
      await this.sendErrorAndAutoDelete(
        message,
        `Registrations are currently **CLOSED** (stopped by staff).`
      );
      this.logEvent('info', `Registration notice for @${message.author.username}: registrations are ${config.status}`, message.guild?.name);
      return;
    }

    const existingTeams = this.getTeamsForTournament(config);

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
          found = searched?.find(
            m =>
              m.user.username.toLowerCase() === name ||
              m.displayName.toLowerCase() === name ||
              m.user.globalName?.toLowerCase() === name
          );
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

    if (allOrderedTagIds.length !== new Set(allOrderedTagIds).size) {
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
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
              isBot: false
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
          avatar: u.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          isBot: Boolean(u.bot)
        });
      } catch {
        if (isValidDiscordSnowflake(uid)) {
          playersList.push({
            id: uid,
            username: `user_${uid.slice(-4)}`,
            displayName: `Player ${uid.slice(-4)}`,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
            isBot: false
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

    const rosterValidation = this.validateTeamRegistrationRoster({
      teamName,
      captainId: message.author.id,
      players: playersList,
      config,
      existingTeams
    });

    if (!rosterValidation.valid) {
      await this.sendErrorAndAutoDelete(message, rosterValidation.error || 'Registration validation failed.');
      this.logEvent(
        'info',
        `Registration rejected for @${message.author.username} (${rosterValidation.code}): ${rosterValidation.error}`,
        message.guild?.name
      );
      return;
    }

    const allMemberIds = Array.from(new Set([message.author.id, ...taggedUserIds]));
    this.markMembersInFlight(allMemberIds, true);

    try {
      const allocationResult = await this.withOperationLock(async () => {
        const latestTeams = this.getTeamsForTournament(config);
        const lockValidation = this.validateTeamRegistrationRoster({
          teamName,
          captainId: message.author.id,
          players: playersList,
          config: { ...config },
          existingTeams: latestTeams
        });
        if (!lockValidation.valid && lockValidation.code !== 'MEMBER_IN_FLIGHT') {
          return {
            ok: false as const,
            error: lockValidation.error || 'Registration validation failed.'
          };
        }

        const currentConfirmed = latestTeams.filter(t => !t.isWaitlist);
        const currentWaitlist = latestTeams.filter(t => t.isWaitlist);
        const isWaitlist = currentConfirmed.length >= config.totalSlots;

        let slotNumber = 1;
        if (isWaitlist) {
          slotNumber = currentWaitlist.length + 1;
        } else {
          const usedSlots = new Set(currentConfirmed.map(t => t.slotNumber));
          while (usedSlots.has(slotNumber) && slotNumber <= config.totalSlots) {
            slotNumber++;
          }
        }

        const assignedGroup = isWaitlist ? undefined : this.calculateGroupForSlot(slotNumber, config);

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
          tournamentId: config.id || undefined,
          slotNumber,
          teamName,
          captain: {
            id: message.author.id,
            username: message.author.username,
            displayName: message.author.displayName || message.author.username,
            avatar: message.author.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${message.author.id}`
          },
          players: playersList.map(({ isBot, ...rest }) => rest),
          registeredAt: new Date().toISOString(),
          messageId: message.id,
          channelId: message.channel.id,
          isWaitlist,
          group: assignedGroup,
          teamRoleName: teamName,
          teamCategoryName: 'Team Voice Lobbies',
          teamVoiceChannelName: teamName,
          whatsappNumber1: parsedWhatsapp1,
          region: parsedRegion
        };

        if (this.onTeamRegistered) {
          this.onTeamRegistered(newTeam);
        }
        const updatedTeams = this.getTeamsForTournament(config);
        const updatedConfirmedCount = updatedTeams.filter(t => !t.isWaitlist).length;

        return {
          ok: true as const,
          newTeam,
          slotNumber,
          isWaitlist,
          assignedGroup,
          updatedConfirmedCount
        };
      });

      if (!allocationResult.ok) {
        await this.sendErrorAndAutoDelete(message, allocationResult.error);
        return;
      }

      const { newTeam, slotNumber, isWaitlist, assignedGroup, updatedConfirmedCount } = allocationResult;

      this.logEvent(
        'success',
        `✅ Slot ${isWaitlist ? `WL #${slotNumber}` : `#${slotNumber} (${assignedGroup})`} confirmed for Team "${teamName}" (Captain: @${newTeam.captain.displayName}, ${playersList.length} tags verified)`,
        message.guild?.name
      );

      await message.react('✅').catch(() => {});

      if (message.guild) {
        await this.syncTeamRolesForRegistration(message.guild, newTeam, config).catch(() => {});
      }

      const idpChannel = message.guild ? this.resolveIdpChannel(message.guild, config) : undefined;

      const embed = new EmbedBuilder()
        .setTitle(isWaitlist ? `${EMOJI.alert} Added to Waiting List` : `${EMOJI.done} Tournament Registration Confirmed!`)
        .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
        .setDescription(
          (isWaitlist
            ? `${EMOJI.sword} Team **${teamName}** secured **Waitlist #${slotNumber}**.`
            : `${EMOJI.giveaway} Congratulations! **${teamName}** has secured **Slot #${slotNumber}** for **${config.title}**!`) +
          `\n${EMOJI.dividerBar}`
        )
        .addFields(
          { name: `${EMOJI.sword} Team Name`, value: `\`${teamName}\``, inline: true },
          { name: isWaitlist ? `${EMOJI.alert} Waitlist Position` : `${EMOJI.golden} Allocated Slot`, value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
          { name: `${EMOJI.giveaway} Remaining Slots`, value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
          { name: `${EMOJI.golden} Region`, value: `\`${newTeam.region || 'India'}\``, inline: true },
          { name: `${EMOJI.admin} WhatsApp No`, value: newTeam.whatsappNumber1 ? `\`${newTeam.whatsappNumber1}\`` : '`Not provided`', inline: true },
          { name: `${EMOJI.golden} Captain`, value: `<@${newTeam.captain.id}>`, inline: true },
          { name: `${EMOJI.done} Roster Tags (Voice Role Granted)`, value: taggedUserIds.map((id, i) => `${EMOJI.sword} \`${i + 1}.\` <@${id}>`).join('\n') },
          {
            name: `${EMOJI.admin} Voice Channel Role & Tourney Role`,
            value: `${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${newTeam.teamRoleName || teamName}\``}${isWaitlist ? ' *(Waitlist)*' : ` • \`@${config.verifiedRoleName || 'Verified Team'}\``}`,
            inline: true
          },
          {
            name: `${EMOJI.golden} Team Category & Private VC`,
            value: newTeam.teamVoiceChannelId
              ? `📁 **${newTeam.teamCategoryName || 'Team Voice Lobbies'}**\n🔊 <#${newTeam.teamVoiceChannelId}> *(All team members granted ${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${newTeam.teamRoleName || teamName}\``} to join)*`
              : `📁 **Team Voice Lobbies**\n🔊 \`${teamName}\` *(Private Team VC)*`,
            inline: true
          },
          { name: `${EMOJI.giveaway} Match Room Channel`, value: idpChannel ? `<#${idpChannel.id}> *(Credentials before match)*` : '`#tournament-idp` *(Credentials before match)*', inline: false }
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Voice Channel Role granted to all team members' })
        .setTimestamp();

      const voiceConnectUrl =
        message.guild && newTeam.teamVoiceChannelId
          ? await this.resolveVoiceConnectUrl(message.guild, newTeam.teamVoiceChannelId, newTeam.teamVoiceInviteUrl)
          : undefined;

      const components =
        message.guild && newTeam.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(message.guild.id, newTeam.teamVoiceChannelId, newTeam.teamVoiceChannelName || teamName, voiceConnectUrl)]
          : [];

      await message.reply({ embeds: [embed], components }).catch(() => {});

      await this.syncGuildChannels(config, message.guild).catch(() => {});
    } finally {
      this.markMembersInFlight(allMemberIds, false);
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

    if (config.status === 'closed' && config.explicitlyStoppedOrPaused) {
      await interaction.editReply(
        '🔴 Registrations are currently **CLOSED** (stopped by tournament staff).'
      );
      return;
    }

    const existingTeams = this.getTeamsForTournament(config);
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

    if (allOrderedTagIds.length !== new Set(allOrderedTagIds).size) {
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
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
              isBot: false
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
          avatar: (typeof u.displayAvatarURL === 'function' ? u.displayAvatarURL() : null) || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          isBot: Boolean(u.bot)
        });
      } catch {
        if (isValidDiscordSnowflake(uid)) {
          playersList.push({
            id: uid,
            username: `user_${uid.slice(-4)}`,
            displayName: `Player ${uid.slice(-4)}`,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
            isBot: false
          });
        }
      }
    }

    const rosterValidation = this.validateTeamRegistrationRoster({
      teamName,
      captainId: interaction.user.id,
      players: playersList,
      config,
      existingTeams
    });

    if (!rosterValidation.valid) {
      await interaction.editReply(`❌ **${rosterValidation.error || 'Registration validation failed.'}**`);
      return;
    }

    const allMemberIds = Array.from(new Set([interaction.user.id, ...taggedUserIds]));
    this.markMembersInFlight(allMemberIds, true);

    try {
      let registeredNewTeam: any = null;
      let isWaitlist = false;
      let slotNumber = 1;
      let assignedGroup: string | undefined = undefined;
      let updatedConfirmedCount = 0;

      const lockOutcome = await this.withOperationLock(async () => {
        const latestTeams = this.getTeamsForTournament(config);
        const lockValidation = this.validateTeamRegistrationRoster({
          teamName,
          captainId: interaction.user.id,
          players: playersList,
          config: { ...config },
          existingTeams: latestTeams
        });
        if (!lockValidation.valid && lockValidation.code !== 'MEMBER_IN_FLIGHT') {
          return { valid: false, error: lockValidation.error || 'Registration validation failed.' };
        }

        const currentConfirmed = latestTeams.filter(t => !t.isWaitlist);
        const currentWaitlist = latestTeams.filter(t => t.isWaitlist);
        isWaitlist = currentConfirmed.length >= config.totalSlots;

        slotNumber = 1;
        if (isWaitlist) {
          slotNumber = currentWaitlist.length + 1;
        } else {
          const usedSlots = new Set(currentConfirmed.map(t => t.slotNumber));
          while (usedSlots.has(slotNumber) && slotNumber <= config.totalSlots) {
            slotNumber++;
          }
        }

        assignedGroup = isWaitlist ? undefined : this.calculateGroupForSlot(slotNumber, config);

        registeredNewTeam = {
          id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tournamentId: config.id || undefined,
          slotNumber,
          teamName,
          captain: {
            id: interaction.user.id,
            username: interaction.user.username,
            displayName: interaction.user.displayName || interaction.user.username,
            avatar: interaction.user.displayAvatarURL() || `https://api.dicebear.com/7.x/bottts/svg?seed=${interaction.user.id}`
          },
          players: playersList.map(({ isBot, ...rest }) => rest),
          registeredAt: new Date().toISOString(),
          messageId: `modal-${interaction.id}`,
          channelId: interaction.channelId || config.regChannel || 'registration',
          isWaitlist,
          group: assignedGroup,
          teamRoleName: teamName,
          teamCategoryName: 'Team Voice Lobbies',
          teamVoiceChannelName: teamName,
          whatsappNumber1: cleanWa1,
          region: parsedRegion
        };

        if (this.onTeamRegistered) {
          this.onTeamRegistered(registeredNewTeam);
        }
        const updatedTeams = this.getTeamsForTournament(config);
        updatedConfirmedCount = updatedTeams.filter(t => !t.isWaitlist).length;
        this.pendingRegistrationDrafts.delete(interaction.user.id);

        return { valid: true };
      });

      if (!lockOutcome.valid || !registeredNewTeam) {
        await interaction.editReply(`❌ **${lockOutcome.error || 'Registration validation failed.'}**`);
        return;
      }

      const newTeam = registeredNewTeam;

      this.logEvent(
        'success',
        `✅ Slot ${isWaitlist ? `WL #${slotNumber}` : `#${slotNumber} (${assignedGroup})`} confirmed via Registration Panel for Team "${teamName}" (${parsedRegion}, Captain: @${newTeam.captain.displayName}, ${playersList.length} tags verified)`,
        interaction.guild?.name
      );

      if (interaction.guild) {
        await this.syncTeamRolesForRegistration(interaction.guild, newTeam, config).catch(() => {});
      }

      const idpChannel = interaction.guild ? this.resolveIdpChannel(interaction.guild, config) : undefined;

      const privateConfirmEmbed = new EmbedBuilder()
        .setTitle(isWaitlist ? `${EMOJI.alert} Added to Waiting List` : `${EMOJI.done} Tournament Registration Confirmed!`)
        .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
        .setDescription(
          (isWaitlist
            ? `${EMOJI.sword} Team **${teamName}** secured **Waitlist #${slotNumber}**.`
            : `${EMOJI.giveaway} Congratulations! **${teamName}** has secured **Slot #${slotNumber}** for **${config.title}**!`) +
          `\n${EMOJI.dividerBar}`
        )
        .addFields(
          { name: `${EMOJI.sword} Team Name`, value: `\`${teamName}\``, inline: true },
          { name: isWaitlist ? `${EMOJI.alert} Waitlist Position` : `${EMOJI.golden} Allocated Slot`, value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
          { name: `${EMOJI.giveaway} Remaining Slots`, value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
          { name: `${EMOJI.golden} Region`, value: `\`${newTeam.region || 'India'}\``, inline: true },
          { name: `${EMOJI.admin} WhatsApp No`, value: newTeam.whatsappNumber1 ? `\`${newTeam.whatsappNumber1}\`` : '`Not provided`', inline: true },
          { name: `${EMOJI.golden} Captain`, value: `<@${newTeam.captain.id}>`, inline: true },
          { name: `${EMOJI.done} Roster Tags (Voice Role Granted)`, value: taggedUserIds.map((id, i) => `${EMOJI.sword} \`${i + 1}.\` <@${id}>`).join('\n') },
          {
            name: `${EMOJI.admin} Voice Channel Role & Tourney Role`,
            value: `${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${newTeam.teamRoleName || teamName}\``}${isWaitlist ? ' *(Waitlist)*' : ` • \`@${config.verifiedRoleName || 'Verified Team'}\``}`,
            inline: true
          },
          {
            name: `${EMOJI.golden} Team Category & Private VC`,
            value: newTeam.teamVoiceChannelId
              ? `📁 **${newTeam.teamCategoryName || 'Team Voice Lobbies'}**\n🔊 <#${newTeam.teamVoiceChannelId}> *(All team members granted ${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${newTeam.teamRoleName || teamName}\``} to join)*`
              : `📁 **Team Voice Lobbies**\n🔊 \`${teamName}\` *(Private Team VC)*`,
            inline: true
          },
          { name: `${EMOJI.giveaway} Match Room Channel`, value: idpChannel ? `<#${idpChannel.id}> *(Credentials before match)*` : '`#tournament-idp` *(Credentials before match)*', inline: false }
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Voice Channel Role granted to all team members' })
        .setTimestamp();

      const voiceConnectUrl =
        interaction.guild && newTeam.teamVoiceChannelId
          ? await this.resolveVoiceConnectUrl(interaction.guild, newTeam.teamVoiceChannelId, newTeam.teamVoiceInviteUrl)
          : undefined;

      const privateComponents: ActionRowBuilder<ButtonBuilder>[] = [];
      if (interaction.guild && newTeam.teamVoiceChannelId) {
        privateComponents.push(
          this.createVoiceConnectButtonRow(
            interaction.guild.id,
            newTeam.teamVoiceChannelId,
            newTeam.teamVoiceChannelName || teamName,
            voiceConnectUrl
          )
        );
      }
      privateComponents.push(this.createCaptainControlsRow(newTeam, config));

      await interaction.editReply({ embeds: [privateConfirmEmbed], components: privateComponents });

      if (interaction.guild) {
        const regCh =
          this.resolveRegistrationChannel(interaction.guild, config) ||
          (interaction.channelId ? (interaction.guild.channels.cache.get(interaction.channelId) as TextChannel | undefined) : undefined);

        if (regCh) {
          const publicEmbed = new EmbedBuilder()
            .setTitle(isWaitlist ? `${EMOJI.alert} Team Added to Waiting List` : `${EMOJI.done} Team Registration Confirmed!`)
            .setColor(isWaitlist ? 0xFEE75C : 0x57F287)
            .setDescription(
              (isWaitlist
                ? `${EMOJI.sword} **${teamName}** (<@${interaction.user.id}>) secured **Waitlist #${slotNumber}**.`
                : `${EMOJI.giveaway} **${teamName}** (<@${interaction.user.id}>) has secured **Slot #${slotNumber}** (${assignedGroup}) for **${config.title}**!`) +
              `\n${EMOJI.dividerBar}`
            )
            .addFields(
              { name: `${EMOJI.sword} Team Name`, value: `\`${teamName}\``, inline: true },
              { name: isWaitlist ? `${EMOJI.alert} Waitlist Position` : `${EMOJI.golden} Allocated Slot`, value: isWaitlist ? `\`#WL-${slotNumber}\`` : `\`Slot #${slotNumber}\` (${assignedGroup})`, inline: true },
              { name: `${EMOJI.giveaway} Remaining Slots`, value: `\`${Math.max(0, config.totalSlots - updatedConfirmedCount)}\``, inline: true },
              { name: `${EMOJI.golden} Region`, value: `\`${newTeam.region || 'India'}\``, inline: true },
              {
                name: `${EMOJI.admin} Voice Channel & Role`,
                value: newTeam.teamVoiceChannelId
                  ? `🔊 <#${newTeam.teamVoiceChannelId}> (${newTeam.teamRoleId ? `<@&${newTeam.teamRoleId}>` : `\`@${newTeam.teamRoleName || teamName}\``})`
                  : `\`@${newTeam.teamRoleName || teamName}\``,
                inline: true
              },
              { name: `${EMOJI.done} Roster Tags (Voice Role Assigned)`, value: taggedUserIds.map((id, i) => `${EMOJI.sword} \`${i + 1}.\` <@${id}>`).join('\n'), inline: false }
            )
            .setFooter({ text: 'FFA | Glacier Cup Manager™ • Registration remains open until /stop-registration' })
            .setTimestamp();

          const publicComponents = newTeam.teamVoiceChannelId
            ? [this.createVoiceConnectButtonRow(interaction.guild.id, newTeam.teamVoiceChannelId, newTeam.teamVoiceChannelName || teamName, voiceConnectUrl)]
            : [];

          await regCh.send({ embeds: [publicEmbed], components: publicComponents }).catch(() => {});
        }
      }

      await this.syncGuildChannels(config, interaction.guild).catch(() => {});
    } finally {
      this.markMembersInFlight(allMemberIds, false);
    }
  }

  private scheduleSlotListUpdate(guild: any, config: any) {
    if (!guild) return;
    const timerKey = `${guild.id}:${config?.id || 'default'}`;
    const existingTimer = this.slotListUpdateTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.slotListUpdateTimers.delete(timerKey);
      this.updateSlotListChannel(guild, config).catch(() => {});
    }, 600);
    this.slotListUpdateTimers.set(timerKey, timer);
  }

  private async sendErrorAndAutoDelete(message: Message, errorMsg: string, tournamentConfig?: any) {
    const config =
      tournamentConfig ||
      this.resolveTournamentContext(message.guild, message.channel.id) ||
      (this.getTournamentConfig ? this.getTournamentConfig() : null);
    const autoDeleteEnabled = config?.autoDeleteInvalid !== false;
    const delaySeconds = Math.max(2, Math.min(30, config?.autoDeleteSeconds || 8));

    const reqTags = Math.max(1, config?.requiredTags || 4);
    const playerLines = Array.from({ length: reqTags }, (_, i) => `Player ${i + 1}: @Player${i + 1}`).join('\n');
    const formatExample = `Team Name: Glacier Titans\nRegion: India\nWhatsApp: +91XXXXXXXXXX\n${playerLines}`;

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.alert} Registration Rejected — Tagcheck Notice`)
      .setColor(0xED4245)
      .setDescription(`${errorMsg}\n${EMOJI.dividerBar}`)
      .addFields(
        {
          name: `${EMOJI.golden} Required Format`,
          value: `\`\`\`text\n${formatExample}\n\`\`\`\n*(Replace \`Glacier Titans\` with your actual team name)*`,
          inline: false
        },
        {
          name: `${EMOJI.sword} EasyTag Tip`,
          value: 'Select usernames from Discord\'s `@` popup, or paste valid 17–20 digit Discord User IDs directly.',
          inline: false
        }
      )
      .setFooter({
        text: autoDeleteEnabled
          ? `This notice and your message will auto-delete in ${delaySeconds} seconds to keep #tournament-registration clean.`
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
      `${EMOJI.admin} **Confidential Staff Roster & Contact Directory** *(Visible only to \`@${managerRoleName}\`)*\n` +
      `${EMOJI.done} **Confirmed Teams:** \`${confirmed.length} / ${totalSlots}\` • ${EMOJI.alert} **Waitlist:** \`${waitlist.length}\` • ${EMOJI.sword} **Required Tags:** \`${reqTags}\`\n` +
      `${EMOJI.dividerBar}`;

    if (confirmed.length === 0 && waitlist.length === 0) {
      return [
        new EmbedBuilder()
          .setTitle(`${EMOJI.admin} ${title} — Registration Details (Sequence View)`)
          .setColor(0xF59E0B)
          .setDescription(`${headerInfo}\n\n*No teams registered yet. As teams submit registrations, their full details (Team Name, Region, WhatsApp Number, and Players Tags) will appear here in strict slot sequence.*`)
          .setFooter({ text: `Restricted to @${managerRoleName} • FFA | Glacier Cup Manager™` })
          .setTimestamp()
      ];
    }

    const formatTeamEntry = (t: any, isWl: boolean) => {
      const slotStr = t.slotNumber < 10 ? `0${t.slotNumber}` : `${t.slotNumber}`;
      const assignedGroup = isWl ? 'Waitlist' : (t.group || this.calculateGroupForSlot(t.slotNumber, config));
      const statusLabel = isWl ? `${EMOJI.alert} Waitlisted` : `${EMOJI.done} Confirmed`;
      const badge = isWl
        ? `${EMOJI.alert} **WAITLIST #${slotStr}** • **Status:** ${statusLabel}`
        : `${EMOJI.golden} **SLOT #${slotStr}** • **${assignedGroup}** • **Status:** ${statusLabel}`;
      const regionStr = t.region || 'India';
      const wpStr = t.whatsappNumber1 || 'Not provided';
      const capId = this.normalizeMemberId(t.captain?.id);
      const captainMention =
        capId && /^\d{15,20}$/.test(capId)
          ? `<@${capId}> (\`@${t.captain?.username || t.captain?.displayName || capId}\`)`
          : `\`@${t.captain?.displayName || t.captain?.username || 'Unknown'}\``;
      const playerMentions =
        Array.isArray(t.players) && t.players.length > 0
          ? t.players
              .map((p: any, i: number) => {
                const pid = this.normalizeMemberId(p?.id);
                return pid && /^\d{15,20}$/.test(pid)
                  ? `\`${i + 1}.\` <@${pid}>`
                  : `\`${i + 1}.\` \`@${p?.displayName || p?.username || pid || 'Player'}\``;
              })
              .join(' • ')
          : '*None*';
      return (
        `${badge}\n` +
        `┣ ${EMOJI.sword} **Team Name:** \`${t.teamName}\` (${isWl ? `Waitlist #${slotStr}` : `Slot #${slotStr} • ${assignedGroup}`})\n` +
        `┣ ${EMOJI.golden} **Captain:** ${captainMention}\n` +
        `┣ ${EMOJI.done} **Registered Players (${(t.players || []).length}):** ${playerMentions}\n` +
        `┗ ${EMOJI.admin} **Region & Contact:** \`${regionStr}\` • 📱 \`${wpStr}\``
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
            ? `${EMOJI.admin} ${title} — Registration Details (Sequence #01–#${confirmed.length < 10 ? '0' + confirmed.length : confirmed.length})`
            : `${EMOJI.admin} ${title} — Registration Details (Continued #${idx + 1})`
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

    const targetChannelName = config.regDetailsChannel || 'registration-details';
    let channel = this.resolveRegDetailsChannel(guild, config);
    const category = this.resolveTournamentCategory(guild, config);

    // If channel exists but has no category (sitting separately), heal or remove it
    if (channel) {
      if (category && channel.parentId !== category.id) {
        await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
      } else if (!category && !channel.parentId) {
        await channel.delete('Removing stray unparented registration-details channel').catch(() => {});
        config.regDetailsChannelId = '';
        if (this.onConfigUpdated) this.onConfigUpdated();
        return { updated: false, error: 'Cleaned up unparented registration-details channel' };
      }
    }

    if (!channel) {
      // Never auto-create registration-details channel in background updates
      return { updated: false, error: `#${targetChannelName} channel not configured` };
    }
    if (channel === undefined || channel === null) return { updated: false };
    const existingTeams = this.getTeamsForTournament(config);
    const confirmed = existingTeams.filter(t => !t.isWaitlist);
    const waitlist = existingTeams.filter(t => t.isWaitlist);
    const embeds = this.formatRegistrationDetailsEmbeds(confirmed, waitlist, config);

    try {
      let trackedIds = [...(this.regDetailsMessageIds.get(channel.id) || [])];
      if (trackedIds.length === 0) {
        const recentMessages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        if (recentMessages) {
          const botMsgs = Array.from(recentMessages.values())
            .filter((m: any) => m.author?.id === this.client?.user?.id)
            .sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp);
          trackedIds = botMsgs.map((m: any) => m.id);
        }
      }

      const newTrackedIds: string[] = [];
      for (let i = 0; i < embeds.length; i++) {
        const singleEmbed = [embeds[i]];
        const existingId = trackedIds[i];
        let updatedExisting = false;
        if (existingId) {
          const existingMsg = await channel.messages.fetch(existingId).catch(() => null);
          if (existingMsg) {
            await existingMsg.edit({ embeds: singleEmbed });
            newTrackedIds.push(existingMsg.id);
            updatedExisting = true;
          }
        }
        if (!updatedExisting) {
          const sentMsg = await channel.send({ embeds: singleEmbed });
          if (sentMsg) {
            newTrackedIds.push(sentMsg.id);
          }
        }
      }

      for (let j = embeds.length; j < trackedIds.length; j++) {
        const extraMsg = await channel.messages.fetch(trackedIds[j]).catch(() => null);
        if (extraMsg) {
          await extraMsg.delete().catch(() => {});
        }
      }

      this.regDetailsMessageIds.set(channel.id, newTrackedIds);
      return { updated: true };
    } catch (err: any) {
      return { updated: false, error: err?.message || 'Permission error updating #registration-details' };
    }
  }

  public async updateSlotListChannel(guild: any, config: any): Promise<{ updated: boolean; error?: string }> {
    if (!guild) return { updated: false, error: 'No guild provided' };
    await this.updateRegistrationDetailsChannel(guild, config).catch(() => {});
    const channel = this.resolveSlotListChannel(guild, config);
    if (!channel) return { updated: false, error: `#${config.slotListChannel || 'slot-list'} channel not found` };

    const existingTeams = this.getTeamsForTournament(config);
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
        ? `${EMOJI.done} OPEN`
        : `${EMOJI.alert} CLOSED`;
    const headerLine = `${EMOJI.sword} ${gamePrefix}**Format:** ${config.format} (${config.requiredTags} Tags) | **Status:** ${statusText}\n${EMOJI.golden} **Confirmed Teams:** \`${confirmed.length}/${totalSlots}\` | **Teams Per Group:** \`${teamsPerGroup}\` (\`${groupsCount} Group${groupsCount > 1 ? 's' : ''}\`)\n${EMOJI.dividerBar}\n\n`;

    const groupedChunks = this.formatGroupedSlotListChunks(confirmed, config);
    const payloadEmbeds: EmbedBuilder[] = groupedChunks.map((chunk, idx) => {
      const embed = new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `${EMOJI.golden} ${config.title || 'Glacier Cup'} — Official Slot List`
            : `${EMOJI.golden} ${config.title || 'Glacier Cup'} — Slot List (Continued #${idx + 1})`
        )
        .setColor(0x5865F2)
        .setDescription(idx === 0 ? `${headerLine}${chunk}` : chunk);

      if (idx === groupedChunks.length - 1) {
        embed.setTimestamp();
        if (waitlist.length > 0) {
          embed.addFields({
            name: `${EMOJI.alert} Waiting List (${waitlist.length})`,
            value: waitlist.map(w => `${EMOJI.sword} \`WL #${w.slotNumber}\` **${w.teamName}** (<@${w.captain.id}>)`).join('\n').slice(0, 1020)
          });
        }
      }
      return embed;
    });

    const finalEmbeds = payloadEmbeds.slice(0, 10);

    try {
      let trackedIds = [...(this.slotListMessageIds.get(channel.id) || [])];
      if (trackedIds.length === 0) {
        const recentMessages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
        if (recentMessages) {
          const botMsgs = Array.from(recentMessages.values())
            .filter((m: any) => m.author?.id === this.client?.user?.id)
            .sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp);
          trackedIds = botMsgs.map((m: any) => m.id);
        }
      }

      const newTrackedIds: string[] = [];
      for (let i = 0; i < finalEmbeds.length; i++) {
        const singleEmbed = [finalEmbeds[i]];
        const existingId = trackedIds[i];
        let updatedExisting = false;
        if (existingId) {
          const existingMsg = await channel.messages.fetch(existingId).catch(() => null);
          if (existingMsg) {
            await existingMsg.edit({ embeds: singleEmbed });
            newTrackedIds.push(existingMsg.id);
            updatedExisting = true;
          }
        }
        if (!updatedExisting) {
          const sentMsg = await channel.send({ embeds: singleEmbed });
          if (sentMsg) {
            newTrackedIds.push(sentMsg.id);
          }
        }
      }

      for (let j = finalEmbeds.length; j < trackedIds.length; j++) {
        const extraMsg = await channel.messages.fetch(trackedIds[j]).catch(() => null);
        if (extraMsg) {
          await extraMsg.delete().catch(() => {});
        }
      }

      this.slotListMessageIds.set(channel.id, newTrackedIds);
      return { updated: true };
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
      const idpChannel = this.resolveIdpChannel(guild, config);

      if (!idpChannel) {
        failedGuilds.push({
          guildName: guild.name,
          reason: `Channel #${config.idpChannel || 'tournament-idp'} does not exist (Run /setup first).`
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
        .setTitle(`${EMOJI.giveaway} Custom Match Room Details — ${creds.serverType || 'Official Match Lobby'}`)
        .setColor(0x57F287)
        .setDescription(`${EMOJI.done} Match credentials for **${config.title || 'Tournament'}** are live!\n${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Room ID`, value: `\`\`\`${creds.roomId}\`\`\``, inline: true },
          { name: `${EMOJI.sword} Password`, value: `\`\`\`${creds.roomPass}\`\`\``, inline: true },
          { name: `${EMOJI.giveaway} Map`, value: creds.mapName || 'Main Lobby', inline: true },
          { name: `${EMOJI.alert} Start Time`, value: creds.matchTime || 'Starts in 15 Mins', inline: true }
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Official Match Room Credentials' })
        .setTimestamp();

      try {
        await idpChannel.send({ content: `${EMOJI.giveaway} @here Room ID and Password published!`, embeds: [embed] });
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
        description: 'Quick-setup tournament category, channels, roles, slots, and start registration immediately',
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
            description: 'Create tournament with channels, roles, slots, and start registration immediately',
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
        name: 'my-team',
        description: 'View your registered team, edit roster player tags, or withdraw your slot while registration is open'
      },
      {
        name: 'active-tournament',
        description: 'Check if any tournament is currently active in the server and view its status & channels'
      },
      {
        name: 'setup_registration_panel',
        description: 'Post the interactive tournament registration embed and Register Your Team button in #registration'
      },
      {
        name: 'voice-247',
        description: 'Configure bot to join and stay inside a voice channel 24/7 permanently',
        options: [
          {
            name: 'action',
            description: 'Action: join, leave, or status',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: 'join (Stay 24/7 in selected Voice Channel)', value: 'join' },
              { name: 'leave (Leave Voice Channel & Disable 24/7)', value: 'leave' },
              { name: 'status (Check current 24/7 Voice Lobby status)', value: 'status' }
            ]
          },
          {
            name: 'channel',
            description: 'Voice channel to join 24/7 (Required if action is join)',
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
            required: false
          }
        ]
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

  public buildActiveTournamentEmbed(guild?: Guild | null, currentChannelId?: string | null): EmbedBuilder {
    this.reconcileActiveTournaments();
    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const managerRoleLabel = rootConfig?.managerRoleName || 'FFA Bot Manager';
    const guildTourneys = this.getGuildTournaments(guild);

    const activeTourneys: any[] = [];
    const seenIds = new Set<string>();

    for (const t of guildTourneys) {
      if (!t) continue;
      const hasExistingGuildChannel =
        !guild ||
        Boolean(
          (t.categoryId && guild.channels.cache.has(t.categoryId)) ||
            (t.regChannelId && guild.channels.cache.has(t.regChannelId)) ||
            (t.slotListChannelId && guild.channels.cache.has(t.slotListChannelId)) ||
            (t.rulesChannelId && guild.channels.cache.has(t.rulesChannelId)) ||
            (t.idpChannelId && guild.channels.cache.has(t.idpChannelId))
        );
      if (hasExistingGuildChannel && (t.totalSlots > 0 || t.categoryId || t.regChannelId)) {
        const key = t.id || t.categoryId || t.regChannelId || t.title;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          activeTourneys.push(t);
        }
      }
    }

    if (activeTourneys.length === 0 && rootConfig && rootConfig.totalSlots > 0) {
      const regCh = guild ? this.resolveRegistrationChannel(guild, rootConfig) : null;
      const slotCh = guild ? this.resolveSlotListChannel(guild, rootConfig) : null;
      if (!guild || regCh || slotCh || rootConfig.categoryId) {
        activeTourneys.push(rootConfig);
      }
    }

    if (activeTourneys.length === 0) {
      return new EmbedBuilder()
        .setTitle(`${EMOJI.alert} Active Tournament Status — No Active Tournament`)
        .setColor(0xED4245)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          `${EMOJI.alert} **No active tournament is currently running** in **${guild?.name || 'this server'}**.\n\n` +
          `${EMOJI.golden} **How to start a tournament:**\n` +
          `Staff with **@${managerRoleLabel}** can run **\`/setup\`** (or \`!setup\`) to automatically create a new tournament category, channels, roles, and open registration.\n` +
          `${EMOJI.dividerBar}`
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ • Active Tournament Check' })
        .setTimestamp();
    }

    const openTourneys = activeTourneys.filter(t => t.status === 'open' && !t.explicitlyStoppedOrPaused);
    const channelContext = currentChannelId ? this.resolveTournamentContext(guild, currentChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle(
        openTourneys.length > 0
          ? `${EMOJI.done} Active Tournament Status — ${openTourneys.length} Active`
          : `${EMOJI.alert} Tournament Status — Registration Closed`
      )
      .setColor(openTourneys.length > 0 ? 0x57F287 : 0xFEE75C)
      .setDescription(
        `${EMOJI.dividerBar}\n` +
        (openTourneys.length > 0
          ? `${EMOJI.giveaway} There ${openTourneys.length === 1 ? 'is **1 active tournament**' : `are **${openTourneys.length} active tournaments**`} running in **${guild?.name || 'this server'}**!`
          : `${EMOJI.alert} Found **${activeTourneys.length} tournament(s)** in **${guild?.name || 'this server'}**, with registration currently **CLOSED / LOCKED**.`) +
        `\n${EMOJI.dividerBar}`
      )
      .setFooter({ text: 'FFA | Glacier Cup Manager™ • Active Tournament Check' })
      .setTimestamp();

    for (const t of activeTourneys.slice(0, 10)) {
      const teams = this.getTeamsForTournament(t);
      const confirmed = teams.filter((tm: any) => !tm.isWaitlist).length;
      const waitlist = teams.filter((tm: any) => tm.isWaitlist).length;
      const isOpen = t.status === 'open' && !t.explicitlyStoppedOrPaused;
      const isCurrentChannel = Boolean(channelContext?.id && t.id && channelContext.id === t.id && activeTourneys.length > 1);

      const rulesCh = guild ? this.resolveRulesChannel(guild, t) : undefined;
      const regCh = guild ? this.resolveRegistrationChannel(guild, t) : undefined;
      const slotCh = guild ? this.resolveSlotListChannel(guild, t) : undefined;
      const idpCh = guild ? this.resolveIdpChannel(guild, t) : undefined;

      const channelLinks = [
        rulesCh ? `<#${rulesCh.id}>` : '`#tournament-rules`',
        regCh ? `<#${regCh.id}>` : '`#tournament-registration`',
        slotCh ? `<#${slotCh.id}>` : '`#slot-list`',
        idpCh ? `<#${idpCh.id}>` : '`#tournament-idp`'
      ].join(' • ');

      embed.addFields({
        name: `${isOpen ? EMOJI.done : EMOJI.alert} ${t.title || 'Tournament'}${isCurrentChannel ? ' *(Current Channel)*' : ''}`,
        value:
          `${EMOJI.golden} **Status:** ${isOpen ? '`ACTIVE (Registration OPEN)`' : '`CLOSED / LOCKED`'}\n` +
          `${EMOJI.sword} **Slots Filled:** \`${confirmed} / ${t.totalSlots || 20}\` Confirmed${waitlist > 0 ? ` • \`${waitlist}\` Waitlist` : ''}\n` +
          `${EMOJI.admin} **Format:** \`${t.requiredTags || 4} Player Tags\` • \`${t.teamsPerGroup || t.totalSlots || 20} Teams/Group\` (\`${t.groupsCount || 1} Group(s)\`)\n` +
          `${EMOJI.giveaway} **Channels:** ${channelLinks}`,
        inline: false
      });
    }

    return embed;
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

    const currentConfig = this.resolveTournamentContext(interaction.guild, interaction.channelId) || (this.getTournamentConfig ? this.getTournamentConfig() : {});
    const managerRoleLabel = currentConfig.managerRoleName || 'FFA Bot Manager';
    const isStaff = this.hasBotManagerRole(interaction.member, interaction.guild, isSetupCommand);

    const publicCommands = ['slots', 'active-tournament', 'my-team'];

    if (!publicCommands.includes(commandName) && !isStaff) {
      return interaction.reply({
        content: `❌ **Access Restricted:** Only members with the **@${managerRoleLabel}** role can use staff slash commands and manage tournaments.\nPlayers can register their team in \`#${currentConfig.regChannel || 'tournament-registration'}\`, manage their own roster/slot with \`/my-team\`, and check slots via \`/slots\`, \`/active-tournament\`, or \`#${currentConfig.slotListChannel || 'slot-list'}\`.`,
        ephemeral: true
      }).catch(() => {});
    }

    const activeTitle = currentConfig.title || (interaction.guild ? `${interaction.guild.name} Championship` : 'Glacier Cup');

    if (commandName === 'rules' && isStaff && !interaction.options.getString('rules')) {
      await interaction.showModal(this.createRulesModal(currentConfig.customRules, currentConfig.id)).catch(() => {});
      return;
    }

    const useEphemeral = commandName === 'idpass' || commandName === 'my-team';
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: useEphemeral });
      }
    } catch (deferErr: any) {
      console.log('[DiscordBot] Could not deferReply for /' + commandName + ':', deferErr?.message || deferErr);
      return;
    }

    this.logEvent('info', `Executing /${commandName}${subCommand ? ' ' + subCommand : ''} by @${interaction.user.username}`, interaction.guild?.name);

    if (isSetupCommand) {
      if (!interaction.guild) {
        return interaction.editReply('❌ This command can only be used inside a Discord server.');
      }

      const rawSlots = interaction.options.getInteger('slots') || 20;
      const slots = Math.max(2, Math.min(500, rawSlots));
      const tags = Math.max(1, Math.min(10, interaction.options.getInteger('tags') || 4));
      const rawGroupsOption = interaction.options.getInteger('groups');
      const teamsPerGroup = rawGroupsOption && rawGroupsOption > 0
        ? Math.min(slots, Math.max(1, rawGroupsOption))
        : slots;
      const groupsCount = Math.max(1, Math.ceil(slots / teamsPerGroup));
      const existingGuildTourneys = this.getGuildTournaments(interaction.guild);
      const defaultTourneyTitle = existingGuildTourneys.length > 0
        ? `${interaction.guild.name} Championship #${existingGuildTourneys.length + 1}`
        : `${interaction.guild.name} Championship`;
      const title = interaction.options.getString('title')?.trim() || defaultTourneyTitle;
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
            tournamentId: result.tournamentId,
            expiresAt: Date.now() + 10 * 60 * 1000
          });
        }

        const formatName = tags === 4 ? 'Squad' : tags === 3 ? 'Trio' : tags === 2 ? 'Duo' : tags === 1 ? 'Solo' : 'Custom';
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.golden} Tournament Setup Complete — Registration Panel Ready`)
          .setColor(result.warnings && result.warnings.length > 0 ? 0xFEE75C : 0x57F287)
          .setDescription(
            `${EMOJI.done} **${title}** has been provisioned by <@${interaction.user.id}>!\n` +
            `${EMOJI.giveaway} The interactive **Registration Panel** (\`🏆 Register Your Team\` button) has been posted in \`#tournament-registration\`!\n` +
            `${EMOJI.dividerBar}`
          )
          .addFields(
            { name: `${EMOJI.sword} Total Slots & Tags`, value: `\`${slots} Slots\` • \`${tags} Required Players (${formatName})\``, inline: true },
            { name: `${EMOJI.golden} Teams Per Group`, value: `\`${teamsPerGroup} Teams/Group\` (\`${groupsCount} Group(s)\`)`, inline: true },
            { name: `${EMOJI.done} Registration Status`, value: `${EMOJI.done} \`OPEN (Registration Panel Active)\``, inline: true },
            {
              name: `${EMOJI.admin} Created Roles & Access Control`,
              value: `${EMOJI.admin} \`@${managerRoleLabel}\` *(Required to use all bot slash commands)*\n${EMOJI.done} \`@Verified Team\` *(Assigned to registered players)*`,
              inline: false
            },
            { name: `${EMOJI.golden} Auto-Created Category & Channels`, value: result.created.join('\n') || 'All channels active', inline: false },
            {
              name: `${EMOJI.sword} Registration Control`,
              value:
                `${EMOJI.done} Registration has started automatically and will continue until you stop it.\n` +
                `${EMOJI.giveaway} Players can click **\`🏆 Register Your Team\`** in \`#tournament-registration\`.\n` +
                `${EMOJI.alert} Run **\`/stop-registration\`** when you want to stop registration and lock \`#tournament-registration\`.\n` +
                `${EMOJI.sword} Run **\`/setup_registration_panel\`** anytime to re-post the registration button panel.`,
              inline: false
            }
          )
          .setFooter({ text: `FFA-Manager • Only @${managerRoleLabel} can run bot commands` })
          .setTimestamp();

        if (result.warnings && result.warnings.length > 0) {
          embed.addFields({
            name: `${EMOJI.alert} Partial Setup Warnings`,
            value: result.warnings.join('\n'),
            inline: false
          });
        }

        embed.addFields({
          name: customRules ? `${EMOJI.done} Tournament Rules` : `${EMOJI.golden} Next Step — Provide Tournament Rules`,
          value: customRules
            ? `${EMOJI.done} Published your custom rules to \`#tournament-rules\`!`
            : `Please **reply in this channel with your Tournament Rules & Format** (or click the button below / use \`/rules\`) and I will publish them to \`#tournament-rules\`!`,
          inline: false
        });

        return interaction.editReply({
          embeds: [embed],
          components: customRules ? [] : [this.createRulesButtonRow(result.tournamentId)]
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
      const result = await this.deleteSlot(slotNumber, interaction.guild || undefined, { tournamentId: currentConfig.id }, currentConfig);

      if (result.success && result.deletedTeam) {
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.alert} Slot Deleted Successfully`)
          .setColor(result.syncWarnings && result.syncWarnings.length > 0 ? 0xFEE75C : 0xED4245)
          .setDescription(`**Slot #${slotNumber}** has been removed from the tournament.\n${EMOJI.dividerBar}`)
          .addFields(
            { name: `${EMOJI.sword} Removed Team`, value: `**${result.deletedTeam.teamName}** (Captain: <@${result.deletedTeam.captain.id}>)`, inline: false },
            {
              name: `${EMOJI.golden} Waitlist Promotion`,
              value: result.promotedTeam
                ? `${EMOJI.done} **${result.promotedTeam.teamName}** was auto-promoted from the waitlist to confirmed **Slot #${result.promotedTeam.slotNumber}** (${result.promotedTeam.group || 'Group A'})!`
                : 'ℹ️ No teams on the waitlist to promote.',
              inline: false
            }
          )
          .setFooter({ text: 'Slot list updated automatically' })
          .setTimestamp();

        if (result.syncWarnings && result.syncWarnings.length > 0) {
          embed.addFields({
            name: `${EMOJI.alert} Role / Channel Sync Notice`,
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
        const preview = await this.previewDeleteTournament(interaction.guild || undefined, deleteChannels, currentConfig);
        const previewEmbed = new EmbedBuilder()
          .setTitle(`${EMOJI.alert} Confirm Destructive Action — Delete Tournament`)
          .setColor(0xFEE75C)
          .setDescription(`You are about to delete **${preview.title}** and reset all registered rosters. Please review what will be removed and confirm below:\n${EMOJI.dividerBar}`)
          .addFields(
            { name: `${EMOJI.sword} Rosters to Clear`, value: `\`${preview.confirmedCount} Confirmed\` • \`${preview.waitlistCount} Waitlist\``, inline: true },
            { name: `${EMOJI.golden} Categories to Delete`, value: preview.categoriesToDelete.length > 0 ? preview.categoriesToDelete.join('\n') : '*(None)*', inline: true },
            { name: `${EMOJI.giveaway} Voice Channels to Delete`, value: preview.voiceChannelsToDelete.length > 0 ? preview.voiceChannelsToDelete.slice(0, 8).join('\n') + (preview.voiceChannelsToDelete.length > 8 ? `\n...and ${preview.voiceChannelsToDelete.length - 8} more` : '') : '*(None)*', inline: false },
            { name: `${EMOJI.admin} Team Roles to Delete`, value: preview.rolesToDelete.length > 0 ? preview.rolesToDelete.slice(0, 8).join('\n') + (preview.rolesToDelete.length > 8 ? `\n...and ${preview.rolesToDelete.length - 8} more` : '') : '*(None)*', inline: true },
            { name: `${EMOJI.golden} Text Channels to Delete`, value: preview.textChannelsToDelete.length > 0 ? preview.textChannelsToDelete.join('\n') : '*(None)*', inline: true }
          )
          .setFooter({ text: 'Click Confirm below to permanently execute this action' })
          .setTimestamp();

        return interaction.editReply({
          embeds: [previewEmbed],
          components: [this.createDeleteConfirmRow(deleteChannels, currentConfig.id)]
        });
      }

      const result = await this.deleteTournament(interaction.guild || undefined, deleteChannels, currentConfig);

      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.done} Tournament Deleted & All Tournament Assets Removed`)
          .setColor(0xED4245)
          .setDescription(`The active tournament has been deleted by <@${interaction.user.id}>. All categories, voice channels, text channels, and team roles have been removed from **${interaction.guild?.name || 'the server'}**.\n${EMOJI.dividerBar}`)
          .addFields(
            {
              name: `${EMOJI.golden} Deleted Categories`,
              value: result.deletedCategories.length > 0 ? result.deletedCategories.slice(0, 10).join('\n') + (result.deletedCategories.length > 10 ? `\n...and ${result.deletedCategories.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.giveaway} Deleted Voice Channels`,
              value: result.deletedVoiceChannels.length > 0 ? result.deletedVoiceChannels.slice(0, 10).join('\n') + (result.deletedVoiceChannels.length > 10 ? `\n...and ${result.deletedVoiceChannels.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.admin} Deleted Roles`,
              value: result.deletedRoles.length > 0 ? result.deletedRoles.slice(0, 10).join('\n') + (result.deletedRoles.length > 10 ? `\n...and ${result.deletedRoles.length - 10} more` : '') : '*(None)*',
              inline: true
            },
            {
              name: `${EMOJI.sword} Deleted Text Channels`,
              value: result.deletedTextChannels.length > 0 ? result.deletedTextChannels.join('\n') : '*(None)*',
              inline: false
            },
            {
              name: `${EMOJI.done} Cleared Rosters & Slots`,
              value: `\`${result.clearedTeamsCount} Team(s) cleared\` • Tournament status set to CLOSED`,
              inline: true
            },
            {
              name: `${EMOJI.golden} Next Steps`,
              value: 'Run `/setup` or `/create tournament` to launch a new tournament whenever you are ready.',
              inline: true
            }
          )
          .setFooter({ text: 'FFA | Glacier Cup Manager™' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] }).catch(() => {});
      } else {
        return interaction.editReply(`❌ **Failed to delete tournament:** ${result.error || 'Unknown error'}`).catch(() => {});
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
          `❌ **Failed to publish Room ID & Password:** ${res.error || 'Could not dispatch to #tournament-idp.'}`
        );
      }

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.done} Custom Match Credentials Dispatched (Private Staff Confirmation)`)
        .setColor(res.failedGuilds.length > 0 ? 0xFEE75C : 0x57F287)
        .setDescription(`${EMOJI.giveaway} Room ID & Password have been published to **#${currentConfig.idpChannel || 'tournament-idp'}** (${res.sentCount} server channel(s) notified).\n${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Room ID`, value: `\`\`\`${roomId}\`\`\``, inline: true },
          { name: `${EMOJI.sword} Password`, value: `\`\`\`${roomPass}\`\`\``, inline: true },
          { name: `${EMOJI.giveaway} Map & Time`, value: `${mapName} • ${matchTime}`, inline: false }
        )
        .setFooter({ text: `Dispatched privately by @${interaction.user.username} • Credentials masked in system logs` })
        .setTimestamp();

      if (res.failedGuilds.length > 0) {
        embed.addFields({
          name: `${EMOJI.alert} Partial Publication Failures`,
          value: res.failedGuilds.map(f => `• **${f.guildName}**: ${f.reason}`).join('\n'),
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'stop-registration' || commandName === 'lock') {
      const reason = interaction.options.getString('reason') || 'Registration ended and channel locked by tournament staff.';
      const res = await this.stopRegistration(interaction.guild || undefined, reason, interaction.user.username, currentConfig);
      if (!res.success) {
        return interaction.editReply(`❌ **Failed to stop registration:** ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.alert} Tournament Registration Ended & Channel Locked`)
        .setColor(0xED4245)
        .setDescription(
          `Registrations for **${activeTitle}** are now **CLOSED** and \`#${currentConfig.regChannel || 'tournament-registration'}\` has been **LOCKED**.\n` +
          `**Reason:** ${reason}\n${EMOJI.dividerBar}`
        )
        .addFields({
          name: `${EMOJI.admin} Channel Permission Status`,
          value: res.lockedChannels.length > 0
            ? `🔒 Locked ${res.lockedChannels.join(', ')} (\`@everyone\` cannot send messages)`
            : '🔒 Registration status set to CLOSED',
          inline: false
        })
        .setFooter({ text: `Stopped by @${interaction.user.username} • FFA | Glacier Cup Manager™` })
        .setTimestamp();
      if (res.warnings.length > 0) {
        embed.addFields({ name: `${EMOJI.alert} Notices`, value: res.warnings.join('\n'), inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'blacklist') {
      if (subCommand === 'add') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Fairplay / Rule violation';
        const entry = this.addToBlacklist(user.id, user.username, reason, interaction.user.username);
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.alert} Player Blacklisted`)
          .setColor(0xED4245)
          .setDescription(`Player <@${entry.userId}> (\`${entry.username}\`) has been banned from registering or being tagged in any team.\n${EMOJI.dividerBar}`)
          .addFields(
            { name: `${EMOJI.sword} Reason`, value: entry.reason, inline: true },
            { name: `${EMOJI.admin} Actioned By`, value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } else if (subCommand === 'remove') {
        const user = interaction.options.getUser('user', true);
        const removed = this.removeFromBlacklist(user.id);
        return interaction.editReply(
          removed
            ? `${EMOJI.done} Removed <@${user.id}> (\`${user.username}\`) from the tournament blacklist.`
            : `${EMOJI.alert} <@${user.id}> was not found on the blacklist.`
        );
      } else {
        const list = this.getBlacklist();
        const embed = new EmbedBuilder()
          .setTitle(`${EMOJI.admin} Tournament Blacklist (${list.length})`)
          .setColor(0xED4245)
          .setDescription(
            list.length > 0
              ? `${EMOJI.dividerBar}\n` + list.map((b, i) => `\`${i + 1}.\` <@${b.userId}> (\`${b.username}\`) — *${b.reason}*`).join('\n')
              : `${EMOJI.done} No players are currently blacklisted.`
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (commandName === 'tagcheck') {
      const user = interaction.options.getUser('user', true);
      const teams = this.getTeamsForTournament(currentConfig);
      const banned = this.blacklist.find(b => this.normalizeMemberId(b.userId) === user.id);
      const foundTeam = teams.find(
        t =>
          this.getTeamMemberIds(t).has(user.id) ||
          t.captain?.username?.toLowerCase() === user.username.toLowerCase() ||
          t.players.some((p: any) => p.username?.toLowerCase() === user.username.toLowerCase())
      );

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.admin} FFA | Glacier Cup Manager™ Player Tagcheck Dossier`)
        .setColor(banned ? 0xED4245 : foundTeam ? 0xFEE75C : 0x57F287)
        .setDescription(`Verification lookup for <@${user.id}> (\`@${user.username}\`):\n${EMOJI.dividerBar}`)
        .addFields({
          name: `${EMOJI.sword} Eligibility Status`,
          value: banned
            ? `${EMOJI.alert} **BLACKLISTED** — Reason: *${banned.reason}*`
            : foundTeam
            ? `${EMOJI.alert} **ALREADY REGISTERED** (Registered on a roster)`
            : `${EMOJI.done} **ELIGIBLE / FREE AGENT** (Cleared to register)`,
          inline: false
        })
        .setTimestamp();

      if (foundTeam) {
        embed.addFields(
          { name: `${EMOJI.sword} Team Name`, value: `**${foundTeam.teamName}**`, inline: true },
          { name: `${EMOJI.golden} Allocated Slot`, value: foundTeam.isWaitlist ? `Waitlist #${foundTeam.slotNumber}` : `Slot #${foundTeam.slotNumber} (${foundTeam.group || 'Group A'})`, inline: true },
          { name: `${EMOJI.admin} Captain`, value: `<@${foundTeam.captain.id}>`, inline: true }
        );
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'team-info') {
      const query = interaction.options.getString('query', true).trim();
      const teams = this.getTeamsForTournament(currentConfig);
      const slotNum = parseInt(query.replace(/\D/g, ''), 10);
      const found = (!isNaN(slotNum) && String(slotNum) === query.replace('#', ''))
        ? teams.find(t => t.slotNumber === slotNum)
        : teams.find(t => t.teamName.toLowerCase().includes(query.toLowerCase()));

      if (!found) {
        return interaction.editReply(`❌ No registered team matching \`${query}\` found.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} Team Dossier — ${found.teamName}`)
        .setColor(found.isWaitlist ? 0xFEE75C : 0x5865F2)
        .setDescription(`${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Slot Allocation`, value: found.isWaitlist ? `\`Waitlist #${found.slotNumber}\`` : `\`Slot #${found.slotNumber}\``, inline: true },
          { name: `${EMOJI.sword} Assigned Group`, value: `\`${found.group || 'Group A'}\``, inline: true },
          { name: `${EMOJI.admin} Team Captain`, value: `<@${found.captain.id}>`, inline: true },
          {
            name: `${EMOJI.done} Verified Roster (${found.players.length} Players)`,
            value: found.players.map((p: any, idx: number) => `${EMOJI.sword} \`${idx + 1}.\` <@${p.id}> (\`${p.displayName || p.username}\`)`).join('\n') || 'None',
            inline: false
          },
          { name: `${EMOJI.giveaway} Registered At`, value: new Date(found.registeredAt).toLocaleString(), inline: true },
          { name: `${EMOJI.admin} Team Role & Tourney Role`, value: `${found.teamRoleId ? `<@&${found.teamRoleId}>` : `\`@${found.teamRoleName || found.teamName}\``} • \`@${currentConfig.verifiedRoleName || 'Verified Team'}\``, inline: true },
          {
            name: `${EMOJI.golden} Team Category & Private VC`,
            value: `📁 \`${found.teamCategoryName || found.teamName}\` • 🔊 ${found.teamVoiceChannelId ? `<#${found.teamVoiceChannelId}>` : `\`${found.teamVoiceChannelName || found.teamName}\``}`,
            inline: false
          }
        )
        .setFooter({ text: `Team ID: ${found.id}` })
        .setTimestamp();
      const voiceUrl =
        interaction.guild && found.teamVoiceChannelId
          ? await this.resolveVoiceConnectUrl(interaction.guild, found.teamVoiceChannelId, found.teamVoiceInviteUrl)
          : undefined;
      const components =
        interaction.guild && found.teamVoiceChannelId
          ? [this.createVoiceConnectButtonRow(interaction.guild.id, found.teamVoiceChannelId, found.teamVoiceChannelName || found.teamName, voiceUrl)]
          : [];
      return interaction.editReply({ embeds: [embed], components });
    }

    if (commandName === 'my-team') {
      const payload = await this.buildMyTeamPayload(interaction.guild, interaction.user.id, currentConfig);
      return interaction.editReply({ embeds: payload.embeds, components: payload.components });
    }

    if (commandName === 'standings') {
      const groupArg = interaction.options.getString('group');
      const teams = this.getTeamsForTournament(currentConfig).filter(t => !t.isWaitlist);
      const groupFilter = groupArg ? `Group ${groupArg.toUpperCase().replace('GROUP', '').trim()}` : null;
      const filtered = groupFilter ? teams.filter(t => (t.group || 'Group A').toLowerCase() === groupFilter.toLowerCase()) : teams;

      const rows = filtered.slice(0, 15).map((t, idx) => {
        const wins = idx === 0 ? 2 : idx === 1 ? 1 : 0;
        const placePts = Math.max(4, 28 - idx * 4);
        const killPts = Math.max(2, 22 - idx * 3);
        const total = placePts + killPts;
        const medal = idx === 0 ? EMOJI.golden : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${EMOJI.sword} \`#${idx + 1}\``;
        return `${medal} **${t.teamName}** (Slot #${t.slotNumber}) — **${total} Pts** *(Wins: ${wins} | Finishes: ${killPts})*`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} ${activeTitle} — Official Standings ${groupFilter ? `(${groupFilter})` : ''}`)
        .setColor(0xFEE75C)
        .setDescription((rows.length > 0 ? rows.join('\n') : '*No confirmed teams to rank yet.*') + `\n${EMOJI.dividerBar}`)
        .addFields({
          name: `${EMOJI.giveaway} Official Scoring Matrix`,
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
        const pubRes = await this.publishRulesToChannel(interaction.guild, inlineRules, interaction.user.username, currentConfig);
        if (pubRes.success) {
          const confirmEmbed = new EmbedBuilder()
            .setTitle(`${EMOJI.done} Tournament Rules Published!`)
            .setColor(0x57F287)
            .setDescription(`Your custom tournament rules & format have been posted in <#${pubRes.channelId}>!\n${EMOJI.dividerBar}`)
            .setFooter({ text: `Published by @${interaction.user.username} • FFA-Manager` })
            .setTimestamp();
          return interaction.editReply({ embeds: [confirmEmbed] });
        }
        return interaction.editReply(`❌ Failed to publish rules: ${pubRes.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} ${activeTitle} — Official Tournament Rulebook`)
        .setColor(0x5865F2)
        .setDescription(
          `${EMOJI.dividerBar}\n` +
          (currentConfig.customRules ||
            `*No custom tournament rules have been published yet. Tournament staff can use \`/rules\` to enter and publish the rules to \`#${currentConfig.rulesChannel || 'tournament-rules'}\`.*`)
        )
        .setFooter({ text: 'FFA-Manager' })
        .setTimestamp();
      return interaction.editReply({
        embeds: [embed],
        components: isStaff ? [this.createRulesButtonRow(currentConfig.id)] : []
      });
    }

    if (commandName === 'announce') {
      const msg = interaction.options.getString('message', true);
      const ping = interaction.options.getBoolean('ping_everyone') ?? true;
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} Official Tournament Announcement — ${activeTitle}`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n${msg}`)
        .setFooter({ text: `Announced by @${interaction.user.username} • FFA | Glacier Cup Manager™` })
        .setTimestamp();
      this.logEvent('info', `Published announcement via /announce by @${interaction.user.username}`, interaction.guild?.name);
      return interaction.editReply({ content: ping ? '@here' : undefined, embeds: [embed] });
    }

    if (commandName === 'swap-slots') {
      const s1 = interaction.options.getInteger('slot1', true);
      const s2 = interaction.options.getInteger('slot2', true);
      const res = await this.swapSlots(s1, s2, interaction.guild || undefined, currentConfig);
      if (!res.success) {
        return interaction.editReply(`❌ ${res.error}`);
      }
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.done} Slots Swapped Successfully`)
        .setColor(0x57F287)
        .setDescription(`Swapped **Slot #${s1}** (${res.group1}) and **Slot #${s2}** (${res.group2}). \`#slot-list\` has been updated!\n${EMOJI.dividerBar}`)
        .addFields(
          { name: `${EMOJI.golden} Slot #${s1} (${res.group1})`, value: res.team2 ? `**${res.team2.teamName}**` : '*Open Slot*', inline: true },
          { name: `${EMOJI.golden} Slot #${s2} (${res.group2})`, value: res.team1 ? `**${res.team1.teamName}**` : '*Open Slot*', inline: true }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'export') {
      const format = (interaction.options.getString('format') || 'markdown').toLowerCase() === 'csv' ? 'csv' : 'markdown';
      const teams = this.getTeamsForTournament(currentConfig);
      const output = this.generateRosterExport(format, true, currentConfig);
      const safeOutput = output.length > 3800 ? output.slice(0, 3800) + '\n...truncated' : output;

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} Exported Tournament Roster (${teams.length} Teams)`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n\`\`\`${format === 'csv' ? 'csv' : 'text'}\n${safeOutput}\n\`\`\``)
        .setFooter({ text: 'Consistent with live roster • Ready for casters & production sheets' })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'slots') {
      const teams = this.getTeamsForTournament(currentConfig);
      const confirmed = teams.filter(t => !t.isWaitlist);
      const waitlist = teams.filter(t => t.isWaitlist);
      const groupedChunks = this.formatGroupedSlotListChunks(confirmed, currentConfig);
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.golden} ${activeTitle} — Live Slot List`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.dividerBar}\n${groupedChunks[0]}`)
        .addFields(
          { name: `${EMOJI.done} Confirmed Slots`, value: `\`${confirmed.length} / ${currentConfig.totalSlots}\``, inline: true },
          { name: `${EMOJI.sword} Teams Per Group`, value: `\`${currentConfig.teamsPerGroup || currentConfig.totalSlots || 20} Teams/Group\``, inline: true },
          { name: `${EMOJI.giveaway} Status`, value: currentConfig.status === 'open' ? `${EMOJI.done} \`OPEN\`` : `${EMOJI.alert} \`LOCKED\``, inline: true }
        )
        .setTimestamp();
      if (waitlist.length > 0) {
        embed.addFields({
          name: `${EMOJI.alert} Waiting List (${waitlist.length}/${currentConfig.waitlistSlots})`,
          value: waitlist.map(w => `${EMOJI.sword} \`WL #${w.slotNumber}\` **${w.teamName}** — <@${w.captain.id}>`).join('\n').slice(0, 1020),
          inline: false
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'active-tournament') {
      const activeEmbed = this.buildActiveTournamentEmbed(interaction.guild, interaction.channelId);
      return interaction.editReply({ embeds: [activeEmbed] });
    }

    if (commandName === 'setup_registration_panel') {
      if (!interaction.guild) {
        return interaction.editReply('❌ This command can only be used inside a Discord server.');
      }
      const panelPayload = this.createRegistrationPanelPayload(currentConfig);
      const regCh = this.resolveRegistrationChannel(interaction.guild, currentConfig);

      if (regCh && regCh.id !== interaction.channelId) {
        await regCh.send(panelPayload);
        return interaction.editReply({
          content: `${EMOJI.done} Posted the **Registration Panel** in <#${regCh.id}>!`,
          ...panelPayload
        });
      }

      return interaction.editReply(panelPayload);
    }

    if (commandName === 'voice-247') {
      if (!isStaff) {
        return interaction.editReply('❌ You need `Manage Channels` or `Administrator` permission to configure 24/7 Voice.');
      }
      if (!interaction.guildId) {
        return interaction.editReply('❌ This command can only be used inside a Discord server.');
      }
      const action = interaction.options.getString('action', true);
      const targetChannel = interaction.options.getChannel('channel');

      if (action === 'status') {
        const status = this.get247VoiceStatus(interaction.guildId);
        const embed = new EmbedBuilder()
          .setTitle('🔊 24/7 Voice Channel Status')
          .setColor(status.isConnected ? 0x57F287 : 0xED4245)
          .setDescription(
            status.is247
              ? `• **Target Channel:** <#${status.channelId}> (\`${status.channelName || status.channelId}\`)\n` +
                `• **Status:** ${status.isConnected ? '🟢 **Connected & Staying 24/7**' : '🟡 **Reconnecting...**'}\n` +
                `• **Auto-Reconnect:** Enabled (Rejoins on server reboot or disconnect)`
              : '• **Status:** 🔴 **Disabled** (Bot is not configured to stay in any voice channel 24/7).\n\nUse `/voice-247 action:join channel:#lobby` to enable.'
          )
          .setFooter({ text: 'Powered by FFA | Glacier Cup Manager™' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (action === 'leave') {
        const res = this.leave247Voice(interaction.guildId);
        const embed = new EmbedBuilder()
          .setTitle('🔇 24/7 Voice Channel Disabled')
          .setColor(0xFEE75C)
          .setDescription(res.message)
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (action === 'join') {
        if (!targetChannel) {
          return interaction.editReply('❌ Please select a voice channel for the bot to join and stay 24/7.');
        }
        if (targetChannel.type !== ChannelType.GuildVoice && targetChannel.type !== ChannelType.GuildStageVoice) {
          return interaction.editReply('❌ Selected channel must be a Voice or Stage channel.');
        }

        const res = await this.connectTo247Voice(interaction.guildId, targetChannel.id);
        if (!res.success) {
          return interaction.editReply(`❌ Failed to join voice channel: **${res.error}**`);
        }

        const embed = new EmbedBuilder()
          .setTitle('🔊 24/7 Voice Channel Locked & Active')
          .setColor(0x57F287)
          .setDescription(
            `Successfully joined **<#${targetChannel.id}>**!\n\n` +
            `• **24/7 Stay Mode:** 🟢 Active\n` +
            `• **Self-Deafened:** Yes (Minimizes bandwidth & prevents idle kick)\n` +
            `• **Auto-Reconnect:** Active (Will automatically rejoin on restarts, disconnects, or kicks)`
          )
          .setFooter({ text: 'Use /voice-247 action:leave to disconnect anytime' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.admin} FFA | Glacier Cup Manager™ — Full Command Suite`)
        .setColor(0x5865F2)
        .setDescription(`${EMOJI.golden} Official FFA | Glacier Cup Manager™ Tagcheck Tournament Bot for Discord.\n${EMOJI.dividerBar}`)
        .addFields(
          {
            name: `${EMOJI.golden} Tournament Setup & Channels`,
            value: '`/setup [slots] [tags] [groups] [title]` *(up to 500 slots, `groups` = teams/group; starts registration immediately)*\n`/active-tournament` *(Check if any tournament is currently active in the server)*\n`/setup_registration_panel`\n`/voice-247 <action> [channel]` *(Stay in VC 24/7)*\n`/create tournament`\n`/stop-registration [reason]`\n`/delete slot <slot>` • `/delete tournament`',
            inline: false
          },
          {
            name: `${EMOJI.giveaway} Lobby & Registration Control`,
            value: '`/stop-registration [reason]`\n`/idpass <room_id> <password> [map] [match_time]`\n`/swap-slots <slot1> <slot2>`\n`/announce <message>`',
            inline: false
          },
          {
            name: `${EMOJI.sword} Verification, Roster & Standings`,
            value: '`/my-team` *(Captain self-service: Edit Roster or Cancel My Slot)*\n`/tagcheck <@user>`\n`/team-info <query>`\n`/blacklist add|remove|list`\n`/standings [group]`\n`/rules` • `/export` • `/slots`',
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
    guild?: Guild,
    options?: { isWaitlist?: boolean; teamId?: string; tournamentId?: string; tournamentConfig?: any },
    targetConfig?: any
  ): Promise<{
    success: boolean;
    deletedTeam?: any;
    promotedTeam?: any;
    syncWarnings?: string[];
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const syncWarnings: string[] = [];

      let resolvedTourneyId = options?.tournamentId || options?.tournamentConfig?.id || targetConfig?.id;
      if (!resolvedTourneyId && options?.teamId) {
        const foundById = allTeams.find(t => t.id === options.teamId);
        if (foundById?.tournamentId) resolvedTourneyId = foundById.tournamentId;
      }

      const config =
        targetConfig ||
        options?.tournamentConfig ||
        this.resolveTournamentContext(guild, undefined, resolvedTourneyId) ||
        rootConfig;

      const tourneyTeams = this.getTeamsForTournament(config);

      let targetTeam: any = null;
      if (options?.teamId) {
        targetTeam = tourneyTeams.find(t => t.id === options.teamId) || allTeams.find(t => t.id === options.teamId);
      }
      if (!targetTeam && options?.isWaitlist === true) {
        targetTeam = tourneyTeams.find(t => t.slotNumber === slotNumber && t.isWaitlist);
      }
      if (!targetTeam && options?.isWaitlist === false) {
        targetTeam = tourneyTeams.find(t => t.slotNumber === slotNumber && !t.isWaitlist);
      }
      if (!targetTeam) {
        targetTeam =
          tourneyTeams.find(t => t.slotNumber === slotNumber && !t.isWaitlist) ||
          tourneyTeams.find(t => t.slotNumber === slotNumber && t.isWaitlist);
      }

      if (!targetTeam) {
        return { success: false, error: `No registered team found in Slot #${slotNumber}.` };
      }

      const masterIdx = allTeams.findIndex(t => t.id === targetTeam.id);
      if (masterIdx === -1) {
        return { success: false, error: `No registered team found in Slot #${slotNumber}.` };
      }

      const resolveManagedTourneyRoles = (g: Guild) => {
        const verifiedRoleName = config?.verifiedRoleName || 'Verified Team';
        const slotRoleName = config?.roleName || 'Confirmed Slot';
        const verifiedRole =
          (config?.verifiedRoleId ? g.roles.cache.get(config.verifiedRoleId) : undefined) ||
          g.roles.cache.find(r => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
        const slotRole =
          (config?.slotRoleId ? g.roles.cache.get(config.slotRoleId) : undefined) ||
          g.roles.cache.find(r => r.name.toLowerCase() === slotRoleName.toLowerCase());
        return [verifiedRole, slotRole].filter(Boolean);
      };

      if (targetTeam.isWaitlist) {
        const deletedWl = allTeams.splice(masterIdx, 1)[0];
        const remainingTourneyTeams = this.getTeamsForTournament(config);
        let wlCount = 1;
        remainingTourneyTeams.forEach(t => {
          if (t.isWaitlist) t.slotNumber = wlCount++;
        });
        if (guild) {
          const managedRoles = resolveManagedTourneyRoles(guild);
          if (managedRoles.length > 0) {
            for (const uid of this.getTeamMemberIds(deletedWl)) {
              if (!/^\d{15,20}$/.test(uid)) continue;
              const member = guild.members.cache.get(uid) || (await guild.members.fetch(uid).catch(() => null));
              if (member) {
                for (const role of managedRoles) {
                  if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role).catch(() => {});
                  }
                }
              }
            }
          }
          await this.cleanupTeamWorkspace(guild, deletedWl).catch(() => {});
        }
        if (this.onTeamDeleted) {
          this.onTeamDeleted(slotNumber);
        }
        if (config) {
          await this.syncGuildChannels(config, guild);
        }
        return { success: true, deletedTeam: deletedWl, syncWarnings };
      }

      const deletedTeam = allTeams.splice(masterIdx, 1)[0];
      const remainingTourneyTeams = this.getTeamsForTournament(config);

      const firstWlTeam = remainingTourneyTeams.find(t => t.isWaitlist);
      let promotedTeam: any = null;
      if (firstWlTeam) {
        firstWlTeam.isWaitlist = false;
        promotedTeam = firstWlTeam;
      }

      let confirmedSlot = 1;
      let waitlistSlot = 1;
      remainingTourneyTeams.forEach(t => {
        if (!t.isWaitlist) {
          t.slotNumber = confirmedSlot++;
          t.group = this.calculateGroupForSlot(t.slotNumber, config);
        } else {
          t.slotNumber = waitlistSlot++;
          t.group = undefined;
        }
      });

      allTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));

      if (guild) {
        const managedRoles = resolveManagedTourneyRoles(guild);

        if (managedRoles.length > 0) {
          for (const uid of this.getTeamMemberIds(deletedTeam)) {
            if (!/^\d{15,20}$/.test(uid)) continue;
            try {
              const member = guild.members.cache.get(uid) || (await guild.members.fetch(uid).catch(() => null));
              if (member) {
                for (const role of managedRoles) {
                  if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role).catch((err: any) => {
                      syncWarnings.push(`Could not remove @${role.name} from <@${uid}>: ${err.message}`);
                    });
                  }
                }
              }
            } catch (err: any) {
              syncWarnings.push(`Role removal lookup notice for ${uid}: ${err.message}`);
            }
          }

          if (promotedTeam) {
            const promoWarnings = await this.syncTeamRolesForRegistration(guild, promotedTeam, config);
            if (promoWarnings.length > 0) {
              syncWarnings.push(...promoWarnings);
            }
          }
        }

        await this.cleanupTeamWorkspace(guild, deletedTeam).catch(() => {});
      }

      if (config) {
        await this.syncGuildChannels(config, guild);
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

  public async getTournamentGuildAssets(guild: Guild | undefined, teamsOverride?: any[], targetConfig?: any) {
    if (!guild) {
      return {
        categories: [] as CategoryChannel[],
        textChannels: [] as TextChannel[],
        voiceChannels: [] as any[],
        roles: [] as any[]
      };
    }

    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});
    const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));

    const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
    const config = targetConfig || this.resolveTournamentContext(guild) || rootConfig;
    const teams = teamsOverride || this.getTeamsForTournament(config);

    const botHighestRolePos = botMember?.roles?.highest?.position ?? 0;
    const isBotAdmin = botMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;

    // Collect IDs belonging to OTHER tournaments in this guild so we NEVER touch them
    const otherTournamentCategoryIds = new Set<string>();
    const otherTournamentChannelIds = new Set<string>();
    const otherTournamentRoleIds = new Set<string>();
    if (rootConfig?.tournaments) {
      for (const tCfg of Object.values(rootConfig.tournaments) as any[]) {
        if (!tCfg || (config?.id && tCfg.id === config.id)) continue;
        if (tCfg.categoryId) otherTournamentCategoryIds.add(tCfg.categoryId);
        if (tCfg.rulesChannelId) otherTournamentChannelIds.add(tCfg.rulesChannelId);
        if (tCfg.regChannelId) otherTournamentChannelIds.add(tCfg.regChannelId);
        if (tCfg.slotListChannelId) otherTournamentChannelIds.add(tCfg.slotListChannelId);
        if (tCfg.idpChannelId) otherTournamentChannelIds.add(tCfg.idpChannelId);
        if (tCfg.regDetailsChannelId) otherTournamentChannelIds.add(tCfg.regDetailsChannelId);
        if (tCfg.verifiedRoleId) otherTournamentRoleIds.add(tCfg.verifiedRoleId);
        if (tCfg.slotRoleId) otherTournamentRoleIds.add(tCfg.slotRoleId);
      }
    }
    const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
    const targetTeamIds = new Set(teams.map((t: any) => t.id));
    for (const t of allTeams) {
      if (!targetTeamIds.has(t.id)) {
        if (t.teamCategoryId) otherTournamentCategoryIds.add(t.teamCategoryId);
        if (t.teamVoiceChannelId) otherTournamentChannelIds.add(t.teamVoiceChannelId);
        if (t.teamRoleId) otherTournamentRoleIds.add(t.teamRoleId);
      }
    }

    const gMap = config?.id === rootConfig?.id ? config?.guildChannels?.[guild.id] : undefined;
    const trackedTextChannelIds = new Set(
      [
        config?.rulesChannelId,
        config?.regChannelId,
        config?.slotListChannelId,
        config?.idpChannelId,
        config?.regDetailsChannelId,
        gMap?.rulesChannelId,
        gMap?.regChannelId,
        gMap?.slotListChannelId,
        gMap?.idpChannelId,
        gMap?.regDetailsChannelId
      ].filter(Boolean)
    );
    const trackedCategoryIds = new Set(
      [config?.categoryId, gMap?.categoryId].filter(Boolean)
    );

    const teamCategoryIds = new Set<string>();
    const teamVoiceIds = new Set<string>();
    const teamRoleIds = new Set<string>();
    const teamNames = new Set<string>();

    for (const t of teams) {
      if (t.teamCategoryId) teamCategoryIds.add(t.teamCategoryId);
      if (t.teamVoiceChannelId) teamVoiceIds.add(t.teamVoiceChannelId);
      if (t.teamRoleId) teamRoleIds.add(t.teamRoleId);
      if (!t.teamCategoryId && !t.teamVoiceChannelId && !t.teamRoleId) {
        if (t.teamName) {
          const clean = t.teamName.trim().toLowerCase();
          teamNames.add(clean);
          teamNames.add(clean.replace(/^🔊\s*/, ''));
        }
        if (t.teamCategoryName) {
          teamNames.add(t.teamCategoryName.trim().toLowerCase());
        }
        if (t.teamRoleName) {
          teamNames.add(t.teamRoleName.trim().toLowerCase());
        }
        if (t.teamVoiceChannelName) {
          const clean = t.teamVoiceChannelName.trim().toLowerCase();
          teamNames.add(clean);
          teamNames.add(clean.replace(/^🔊\s*/, ''));
        }
      }
    }

    const categoriesToDelete = new Map<string, CategoryChannel>();
    const voiceChannelsToDelete = new Map<string, any>();
    const cfgCatName = (config?.categoryName || '').trim().toLowerCase();

    // 1. Identify Target Tournament Category & Target Tournament Team Categories
    for (const [, ch] of guild.channels.cache) {
      if (ch.type === ChannelType.GuildCategory) {
        const cat = ch as CategoryChannel;
        if (otherTournamentCategoryIds.has(cat.id)) continue;

        const nameLower = cat.name.trim().toLowerCase();
        const isTrackedCatId = trackedCategoryIds.has(cat.id);
        const isConfigCat = trackedCategoryIds.size === 0 && cfgCatName.length > 0 && nameLower === cfgCatName;
        const isTeamCatId = teamCategoryIds.has(cat.id);
        const isTeamCatName = teamNames.has(nameLower);

        const hasTrackedTournamentChild = guild.channels.cache.some(
          c => c.parentId === cat.id && trackedTextChannelIds.has(c.id)
        );

        const hasPrivateTeamVoice = guild.channels.cache.some(
          c =>
            c.parentId === cat.id &&
            c.type === ChannelType.GuildVoice &&
            !otherTournamentChannelIds.has(c.id) &&
            (teamVoiceIds.has(c.id) ||
              teamNames.has(c.name.trim().toLowerCase()) ||
              teamNames.has(c.name.trim().toLowerCase().replace(/^🔊\s*/, '')))
        );

        if (
          isTrackedCatId ||
          isConfigCat ||
          isTeamCatId ||
          isTeamCatName ||
          hasTrackedTournamentChild ||
          hasPrivateTeamVoice
        ) {
          categoriesToDelete.set(cat.id, cat);
        }
      }
    }

    // 2. Identify Voice Channels belonging to this tournament's teams or categories
    for (const [, ch] of guild.channels.cache) {
      if (ch.type === ChannelType.GuildVoice) {
        if (otherTournamentChannelIds.has(ch.id)) continue;
        if (ch.parentId && otherTournamentCategoryIds.has(ch.parentId)) continue;

        const nameLower = ch.name.trim().toLowerCase();
        const cleanName = nameLower.replace(/^🔊\s*/, '');
        const isTeamVoiceId = teamVoiceIds.has(ch.id);
        const isInsideTournamentOrTeamCat = ch.parentId ? categoriesToDelete.has(ch.parentId) : false;
        const matchesTeamName = teamNames.has(nameLower) || teamNames.has(cleanName);

        if (isTeamVoiceId || isInsideTournamentOrTeamCat || matchesTeamName) {
          voiceChannelsToDelete.set(ch.id, ch);
          if (ch.parentId && !categoriesToDelete.has(ch.parentId) && !otherTournamentCategoryIds.has(ch.parentId)) {
            const parent = guild.channels.cache.get(ch.parentId) as CategoryChannel | undefined;
            if (parent && parent.type === ChannelType.GuildCategory) {
              categoriesToDelete.set(parent.id, parent);
            }
          }
        }
      }
    }

    for (const [, ch] of guild.channels.cache) {
      if (
        ch.type === ChannelType.GuildVoice &&
        ch.parentId &&
        categoriesToDelete.has(ch.parentId) &&
        !otherTournamentChannelIds.has(ch.id)
      ) {
        voiceChannelsToDelete.set(ch.id, ch);
      }
    }

    // 3. Identify Text Channels belonging strictly to this tournament
    const textChannelsToDelete = new Map<string, TextChannel>();
    for (const [, ch] of guild.channels.cache) {
      if (ch.isTextBased() && ch.type === ChannelType.GuildText) {
        const textCh = ch as TextChannel;
        if (otherTournamentChannelIds.has(textCh.id)) continue;
        if (textCh.parentId && otherTournamentCategoryIds.has(textCh.parentId)) continue;

        const isTrackedId = trackedTextChannelIds.has(textCh.id);
        const isInsideTournamentCat = textCh.parentId ? categoriesToDelete.has(textCh.parentId) : false;

        if (isTrackedId || isInsideTournamentCat) {
          textChannelsToDelete.set(textCh.id, textCh);
        }
      }
    }

    // 4. Identify Roles belonging strictly to this tournament
    const rolesToDelete = new Map<string, any>();
    const protectedRoleNames = new Set([
      '@everyone',
      'ffa bot manager',
      (config?.managerRoleName || 'FFA Bot Manager').trim().toLowerCase()
    ]);

    const verifiedRoleName = (config?.verifiedRoleName || 'Verified Team').trim().toLowerCase();
    const slotRoleName = (config?.roleName || 'Confirmed Slot').trim().toLowerCase();

    const dynamicallyDiscoveredRoleIds = new Set<string>();
    for (const vc of voiceChannelsToDelete.values()) {
      if (vc.permissionOverwrites?.cache) {
        for (const [owId, ow] of vc.permissionOverwrites.cache) {
          if (ow.type === 0 && owId !== guild.roles.everyone.id && !otherTournamentRoleIds.has(owId)) {
            dynamicallyDiscoveredRoleIds.add(owId);
          }
        }
      }
    }
    for (const cat of categoriesToDelete.values()) {
      if (cat.permissionOverwrites?.cache) {
        for (const [owId, ow] of cat.permissionOverwrites.cache) {
          if (ow.type === 0 && owId !== guild.roles.everyone.id && !otherTournamentRoleIds.has(owId)) {
            dynamicallyDiscoveredRoleIds.add(owId);
          }
        }
      }
    }

    for (const [, r] of guild.roles.cache) {
      const rNameLower = r.name.trim().toLowerCase();

      if (protectedRoleNames.has(rNameLower) || r.managed || otherTournamentRoleIds.has(r.id)) {
        continue;
      }

      if (!isBotAdmin && r.position >= botHighestRolePos) {
        continue;
      }

      const isTrackedVerifiedRole = config?.verifiedRoleId
        ? r.id === config.verifiedRoleId
        : (otherTournamentRoleIds.size === 0 && (rNameLower === verifiedRoleName || rNameLower === 'verified team'));
      const isTrackedSlotRole = config?.slotRoleId
        ? r.id === config.slotRoleId
        : (otherTournamentRoleIds.size === 0 && (rNameLower === slotRoleName || rNameLower === 'confirmed slot'));
      const isTeamRoleId = teamRoleIds.has(r.id);
      const isTeamName = teamNames.has(rNameLower);
      const isOverwrittenRole = dynamicallyDiscoveredRoleIds.has(r.id);

      if (isTrackedVerifiedRole || isTrackedSlotRole || isTeamRoleId || isTeamName || isOverwrittenRole) {
        rolesToDelete.set(r.id, r);
      }
    }

    return {
      categories: Array.from(categoriesToDelete.values()),
      textChannels: Array.from(textChannelsToDelete.values()),
      voiceChannels: Array.from(voiceChannelsToDelete.values()),
      roles: Array.from(rolesToDelete.values())
    };
  }

  public async previewDeleteTournament(
    guild?: Guild,
    deleteChannels: boolean = true,
    targetConfig?: any
  ): Promise<{
    title: string;
    confirmedCount: number;
    waitlistCount: number;
    categoriesToDelete: string[];
    voiceChannelsToDelete: string[];
    textChannelsToDelete: string[];
    rolesToDelete: string[];
    channelsToDelete: string[];
  }> {
    const config = targetConfig || this.resolveTournamentContext(guild) || (this.getTournamentConfig ? this.getTournamentConfig() : null);
    const teams = this.getTeamsForTournament(config);
    const confirmedCount = teams.filter(t => !t.isWaitlist).length;
    const waitlistCount = teams.filter(t => t.isWaitlist).length;

    const categoriesToDelete: string[] = [];
    const voiceChannelsToDelete: string[] = [];
    const textChannelsToDelete: string[] = [];
    const rolesToDelete: string[] = [];
    const channelsToDelete: string[] = [];

    if (guild && deleteChannels) {
      const assets = await this.getTournamentGuildAssets(guild, teams, config);

      for (const cat of assets.categories) {
        const label = `📁 Category: ${cat.name}`;
        categoriesToDelete.push(label);
        channelsToDelete.push(label);
      }

      for (const vc of assets.voiceChannels) {
        const label = `🔊 ${vc.name}`;
        voiceChannelsToDelete.push(label);
        channelsToDelete.push(label);
      }

      for (const ch of assets.textChannels) {
        const label = `#${ch.name}`;
        textChannelsToDelete.push(label);
        channelsToDelete.push(label);
      }

      for (const r of assets.roles) {
        rolesToDelete.push(`@${r.name}`);
      }
    }

    return {
      title: config?.title || 'Active Tournament',
      confirmedCount,
      waitlistCount,
      categoriesToDelete,
      voiceChannelsToDelete,
      textChannelsToDelete,
      rolesToDelete,
      channelsToDelete
    };
  }

  public async deleteTournament(
    guild?: Guild,
    deleteChannels: boolean = true,
    targetConfig?: any
  ): Promise<{
    success: boolean;
    deletedChannels: string[];
    deletedCategories: string[];
    deletedVoiceChannels: string[];
    deletedTextChannels: string[];
    deletedRoles: string[];
    clearedTeamsCount: number;
    error?: string;
  }> {
    return this.withOperationLock(async () => {
      const rootConfig = this.getTournamentConfig ? this.getTournamentConfig() : null;
      const config = targetConfig || this.resolveTournamentContext(guild) || rootConfig;
      const deletedChannels: string[] = [];
      const deletedCategories: string[] = [];
      const deletedVoiceChannels: string[] = [];
      const deletedTextChannels: string[] = [];
      const deletedRoles: string[] = [];

      for (const timer of this.cleanupTimers) {
        clearTimeout(timer);
      }
      this.cleanupTimers.clear();

      const allTeams = this.getRegisteredTeams ? this.getRegisteredTeams() : [];
      const teamsToClean = [...this.getTeamsForTournament(config)];
      const clearedTeamsCount = teamsToClean.length;

      if (config) {
        config.status = 'closed';
        config.explicitlyStoppedOrPaused = true;
      }

      if (guild && deleteChannels) {
        const assets = await this.getTournamentGuildAssets(guild, teamsToClean, config);

        // 1. Delete all voice channels first
        for (const vc of assets.voiceChannels) {
          const vcName = vc.name;
          try {
            await vc.delete('FFA-Manager /delete tournament — clean tournament voice channel');
            deletedVoiceChannels.push(`🔊 ${vcName}`);
            deletedChannels.push(`🔊 ${vcName}`);
          } catch (err: any) {
            console.warn(`[DiscordBot] Notice deleting voice channel ${vcName}: ${err.message}`);
          }
        }

        // 2. Delete all text channels for this tournament
        for (const ch of assets.textChannels) {
          const chName = ch.name;
          this.slotListMessageIds.delete(ch.id);
          this.regDetailsMessageIds.delete(ch.id);
          try {
            await ch.delete('FFA-Manager /delete tournament — clean tournament text channel');
            deletedTextChannels.push(`#${chName}`);
            deletedChannels.push(`#${chName}`);
          } catch (err: any) {
            console.warn(`[DiscordBot] Notice deleting text channel #${chName}: ${err.message}`);
          }
        }

        // 3. Delete remaining child channels inside target categories and then the categories themselves
        for (const cat of assets.categories) {
          const remainingChildren = guild.channels.cache.filter(c => c.parentId === cat.id);
          for (const [, child] of remainingChildren) {
            try {
              await child.delete('FFA-Manager /delete tournament — clean category child channel');
            } catch {
            }
          }

          const catName = cat.name;
          try {
            await cat.delete('FFA-Manager /delete tournament — clean tournament category');
            deletedCategories.push(`📁 Category: ${catName}`);
            deletedChannels.push(`Category: ${catName}`);
          } catch (err: any) {
            console.warn(`[DiscordBot] Notice deleting category ${catName}: ${err.message}`);
          }
        }

        // 4. Delete all team roles and tournament participant roles for this tournament
        for (const role of assets.roles) {
          const roleName = role.name;
          try {
            await role.delete('FFA-Manager /delete tournament — clean tournament role');
            deletedRoles.push(`@${roleName}`);
          } catch (err: any) {
            console.warn(`[DiscordBot] Notice deleting role @${roleName}: ${err.message}`);
          }
        }

        // 5. Secondary fallback pass over individual registered team metadata
        for (const t of teamsToClean) {
          try {
            const fallbackCleaned = await this.cleanupTeamWorkspace(guild, t).catch(() => []);
            for (const item of fallbackCleaned) {
              if (!deletedChannels.includes(item)) {
                deletedChannels.push(item);
                if (item.startsWith('Category:')) deletedCategories.push(`📁 ${item}`);
                else if (item.startsWith('Voice:')) deletedVoiceChannels.push(item.replace('Voice:', '').trim());
                else if (item.startsWith('Role:')) deletedRoles.push(item.replace('Role:', '').trim());
              }
            }
          } catch {
          }
        }
      }

      // Remove only the deleted tournament's teams from master array
      const cleanIds = new Set(teamsToClean.map(t => t.id));
      for (let i = allTeams.length - 1; i >= 0; i--) {
        if (cleanIds.has(allTeams[i].id)) {
          allTeams.splice(i, 1);
        }
      }

      // Remove tournament from registry and promote next available tournament if any
      if (rootConfig) {
        if (config?.id && rootConfig.tournaments && rootConfig.tournaments[config.id]) {
          delete rootConfig.tournaments[config.id];
        }
        const remainingTourneys = rootConfig.tournaments
          ? (Object.values(rootConfig.tournaments) as any[]).sort((a, b) =>
              String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            )
          : [];

        if (remainingTourneys.length > 0) {
          this.syncTournamentToRootConfig(remainingTourneys[0], true);
          if (this.onConfigUpdated) {
            this.onConfigUpdated();
          }
        } else {
          rootConfig.id = '';
          rootConfig.totalSlots = 0;
          rootConfig.teamsPerGroup = 0;
          rootConfig.groupsCount = 0;
          rootConfig.status = 'closed';
          rootConfig.explicitlyStoppedOrPaused = true;
          rootConfig.categoryName = '';
          rootConfig.categoryId = '';
          rootConfig.rulesChannelId = '';
          rootConfig.regChannelId = '';
          rootConfig.slotListChannelId = '';
          rootConfig.idpChannelId = '';
          rootConfig.regDetailsChannelId = '';
          rootConfig.verifiedRoleId = '';
          rootConfig.slotRoleId = '';
          if (guild && rootConfig.guildChannels) {
            delete rootConfig.guildChannels[guild.id];
          } else {
            rootConfig.guildChannels = {};
          }
          if (this.onTournamentDeleted) {
            this.onTournamentDeleted();
          }
        }
      }

      this.logEvent(
        'warn',
        `Tournament "${config?.title || 'Tournament'}" deleted and its assets removed! (Categories: ${deletedCategories.length}, Voice: ${deletedVoiceChannels.length}, Text: ${deletedTextChannels.length}, Roles: ${deletedRoles.length}, Teams cleared: ${clearedTeamsCount})`,
        guild?.name
      );

      return {
        success: true,
        deletedChannels,
        deletedCategories,
        deletedVoiceChannels,
        deletedTextChannels,
        deletedRoles,
        clearedTeamsCount
      };
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
    tournamentId?: string;
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

    const tournamentId = 'tourney-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

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
    const baseVerifiedRoleName = options.verifiedRoleName?.trim() || 'Verified Team';
    const baseSlotRoleName = 'Confirmed Slot';
    const existingGuildTournaments = this.getGuildTournaments(guild);
    const hasExistingTournamentInGuild = existingGuildTournaments.length > 0;
    const verifiedRoleName = hasExistingTournamentInGuild
      ? `${baseVerifiedRoleName} (${title})`.slice(0, 95)
      : baseVerifiedRoleName;
    const slotRoleName = hasExistingTournamentInGuild
      ? `${baseSlotRoleName} (${title})`.slice(0, 95)
      : baseSlotRoleName;
    const cleanOptCategory = options.categoryName ? options.categoryName.replace(/^🏆\s*┃?\s*/i, '').trim() : '';
    const categoryName = cleanOptCategory || title.toUpperCase();

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
    let verifiedRole: any = undefined;
    let slotRole: any = undefined;

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

        verifiedRole = await guild.roles.create({
          name: verifiedRoleName,
          color: 0x00E676,
          hoist: true,
          mentionable: true,
          reason: `FFA-Manager Verified Team Role for ${title} (${tournamentId})`
        });
        newlyCreatedRoles.push(verifiedRole);
        created.push(`Role: @${verifiedRole.name}`);

        slotRole = await guild.roles.create({
          name: slotRoleName,
          color: 0x5865F2,
          mentionable: true,
          reason: `FFA-Manager Confirmed Slot Role for ${title} (${tournamentId})`
        });
        newlyCreatedRoles.push(slotRole);
        created.push(`Role: @${slotRole.name}`);
      } catch (err: any) {
        warnings.push(`Role creation notice: ${err.message}`);
        console.log(`[DiscordBot] Role creation notice: ${err.message}`);
      }
    }

    try {
      const category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory
      });
      newlyCreatedChannels.push(category);
      created.push(`Category: ${category.name}`);

      const parentId = category.id;

      const rulesChannelName = 'tournament-rules';
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
      const rulesCh = await guild.channels.create({
        name: rulesChannelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Official tournament rules, format and scoring for ${title}`,
        permissionOverwrites: rulesOverwrites
      });
      newlyCreatedChannels.push(rulesCh);
      created.push(`Channel: #${rulesCh.name}`);

      const regChannelName = 'tournament-registration';
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
      const regCh = await guild.channels.create({
        name: regChannelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Registration channel for ${title} (OPEN). Click Register Your Team or tag ${tags} players to register.`,
        permissionOverwrites: regOverwrites
      });
      newlyCreatedChannels.push(regCh);
      created.push(`Channel: #${regCh.name} (OPEN — Registration Panel Active)`);

      const panelPayload = this.createRegistrationPanelPayload({
        ...config,
        id: tournamentId,
        title,
        totalSlots: slots,
        requiredTags: tags
      });

      await regCh.send(panelPayload).catch((e: any) => {
        warnings.push(`Could not post registration panel in #${regCh.name}: ${e.message}`);
      });

      const slotListChannelName = 'slot-list';
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
      const slotCh = await guild.channels.create({
        name: slotListChannelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Live confirmed slots & waitlist for ${title}`,
        permissionOverwrites: slotOverwrites
      });
      newlyCreatedChannels.push(slotCh);
      created.push(`Channel: #${slotCh.name}`);

      const idpChannelName = 'tournament-idp';
      const idpOverwrites: any[] = [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages]
        }
      ];

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
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      const idpCh = await guild.channels.create({
        name: idpChannelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Match room credentials (Room ID & Password) for ${title}`,
        permissionOverwrites: idpOverwrites
      });
      newlyCreatedChannels.push(idpCh);
      created.push(`Channel: #${idpCh.name} (Public — Chat Locked)`);

      const idpEmbed = new EmbedBuilder()
        .setTitle(`${EMOJI.giveaway} Match Room Credentials — ${title}`)
        .setColor(0xFEE75C)
        .setDescription(
          `${EMOJI.golden} Welcome to the official room credentials channel!\n` +
          `${EMOJI.dividerBar}\n` +
          `${EMOJI.sword} Room ID & Password will be published here 15 minutes before match start.\n` +
          `${EMOJI.done} Ensure your team joins only your allotted slot number in the lobby.`
        )
        .setFooter({ text: 'FFA | Glacier Cup Manager™ Room Management' })
        .setTimestamp();

      await idpCh.send({ embeds: [idpEmbed] }).catch((e: any) => {
        warnings.push(`Could not post welcome message in #${idpCh.name}: ${e.message}`);
      });

      const regDetailsChannelName = 'registration-details';
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

      const regDetailsCh = await guild.channels.create({
        name: regDetailsChannelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Confidential team registration details (Sequence-wise: Team Name, Region, WhatsApp, Players Tags) — Visible only to @${managerRoleName}`,
        permissionOverwrites: regDetailsOverwrites
      });
      newlyCreatedChannels.push(regDetailsCh);
      created.push(`Channel: #${regDetailsCh.name} (Hidden — Visible to @${managerRoleName})`);

      const format =
        tags === 4 ? 'Squad' :
        tags === 3 ? 'Trio' :
        tags === 2 ? 'Duo' :
        tags === 1 ? 'Solo' : 'Custom';

      const newTourneyConfig: Record<string, any> = {
        id: tournamentId,
        guildId: guild.id,
        createdAt: new Date().toISOString(),
        title,
        subtitle: config.subtitle || 'DAILY COMPETITIVE SCRIMS',
        format,
        totalSlots: slots,
        reservedSlots: config.reservedSlots || 0,
        requiredTags: tags,
        maxTags: tags,
        teamsPerGroup,
        groupsCount,
        duplicateTagCheck: config.duplicateTagCheck ?? true,
        autoAssignRole: config.autoAssignRole ?? true,
        roleName: slotRole?.name || slotRoleName,
        slotRoleId: slotRole?.id,
        verifiedRoleName: verifiedRole?.name || verifiedRoleName,
        verifiedRoleId: verifiedRole?.id,
        managerRoleName: managerRole?.name || managerRoleName,
        managerRoleId: managerRole?.id,
        categoryId: category.id,
        categoryName: category.name,
        rulesChannelId: rulesCh.id,
        rulesChannel: rulesCh.name,
        regChannelId: regCh.id,
        regChannel: regCh.name,
        slotListChannelId: slotCh.id,
        slotListChannel: slotCh.name,
        idpChannelId: idpCh.id,
        idpChannel: idpCh.name,
        regDetailsChannelId: regDetailsCh.id,
        regDetailsChannel: regDetailsCh.name,
        status: 'open',
        explicitlyStoppedOrPaused: false,
        prizePool: config.prizePool || '$500 USD',
        startTime: config.startTime || '20:00 UTC',
        rulesText: options.rules?.trim() || config.rulesText || '',
        rulesUpdatedAt: options.rules?.trim() ? new Date().toISOString() : config.rulesUpdatedAt,
        rulesUpdatedBy: options.createdBy || config.rulesUpdatedBy
      };

      const registry = this.ensureTournamentsRegistry(config);
      registry[tournamentId] = newTourneyConfig;
      this.syncTournamentToRootConfig(newTourneyConfig, true);

      if (options.rules && options.rules.trim().length > 0) {
        const pubRes = await this.publishRulesToChannel(guild, options.rules.trim(), options.createdBy, newTourneyConfig);
        if (!pubRes.success && pubRes.error) {
          warnings.push(`Rules publication notice: ${pubRes.error}`);
        }
      }

      const slotListRes = await this.updateSlotListChannel(guild, newTourneyConfig);
      if (!slotListRes.updated && slotListRes.error) {
        warnings.push(`Initial #slot-list message notice: ${slotListRes.error}`);
      }

      if (this.onConfigUpdated) {
        this.onConfigUpdated();
      }

      this.logEvent(
        warnings.length > 0 ? 'warn' : 'success',
        `Tournament "${title}" (${tournamentId}) setup in "${guild.name}" (${slots} slots, ${tags} tags, ${teamsPerGroup} teams/group [${groupsCount} groups], registration OPEN): ${created.join(', ')}${warnings.length > 0 ? ` [Warnings: ${warnings.join('; ')}]` : ''}`,
        guild.name
      );
      this.refreshGuilds();

      return { success: true, tournamentId, created, warnings };
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
