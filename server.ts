import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { discordBot } from './src/server/discordBot.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = process.env.STATE_FILE_PATH
  ? path.resolve(process.env.STATE_FILE_PATH)
  : path.resolve(__dirname, '.tournament-state.json');

interface PlayerTag {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export type TournamentRegion = 'India' | 'Pakistan' | 'Bangladesh';

interface TeamRegistration {
  id: string;
  tournamentId?: string;
  slotNumber: number;
  teamName: string;
  captain: PlayerTag;
  players: PlayerTag[];
  registeredAt: string;
  messageId: string;
  channelId: string;
  isWaitlist: boolean;
  group?: string;
  teamRoleId?: string;
  teamRoleName?: string;
  teamCategoryId?: string;
  teamCategoryName?: string;
  teamVoiceChannelId?: string;
  teamVoiceChannelName?: string;
  whatsappNumber1?: string;
  whatsappNumber2?: string;
  region?: TournamentRegion;
}

interface TournamentConfig {
  id: string;
  guildId?: string;
  createdAt?: string;
  title: string;
  game: string;
  format: 'Squad' | 'Trio' | 'Duo' | 'Solo' | 'Custom';
  requiredTags: number;
  maxTags: number;
  totalSlots: number;
  waitlistSlots: number;
  groupsCount?: number;
  teamsPerGroup?: number;
  categoryId?: string;
  categoryName?: string;
  verifiedRoleName?: string;
  verifiedRoleId?: string;
  managerRoleName?: string;
  managerRoleId?: string;
  slotRoleId?: string;
  rulesChannelId?: string;
  rulesChannel?: string;
  customRules?: string;
  easyTagEnabled: boolean;
  prohibitDuplicateTags: boolean;
  prohibitSelfDuplication: boolean;
  disallowBots: boolean;
  autoDeleteInvalid: boolean;
  autoDeleteSeconds: number;
  autoCreateTeamVoice?: boolean;
  status: 'open' | 'closed';
  regChannelId?: string;
  regChannel: string;
  slotListChannelId?: string;
  slotListChannel: string;
  idpChannelId?: string;
  idpChannel: string;
  regDetailsChannelId?: string;
  regDetailsChannel?: string;
  guildChannels?: Record<
    string,
    {
      categoryId?: string;
      rulesChannelId?: string;
      regChannelId?: string;
      slotListChannelId?: string;
      idpChannelId?: string;
      regDetailsChannelId?: string;
    }
  >;
  tournaments?: Record<string, any>;
  rulesMessage: string;
  roleName: string;
}

interface RoomCredentials {
  roomId: string;
  roomPass: string;
  mapName: string;
  matchTime: string;
  serverType: string;
  sentAt?: string;
}

let config: TournamentConfig & { explicitlyStoppedOrPaused?: boolean } = {
  id: '',
  title: 'Glacier Cup',
  game: '',
  format: 'Squad',
  requiredTags: 4,
  maxTags: 4,
  totalSlots: 0,
  waitlistSlots: 5,
  groupsCount: 1,
  teamsPerGroup: 0,
  categoryName: '',
  easyTagEnabled: true,
  prohibitDuplicateTags: true,
  prohibitSelfDuplication: true,
  disallowBots: true,
  autoDeleteInvalid: true,
  autoDeleteSeconds: 5,
  autoCreateTeamVoice: true,
  status: 'closed',
  explicitlyStoppedOrPaused: true,
  rulesChannel: 'tournament-rules',
  regChannel: 'tournament-registration',
  slotListChannel: 'slot-list',
  idpChannel: 'tournament-idp',
  regDetailsChannel: 'registration-details',
  rulesMessage: 'Format:\nTeam Name: Glacier Titans\nRegion: India\nWhatsApp: +919876543210\nPlayer 1: @Captain\nPlayer 2: @Player2\nPlayer 3: @Player3\nPlayer 4: @Player4',
  roleName: 'Confirmed Slot',
  verifiedRoleName: 'Verified Team',
  managerRoleName: 'FFA Bot Manager'
};

let registeredTeams: TeamRegistration[] = [];
let lastRoomDispatch: RoomCredentials | null = null;

function saveTournamentState() {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const botData = discordBot.getPersistedBotData();
    const serialized = JSON.stringify({ config, registeredTeams, lastRoomDispatch, botData }, null, 2);
    const tempFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tempFile, serialized, 'utf8');
    fs.renameSync(tempFile, STATE_FILE);
  } catch (err) {
    console.error('[Server] Failed to save tournament state to disk:', err);
  }
}

function loadTournamentState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.config) {
        config = { ...config, ...parsed.config };
        const hasAnyRegisteredTourney = Boolean(
          (config.tournaments && Object.keys(config.tournaments).length > 0) ||
            config.id ||
            config.categoryId ||
            config.regChannelId
        );
        if (!hasAnyRegisteredTourney || typeof config.totalSlots !== 'number' || config.totalSlots <= 0) {
          config.id = '';
          config.totalSlots = 0;
          config.teamsPerGroup = 0;
          config.groupsCount = 0;
          config.status = 'closed';
          config.explicitlyStoppedOrPaused = true;
        } else if (!config.explicitlyStoppedOrPaused) {
          config.status = 'open';
        }
      }
      if (parsed && Array.isArray(parsed.registeredTeams)) {
        registeredTeams = parsed.registeredTeams;
      }
      if (parsed && parsed.lastRoomDispatch) {
        lastRoomDispatch = parsed.lastRoomDispatch;
      }
      if (parsed && parsed.botData) {
        discordBot.restorePersistedBotData(parsed.botData);
      }
    }
  } catch (err) {
    console.error('[Server] Failed to load tournament state from disk:', err);
  }
}

loadTournamentState();

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Handled async rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Handled runtime exception:', err.message);
});

async function startServer() {
  const app = express();
  const parsedPort = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);
  const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      botOnline: discordBot.getStatus().isOnline
    });
  });

  discordBot.getTournamentConfig = () => config;
  discordBot.getRegisteredTeams = () => registeredTeams;
  discordBot.onConfigUpdated = () => {
    saveTournamentState();
  };
  discordBot.onTeamRegistered = (team) => {
    registeredTeams.push(team);
    saveTournamentState();
    console.log(`[Tournament] Registered new team via Discord bot: ${team.teamName} (Slot #${team.slotNumber})`);
  };
  discordBot.onTeamDeleted = (slotNumber) => {
    saveTournamentState();
    console.log(`[Tournament] Slot #${slotNumber} deleted via Discord command`);
  };
  discordBot.onTournamentDeleted = () => {
    saveTournamentState();
    console.log(`[Tournament] Tournament deleted via Discord command`);
  };

  const getConfiguredToken = (): string => {
    return (process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim();
  };

  const initialToken = getConfiguredToken();
  if (initialToken) {
    discordBot.start(initialToken).then(res => {
      if (res.success) {
        console.log('FFA-Manager connected to Discord Gateway on startup.');
      } else {
        console.error('FFA-Manager startup notice:', res.error);
      }
    }).catch((err) => {
      console.error('FFA-Manager unexpected startup error:', err);
    });
  } else {
    console.warn(
      '[Server] Notice: DISCORD_TOKEN environment variable is not set. ' +
      'Configure DISCORD_TOKEN in your .env file or hosting environment to auto-connect on startup, ' +
      'or connect manually via the web dashboard.'
    );
  }

  app.get('/api/config', (_req: Request, res: Response) => {
    discordBot.reconcileActiveTournaments();
    res.json(config);
  });

  app.post('/api/config', async (req: Request, res: Response) => {
    const incoming = { ...req.body };
    const isExplicitStatusChange = Boolean(incoming.explicitStatusCommand);
    delete incoming.explicitStatusCommand;

    if (!isExplicitStatusChange) {
      delete incoming.status;
    } else if (incoming.status === 'closed') {
      config.explicitlyStoppedOrPaused = true;
    } else if (incoming.status === 'open') {
      config.explicitlyStoppedOrPaused = false;
    }

    config = { ...config, ...incoming };
    if (typeof config.totalSlots === 'number') {
      if (config.totalSlots > 0) {
        config.totalSlots = Math.max(2, Math.min(500, Math.round(config.totalSlots)));
      } else {
        config.totalSlots = 0;
      }
    }
    const activeTeams = discordBot.getTeamsForTournament(config);
    if (config.totalSlots > 0) {
      const effectiveTpg =
        config.teamsPerGroup && config.teamsPerGroup > 0
          ? Math.max(1, Math.min(config.totalSlots, Math.round(config.teamsPerGroup)))
          : config.totalSlots;
      config.teamsPerGroup = effectiveTpg;
      config.groupsCount = Math.max(1, Math.ceil(config.totalSlots / effectiveTpg));
      for (const t of activeTeams) {
        if (!t.isWaitlist) {
          t.group = discordBot.calculateGroupForSlot(t.slotNumber, config);
        }
      }
    }
    if (typeof config.requiredTags === 'number' && config.requiredTags > 0) {
      config.maxTags = config.requiredTags;
      if (config.requiredTags === 4) config.format = 'Squad';
      else if (config.requiredTags === 3) config.format = 'Trio';
      else if (config.requiredTags === 2) config.format = 'Duo';
      else if (config.requiredTags === 1) config.format = 'Solo';
      else config.format = 'Custom';
    }
    if (!config.explicitlyStoppedOrPaused) {
      config.status = 'open';
    }
    if (config.id && config.tournaments && config.tournaments[config.id]) {
      Object.assign(config.tournaments[config.id], {
        title: config.title,
        format: config.format,
        totalSlots: config.totalSlots,
        requiredTags: config.requiredTags,
        maxTags: config.maxTags,
        teamsPerGroup: config.teamsPerGroup,
        groupsCount: config.groupsCount,
        status: config.status,
        explicitlyStoppedOrPaused: config.explicitlyStoppedOrPaused
      });
    }
    saveTournamentState();
    await discordBot.syncGuildChannels(config).catch(() => {});
    res.json({ success: true, config, teams: discordBot.getTeamsForTournament(config) });
  });

  app.get('/api/teams', (_req: Request, res: Response) => {
    discordBot.reconcileActiveTournaments();
    const activeTeams = discordBot.getTeamsForTournament(config);
    res.json({
      confirmed: activeTeams.filter(t => !t.isWaitlist),
      waitlist: activeTeams.filter(t => t.isWaitlist),
      totalSlots: config.totalSlots,
      waitlistSlots: config.waitlistSlots,
      remainingSlots: Math.max(0, config.totalSlots - activeTeams.filter(t => !t.isWaitlist).length),
      isFull: config.totalSlots > 0 && activeTeams.filter(t => !t.isWaitlist).length >= config.totalSlots
    });
  });

  app.post('/api/parse-eztag', (req: Request, res: Response) => {
    const { text, userDirectory } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing text content' });
    }

    const tokenRegex = /(?:<@!?)?(\d{6,25})>?/g;
    let convertedText = text;
    const detectedTags: any[] = [];
    const unresolvedIds: string[] = [];
    const malformedIds: string[] = [];

    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
      const foundId = match[1];
      if (!/^\d{17,20}$/.test(foundId)) {
        malformedIds.push(foundId);
        continue;
      }
      const foundUser = (userDirectory || []).find((u: any) => u.id === foundId);
      if (foundUser) {
        convertedText = convertedText.replace(match[0], `@${foundUser.displayName}`);
        detectedTags.push(foundUser);
      } else {
        unresolvedIds.push(foundId);
      }
    }

    res.json({
      originalText: text,
      convertedText,
      detectedTags,
      unresolvedIds,
      malformedIds,
      valid: malformedIds.length === 0 && unresolvedIds.length === 0
    });
  });

  app.post('/api/register', async (req: Request, res: Response) => {
    const {
      teamName,
      captain,
      players,
      messageId,
      channelId,
      whatsappNumber1,
      region
    } = req.body;

    const result = await discordBot.withOperationLock(async () => {
      if (!config.totalSlots || config.totalSlots <= 0) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'NO_TOURNAMENT_CREATED',
            error: 'Tournament slot capacity is not set yet! Please set your Total Slots (2–500) in the Team Slots section or run /setup first.'
          }
        };
      }
      if (!config.explicitlyStoppedOrPaused && config.status !== 'open') {
        config.status = 'open';
      }
      if (config.status !== 'open') {
        return {
          status: 400,
          body: {
            success: false,
            code: 'REGISTRATION_CLOSED',
            error: `Registrations are currently ${config.status.toUpperCase()}! Please wait for staff to open.`
          }
        };
      }

      const cleanedName = (teamName || '').replace(/^<\s*|\s*>$/g, '').trim();
      const lowerName = cleanedName.toLowerCase();
      if (!cleanedName || cleanedName.length < 2 || lowerName === 'team name' || lowerName === 'your team' || lowerName === 'your team name') {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_TEAM_NAME',
            error: 'Please specify a valid Team Name (e.g. `Team Name: Team Glacier`).'
          }
        };
      }

      const validRegions = ['India', 'Pakistan', 'Bangladesh'] as const;
      if (!region || !validRegions.includes(region as any)) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_REGION',
            error: 'Region is required and must be selected from: India, Bangladesh, or Pakistan.'
          }
        };
      }

      const rawWa1 = typeof whatsappNumber1 === 'string' ? whatsappNumber1.trim() : '';
      const waNorm = discordBot.normalizeWhatsAppWithRegion(rawWa1, region as TournamentRegion);
      if (!waNorm.valid) {
        const expectedCode = discordBot.getRegionCountryCode(region as TournamentRegion);
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_WHATSAPP_NUMBER',
            error: `WhatsApp Number is required with ${expectedCode} country code for ${region} (e.g., ${expectedCode}9876543210).`
          }
        };
      }
      const cleanWa1 = waNorm.formatted;

      const rawPlayers = Array.isArray(players) ? players : [];
      if (rawPlayers.length < config.requiredTags) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INSUFFICIENT_TAGS',
            error: `Tagcheck Failed! Exactly ${config.requiredTags} players are required for ${config.format} (as set during setup). You provided ${rawPlayers.length}.`
          }
        };
      }

      if (rawPlayers.length > config.requiredTags) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'EXCESSIVE_TAGS',
            error: `Tagcheck Failed! Only ${config.requiredTags} players are allowed per team as set during setup (no extra players or tags). You provided ${rawPlayers.length}.`
          }
        };
      }

      const client = (discordBot as any).client;
      const guild = client?.guilds?.cache?.first() || null;
      const activeTeams = discordBot.getTeamsForTournament(config);

      const resolvedPlayers: { id: string; username: string; displayName: string; avatar: string; isBot?: boolean }[] = [];
      for (const rawPlayer of rawPlayers) {
        const resolved = await discordBot.resolveSubmittedPlayer(rawPlayer, guild, activeTeams);
        if (!resolved || !resolved.id) {
          return {
            status: 400,
            body: {
              success: false,
              code: 'INVALID_PLAYER_ID',
              error: 'Tagcheck Failed! Every player in the roster must have a valid Discord user ID or tag.'
            }
          };
        }
        resolvedPlayers.push(resolved);
      }

      const resolvedCaptain = captain
        ? (await discordBot.resolveSubmittedPlayer(captain, guild, activeTeams)) || resolvedPlayers[0]
        : resolvedPlayers[0];

      const captainId = discordBot.normalizeMemberId(resolvedCaptain?.id || resolvedPlayers[0]?.id);

      const validation = discordBot.validateTeamRegistrationRoster({
        teamName: cleanedName,
        captainId,
        players: resolvedPlayers,
        config,
        existingTeams: activeTeams
      });

      if (!validation.valid) {
        return {
          status: 400,
          body: {
            success: false,
            code: validation.code || 'REGISTRATION_REJECTED',
            error: (validation.error || 'Tagcheck Failed! Registration validation rejected this roster.').replace(/\*\*/g, '')
          }
        };
      }

      const allMemberIds = Array.from(
        new Set([captainId, ...resolvedPlayers.map(p => discordBot.normalizeMemberId(p.id))].filter(Boolean))
      );
      discordBot.markMembersInFlight(allMemberIds, true);

      try {
        const currentConfirmed = activeTeams.filter(t => !t.isWaitlist);
        const currentWaitlist = activeTeams.filter(t => t.isWaitlist);
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

        const assignedGroup = isWaitlist ? undefined : discordBot.calculateGroupForSlot(slotNumber, config);

        const cleanCaptain = {
          id: resolvedCaptain.id,
          username: resolvedCaptain.username,
          displayName: resolvedCaptain.displayName,
          avatar: resolvedCaptain.avatar
        };
        const cleanPlayers = resolvedPlayers.map(({ isBot, ...rest }) => rest);

        const newTeam: TeamRegistration = {
          id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tournamentId: config.id || undefined,
          slotNumber,
          teamName: cleanedName,
          captain: cleanCaptain,
          players: cleanPlayers,
          registeredAt: new Date().toISOString(),
          messageId: messageId || `msg-${Date.now()}`,
          channelId: channelId || config.regChannelId || config.regChannel,
          isWaitlist,
          group: isWaitlist ? undefined : assignedGroup,
          teamRoleName: cleanedName,
          teamCategoryName: 'Team Voice Lobbies',
          teamVoiceChannelName: cleanedName,
          whatsappNumber1: cleanWa1,
          region: region as TournamentRegion
        };

        registeredTeams.push(newTeam);
        registeredTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));
        saveTournamentState();

        if (guild) {
          await discordBot.syncTeamRolesForRegistration(guild, newTeam, config).catch(() => {});
        }
        await discordBot.syncGuildChannels(config, guild).catch(() => {});

        const newConfirmedCount = discordBot.getTeamsForTournament(config).filter(t => !t.isWaitlist).length;

        return {
          status: 200,
          body: {
            success: true,
            team: newTeam,
            isWaitlist,
            slotNumber,
            autoClosed: false,
            remainingSlots: Math.max(0, config.totalSlots - newConfirmedCount)
          }
        };
      } finally {
        discordBot.markMembersInFlight(allMemberIds, false);
      }
    });

    return res.status(result.status).json(result.body);
  });

  app.post('/api/teams/kick', async (req: Request, res: Response) => {
    const { teamId, guildId } = req.body;
    const targetTeam = registeredTeams.find(t => t.id === teamId);
    if (!targetTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();

    const targetTourney =
      (targetTeam.tournamentId && config.tournaments?.[targetTeam.tournamentId]) || config;

    const result = await discordBot.deleteSlot(targetTeam.slotNumber, guild, {
      teamId: targetTeam.id,
      isWaitlist: targetTeam.isWaitlist,
      tournamentConfig: targetTourney
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to remove team slot' });
    }

    res.json({
      success: true,
      kickedTeam: result.deletedTeam,
      promotedTeam: result.promotedTeam,
      syncWarnings: result.syncWarnings || [],
      teams: discordBot.getTeamsForTournament(config)
    });
  });

  app.post('/api/teams/reset', async (_req: Request, res: Response) => {
    await discordBot.withOperationLock(async () => {
      const client = (discordBot as any).client;
      const guild = client?.guilds?.cache?.first();
      const activeTeams = discordBot.getTeamsForTournament(config);
      if (guild) {
        const verifiedRoleName = config.verifiedRoleName || 'Verified Team';
        const slotRoleName = config.roleName || 'Confirmed Slot';
        const verifiedRole =
          (config.verifiedRoleId ? guild.roles.cache.get(config.verifiedRoleId) : undefined) ||
          guild.roles.cache.find((r: any) => r.name.toLowerCase() === verifiedRoleName.toLowerCase());
        const slotRole =
          (config.slotRoleId ? guild.roles.cache.get(config.slotRoleId) : undefined) ||
          guild.roles.cache.find((r: any) => r.name.toLowerCase() === slotRoleName.toLowerCase());
        const managedRoles = [verifiedRole, slotRole].filter(Boolean);

        for (const t of activeTeams) {
          if (managedRoles.length > 0) {
            for (const uid of discordBot.getTeamMemberIds(t)) {
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
          await discordBot.cleanupTeamWorkspace(guild, t).catch(() => {});
        }
      }
      const activeIds = new Set(activeTeams.map(t => t.id));
      for (let i = registeredTeams.length - 1; i >= 0; i--) {
        if (activeIds.has(registeredTeams[i].id)) {
          registeredTeams.splice(i, 1);
        }
      }
      config.status = 'open';
      saveTournamentState();
      await discordBot.syncGuildChannels(config, guild).catch(() => {});
    });
    res.json({ success: true, message: 'All registrations and slots reset successfully.' });
  });

  app.post('/api/idp', async (req: Request, res: Response) => {
    const { roomId, roomPass, mapName, matchTime, serverType } = req.body;
    if (!roomId || !roomPass) {
      return res.status(400).json({ error: 'Room ID and Password are required' });
    }

    lastRoomDispatch = {
      roomId: String(roomId).trim(),
      roomPass: String(roomPass).trim(),
      mapName: mapName || 'Main Lobby',
      matchTime: matchTime || 'TBD',
      serverType: serverType || 'Custom Room #1',
      sentAt: new Date().toISOString()
    };

    const pubResult = await discordBot.dispatchIdp(lastRoomDispatch, config);

    res.json({
      success: pubResult.success,
      dispatch: lastRoomDispatch,
      recipientCount: registeredTeams.filter(t => !t.isWaitlist).length,
      publishedCount: pubResult.sentCount,
      targetChannels: pubResult.targetChannels,
      publicationFailures: pubResult.failedGuilds
    });
  });

  app.get('/api/idp', (_req: Request, res: Response) => {
    res.json({ dispatch: lastRoomDispatch });
  });

  app.get('/api/bot/status', (_req: Request, res: Response) => {
    res.json(discordBot.getStatus());
  });

  app.post('/api/bot/start', async (req: Request, res: Response) => {
    const tokenToUse = (req.body?.token && String(req.body.token).trim()) || getConfiguredToken();
    if (!tokenToUse) {
      return res.status(400).json({
        success: false,
        error: 'Bot token is required. Set DISCORD_TOKEN in your .env/environment or enter a token in the dashboard.'
      });
    }
    const result = await discordBot.start(tokenToUse);
    res.json(result);
  });

  app.post('/api/bot/connect', async (req: Request, res: Response) => {
    const tokenToUse = (req.body?.token && String(req.body.token).trim()) || getConfiguredToken();
    if (!tokenToUse) {
      return res.status(400).json({
        success: false,
        error: 'Bot token is required. Set DISCORD_TOKEN in your .env/environment or enter a token in the dashboard.'
      });
    }
    const result = await discordBot.start(tokenToUse);
    res.json(result);
  });

  app.post('/api/bot/stop', async (_req: Request, res: Response) => {
    await discordBot.stop();
    res.json({ success: true, status: discordBot.getStatus() });
  });

  app.post('/api/bot/auto-setup', async (req: Request, res: Response) => {
    const { guildId } = req.body;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'guildId is required' });
    }
    const result = await discordBot.setupGuild(guildId);
    res.json(result);
  });

  app.post('/api/bot/tournament-setup', async (req: Request, res: Response) => {
    const { guildId, title, slots, tags, groups, teamsPerGroup, verifiedRoleName } = req.body;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'guildId is required' });
    }

    const client = (discordBot as any).client;
    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Discord server not found or bot lacks access' });
    }

    const parsedSlots = Math.max(2, Math.min(500, parseInt(slots, 10) || config.totalSlots || 20));
    const parsedTeamsPerGroup = parseInt(teamsPerGroup || groups, 10) || config.teamsPerGroup || parsedSlots;

    const result = await discordBot.createTournament(guild, {
      title,
      slots: parsedSlots,
      tags: parseInt(tags, 10) || config.requiredTags,
      teamsPerGroup: parsedTeamsPerGroup,
      verifiedRoleName: verifiedRoleName || 'Verified Team',
      createdBy: 'Web Dashboard'
    });

    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/stop-registration', async (req: Request, res: Response) => {
    const { guildId, reason } = req.body || {};
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : undefined;
    const result = await discordBot.stopRegistration(guild, reason, 'Web Dashboard');
    saveTournamentState();
    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/sync-commands', async (_req: Request, res: Response) => {
    const result = await discordBot.registerSlashCommands();
    res.json(result);
  });

  app.post('/api/bot/delete-slot', async (req: Request, res: Response) => {
    const { slot, guildId } = req.body;
    const slotNum = parseInt(slot, 10);
    if (isNaN(slotNum)) {
      return res.status(400).json({ success: false, error: 'Valid slot number is required' });
    }

    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();
    const result = await discordBot.deleteSlot(slotNum, guild);

    res.json({
      ...result,
      teams: registeredTeams
    });
  });

  app.post('/api/bot/delete-tournament', async (req: Request, res: Response) => {
    const { guildId, deleteChannels, preview } = req.body;
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();

    if (preview) {
      const previewData = await discordBot.previewDeleteTournament(guild, deleteChannels !== false);
      return res.json({
        success: true,
        preview: previewData
      });
    }

    const result = await discordBot.deleteTournament(guild, deleteChannels !== false);

    res.json({
      ...result,
      config,
      teams: registeredTeams
    });
  });

  app.get('/api/bot/channels', (_req: Request, res: Response) => {
    try {
      const channels = discordBot.getAvailableTextChannels();
      res.json({ success: true, channels });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message, channels: [] });
    }
  });

  app.post('/api/bot/send-custom-embed', async (req: Request, res: Response) => {
    try {
      const { channelId, guildId, content, embed, tournamentId } = req.body;
      if (!embed || (!embed.title && !embed.description && (!embed.fields || embed.fields.length === 0))) {
        return res.status(400).json({ success: false, error: 'Embed must contain at least a title, description, or fields.' });
      }

      const result = await discordBot.sendCustomEmbed({
        channelId,
        guildId,
        content,
        embed,
        tournamentId
      });

      if (result.success) {
        saveTournamentState();
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Server error while sending embed' });
    }
  });

  app.post('/api/teams/swap', async (req: Request, res: Response) => {
    const { slot1, slot2, guildId } = req.body;
    const s1 = parseInt(slot1, 10);
    const s2 = parseInt(slot2, 10);
    if (isNaN(s1) || isNaN(s2)) {
      return res.status(400).json({ success: false, error: 'Valid slot1 and slot2 numbers are required' });
    }
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();
    const result = await discordBot.swapSlots(s1, s2, guild);
    res.json({
      ...result,
      teams: registeredTeams
    });
  });

  app.get('/api/blacklist', (_req: Request, res: Response) => {
    res.json({ blacklist: discordBot.getBlacklist() });
  });

  app.post('/api/blacklist/add', (req: Request, res: Response) => {
    const { userId, username, reason, addedBy } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    const entry = discordBot.addToBlacklist(userId, username || userId, reason || 'Rule violation', addedBy || 'Admin');
    res.json({ success: true, entry, blacklist: discordBot.getBlacklist() });
  });

  app.post('/api/blacklist/remove', (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    const removed = discordBot.removeFromBlacklist(userId);
    res.json({ success: removed, blacklist: discordBot.getBlacklist() });
  });

  app.get('/api/export/csv', (_req: Request, res: Response) => {
    const csv = discordBot.generateRosterExport('csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="scrim_rosters.csv"');
    res.send(csv);
  });

  const distPath = path.resolve(__dirname, 'dist');
  const distIndexHtml = path.resolve(distPath, 'index.html');
  const isDevMode = process.env.NODE_ENV === 'development';
  const hasDist = fs.existsSync(distIndexHtml);
  const useStaticBuild = hasDist && !isDevMode;

  if (!useStaticBuild) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn('[Server] Vite middleware unavailable, falling back to static asset serving:', viteErr);
      app.use(express.static(distPath));
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      res.sendFile(distIndexHtml);
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`FFA | Glacier Cup Manager™ server running on http://${HOST}:${PORT}`);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.warn(`[Server] Port ${PORT} is unavailable (${err.code}). Retrying on an available port so Discord bot stays online...`);
      httpServer.listen(0, HOST, () => {
        const addr = httpServer.address();
        const fallbackPort = typeof addr === 'object' && addr ? addr.port : 'random';
        console.log(`FFA | Glacier Cup Manager™ server running on fallback http://${HOST}:${fallbackPort}`);
      });
      return;
    }
    console.error(`[Server] HTTP server error on ${HOST}:${PORT}:`, err.message);
  });

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] Received ${signal}. Saving tournament state and shutting down gracefully...`);
    try {
      saveTournamentState();
      await discordBot.stop();
    } catch (err) {
      console.error('[Server] Error during shutdown cleanup:', err);
    }
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
