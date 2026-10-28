import { DiscordEmbed, DiscordUser, TeamRegistration, TournamentConfig, RoomCredentials } from '../types/tournament';

export interface ParseResult {
  teamName: string;
  detectedPlayers: DiscordUser[];
  unresolvedTags: string[];
  malformedIds: string[];
  rawIdsWhenDisabled: string[];
  convertedContent: string;
  easyTagCount: number;
}

export interface ValidationResult {
  valid: boolean;
  code?: string;
  error?: string;
  isWaitlist?: boolean;
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
  if (/[",\r\n;]/.test(sanitized) || sanitized.trim() !== sanitized) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export const VALID_TOURNAMENT_REGIONS = ['India', 'Bangladesh', 'Pakistan'] as const;

export function getRegionCountryCode(region: 'India' | 'Pakistan' | 'Bangladesh' = 'India'): string {
  if (region === 'Bangladesh') return '+880';
  if (region === 'Pakistan') return '+92';
  return '+91';
}

export function sanitizeWhatsAppNumber(
  phone: string,
  region: 'India' | 'Pakistan' | 'Bangladesh' = 'India'
): string {
  const code = getRegionCountryCode(region);
  const clean = (phone || '').trim().replace(/[\s\-()]/g, '');
  if (!clean) return '';
  if (!clean.startsWith('+')) {
    const codeDigits = code.slice(1);
    if (clean.startsWith(codeDigits) && clean.length > codeDigits.length + 6) {
      return `+${clean}`;
    }
    return `${code}${clean.replace(/^0+/, '')}`;
  }
  return clean;
}

export function isValidWhatsAppNumber(
  phone: string,
  region: 'India' | 'Pakistan' | 'Bangladesh' = 'India'
): boolean {
  const normalized = sanitizeWhatsAppNumber(phone, region);
  const code = getRegionCountryCode(region);
  if (!normalized || normalized === code) return false;
  return /^\+[1-9]\d{8,14}$/.test(normalized);
}

export function isValidTournamentRegion(region: string): boolean {
  return (VALID_TOURNAMENT_REGIONS as readonly string[]).includes(region);
}

export function sortTeamsConsistently(teams: TeamRegistration[]): TeamRegistration[] {
  return [...teams].sort((a, b) => {
    if (a.isWaitlist !== b.isWaitlist) {
      return a.isWaitlist ? 1 : -1;
    }
    return a.slotNumber - b.slotNumber;
  });
}

export function formatTeamsAsCsv(teams: TeamRegistration[], includeWaitlist: boolean = true): string {
  const sorted = sortTeamsConsistently(teams).filter(t => includeWaitlist || !t.isWaitlist);
  const header = 'Slot,Group,Region,Status,Team Name,Captain,Captain ID,WhatsApp Number,Players,Player IDs,Registered At';
  if (sorted.length === 0) return header;

  const rows = sorted.map(t => {
    const statusLabel = t.isWaitlist ? `Waitlist #${t.slotNumber}` : 'Confirmed';
    const groupLabel = t.isWaitlist ? 'Waitlist' : (t.group || 'Group A');
    const regionLabel = t.region || 'India';
    const playerNames = (t.players || []).map(p => `@${p.displayName || p.username}`).join('; ');
    const playerIds = (t.players || []).map(p => p.id).join('; ');
    return [
      t.slotNumber,
      escapeCsvField(groupLabel),
      escapeCsvField(regionLabel),
      escapeCsvField(statusLabel),
      escapeCsvField(t.teamName),
      escapeCsvField(`@${t.captain?.displayName || t.captain?.username || 'Unknown'}`),
      escapeCsvField(t.captain?.id || ''),
      escapeCsvField(t.whatsappNumber1 || ''),
      escapeCsvField(playerNames),
      escapeCsvField(playerIds),
      escapeCsvField(t.registeredAt)
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

export function parseRegistrationMessage(
  rawContent: string,
  directory: DiscordUser[],
  easyTagEnabled: boolean = true
): ParseResult {
  let text = rawContent.trim();
  let easyTagCount = 0;
  const detectedPlayers: DiscordUser[] = [];
  const unresolvedTags: string[] = [];
  const malformedIds: string[] = [];
  const rawIdsWhenDisabled: string[] = [];

  const bodyWithoutTeamLine = text.replace(/^(?:team\s*name|teamname|team|t\.n\.?|tn)\s*[:=-]?[^\n\r]*/im, '');

  const numericTokensRegex = /(?:^|[\s,:])(\d{6,25})(?=$|\s|[^\w>])/g;
  let numMatch;
  while ((numMatch = numericTokensRegex.exec(bodyWithoutTeamLine)) !== null) {
    const candidate = numMatch[1];
    if (candidate.length < 17 || candidate.length > 20) {
      if (!malformedIds.includes(candidate)) {
        malformedIds.push(candidate);
      }
    } else if (!isValidDiscordSnowflake(candidate)) {
      if (!malformedIds.includes(candidate)) {
        malformedIds.push(candidate);
      }
    } else if (!easyTagEnabled) {
      if (!rawIdsWhenDisabled.includes(candidate)) {
        rawIdsWhenDisabled.push(candidate);
      }
    }
  }

  if (easyTagEnabled) {
    const rawIdRegex = /(^|[\s,:])(\d{17,20})(?=$|\s|[^\w>])/g;
    text = text.replace(rawIdRegex, (match, prefix, id) => {
      if (!isValidDiscordSnowflake(id)) {
        if (!malformedIds.includes(id)) malformedIds.push(id);
        return match;
      }
      const user = directory.find(u => u.id === id);
      if (user) {
        easyTagCount++;
        return `${prefix}<@${user.id}>`;
      } else {
        if (!unresolvedTags.includes(`ID:${id}`)) {
          unresolvedTags.push(`ID:${id}`);
        }
        return match;
      }
    });
  }

  let teamName = '';
  const teamNamePatterns = [
    /(?:team\s*name|teamname|team\s*:?|t\.n\.?)\s*[:=-]\s*([^\n\r]+)/i,
    /^team\s+([^\n\r]+)/im,
    /^tn\s*[:=-]\s*([^\n\r]+)/im
  ];

  for (const regex of teamNamePatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      teamName = match[1].replace(/<@!?\d+>/g, '').replace(/@[\w.]+/g, '').replace(/^<\s*|\s*>$/g, '').trim();
      break;
    }
  }

  if (!teamName) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && !lines[0].includes('@') && !lines[0].match(/\d{6,25}/)) {
      teamName = lines[0].replace(/^(team\s*[:=-]?\s*)/i, '').replace(/^<\s*|\s*>$/g, '').trim();
    }
  }

  const mentionRegex = /<@!?(\d+)>/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const userId = match[1];
    if (!isValidDiscordSnowflake(userId)) {
      if (!malformedIds.includes(`<@${userId}>`)) {
        malformedIds.push(`<@${userId}>`);
      }
      continue;
    }
    const user = directory.find(u => u.id === userId);
    if (user) {
      if (!detectedPlayers.some(p => p.id === user.id)) {
        detectedPlayers.push(user);
      }
    } else {
      const label = `ID:${userId}`;
      if (!unresolvedTags.includes(label)) {
        unresolvedTags.push(label);
      }
    }
  }

  const textWithoutIdMentions = text
    .replace(/<@!?\d+>/g, ' ')
    .replace(/<@&\d+>/g, ' ')
    .replace(/<#\d+>/g, ' ');

  const usernameRegex = /@([a-zA-Z0-9_.-]+)/g;
  while ((match = usernameRegex.exec(textWithoutIdMentions)) !== null) {
    const nameQuery = match[1].toLowerCase();
    if (nameQuery === 'here' || nameQuery === 'everyone') continue;
    const user = directory.find(
      u => u.username.toLowerCase() === nameQuery || u.displayName.toLowerCase() === nameQuery
    );
    if (user) {
      if (!detectedPlayers.some(p => p.id === user.id)) {
        detectedPlayers.push(user);
      }
    } else {
      if (!unresolvedTags.includes(`@${match[1]}`)) {
        unresolvedTags.push(`@${match[1]}`);
      }
    }
  }

  return {
    teamName,
    detectedPlayers,
    unresolvedTags,
    malformedIds,
    rawIdsWhenDisabled,
    convertedContent: text,
    easyTagCount
  };
}

export function normalizeDiscordUserId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const mentionMatch = str.match(/^<@!?(\d{15,22})>$/);
  if (mentionMatch) return mentionMatch[1];
  const rawIdMatch = str.match(/^@?(\d{15,22})$/);
  if (rawIdMatch) return rawIdMatch[1];
  return str.replace(/^[<@!]+|[>]+$/g, '').trim().toLowerCase();
}

export function getTeamMemberIds(team: Pick<TeamRegistration, 'captain' | 'players'>): Set<string> {
  const ids = new Set<string>();
  const captainId = normalizeDiscordUserId(team?.captain?.id);
  if (captainId) ids.add(captainId);
  if (Array.isArray(team?.players)) {
    for (const p of team.players) {
      const pid = normalizeDiscordUserId(p?.id);
      if (pid) ids.add(pid);
    }
  }
  return ids;
}

export function validateRegistration(
  teamName: string,
  players: DiscordUser[],
  config: TournamentConfig,
  existingTeams: TeamRegistration[],
  parseDiagnostics?: {
    unresolvedTags?: string[];
    malformedIds?: string[];
    rawIdsWhenDisabled?: string[];
  },
  captainUser?: DiscordUser
): ValidationResult {
  if (!config.title || config.totalSlots <= 0) {
    return {
      valid: false,
      code: 'NO_TOURNAMENT_CREATED',
      error: 'No tournament is currently active! An administrator must run `/setup` or `/create tournament` first.'
    };
  }

  if (config.status === 'closed') {
    return {
      valid: false,
      code: 'REGISTRATION_CLOSED',
      error: 'Registrations are currently closed! Please wait for tournament moderators to open the channel.'
    };
  }

  if (config.status === 'paused') {
    return {
      valid: false,
      code: 'REGISTRATION_PAUSED',
      error: 'Registrations are temporarily paused by staff. Try again shortly.'
    };
  }

  const cleanTeam = (teamName || '').replace(/^<\s*|\s*>$/g, '').trim();
  const lowerTeam = cleanTeam.toLowerCase();
  const reservedNames = new Set([
    'team name',
    'your team',
    'your team name',
    'everyone',
    'here',
    '@everyone',
    '@here',
    'ffa bot manager',
    'verified team',
    'confirmed slot',
    (config.managerRoleName || 'FFA Bot Manager').trim().toLowerCase(),
    (config.verifiedRoleName || 'Verified Team').trim().toLowerCase(),
    (config.roleName || 'Confirmed Slot').trim().toLowerCase()
  ]);

  if (!cleanTeam || cleanTeam.length < 2 || reservedNames.has(lowerTeam)) {
    return {
      valid: false,
      code: 'INVALID_TEAM_NAME',
      error: 'Invalid Team Name! Please provide a valid, non-reserved squad name (e.g. `Team Name: Team Glacier`).'
    };
  }

  if (parseDiagnostics?.rawIdsWhenDisabled && parseDiagnostics.rawIdsWhenDisabled.length > 0) {
    return {
      valid: false,
      code: 'EASYTAG_DISABLED',
      error: `EasyTag Failed! Raw Discord ID(s) detected (${parseDiagnostics.rawIdsWhenDisabled.map(id => `\`${id}\``).join(', ')}), but EasyTag is currently **DISABLED**. Please use standard \`@username\` mentions.`
    };
  }

  if (parseDiagnostics?.malformedIds && parseDiagnostics.malformedIds.length > 0) {
    return {
      valid: false,
      code: 'MALFORMED_DISCORD_ID',
      error: `EasyTag Failed! Malformed Discord ID(s) detected: ${parseDiagnostics.malformedIds.map(id => `\`${id}\``).join(', ')}. Valid Discord User IDs must be 17–20 digit snowflakes.`
    };
  }

  if (parseDiagnostics?.unresolvedTags && parseDiagnostics.unresolvedTags.length > 0) {
    return {
      valid: false,
      code: 'UNRESOLVED_DISCORD_ID',
      error: `EasyTag Failed! Could not resolve member(s) in this server: ${parseDiagnostics.unresolvedTags.map(t => `\`${t}\``).join(', ')}. Ensure all tagged players have joined the Discord server.`
    };
  }

  const confirmedTeams = existingTeams.filter(t => !t.isWaitlist);

  if (players.length < config.requiredTags) {
    return {
      valid: false,
      code: 'INSUFFICIENT_TAGS',
      error: `Tagcheck Failed! Minimum **${config.requiredTags} tags** required for ${config.format}. You provided **${players.length}/${config.requiredTags}** valid player mentions.`
    };
  }

  if (players.length > config.maxTags) {
    return {
      valid: false,
      code: 'EXCESSIVE_TAGS',
      error: `Tagcheck Failed! Maximum **${config.maxTags} tags** allowed. You provided **${players.length}** tags.`
    };
  }

  if (config.disallowBots) {
    const botPlayer = players.find(p => p.isBot);
    if (botPlayer) {
      return {
        valid: false,
        code: 'BOT_TAGGED',
        error: `Tagcheck Failed! Bot @${botPlayer.displayName} was tagged. Discord bots cannot be registered as tournament players.`
      };
    }
  }

  // Always enforce intra-team duplicate member ID check
  const normalizedPlayerIds = players.map(p => normalizeDiscordUserId(p.id)).filter(Boolean);
  const uniquePlayerIds = new Set(normalizedPlayerIds);
  if (uniquePlayerIds.size !== normalizedPlayerIds.length) {
    return {
      valid: false,
      code: 'SELF_DUPLICATION',
      error: 'Tagcheck Failed! Duplicate member IDs detected within the same team roster. Every player on a team must be a unique Discord member.'
    };
  }

  const duplicateTeamName = existingTeams.find(
    t => t.teamName.trim().toLowerCase() === lowerTeam
  );
  if (duplicateTeamName) {
    return {
      valid: false,
      code: 'DUPLICATE_TEAM_NAME',
      error: `Tagcheck Failed! A team named **${duplicateTeamName.teamName}** is already registered in ${duplicateTeamName.isWaitlist ? `Waitlist #${duplicateTeamName.slotNumber}` : `Slot #${duplicateTeamName.slotNumber}`}.`
    };
  }

  // Always enforce cross-team duplicate member ID check (captain + all players across confirmed + waitlisted teams)
  const effectiveCaptain = captainUser || players[0];
  const captainId = normalizeDiscordUserId(effectiveCaptain?.id);
  const allSubmittedMembers: { id: string; label: string; isCaptain: boolean }[] = [];

  if (captainId) {
    allSubmittedMembers.push({
      id: captainId,
      label: effectiveCaptain?.displayName || effectiveCaptain?.username || captainId,
      isCaptain: true
    });
  }

  for (const p of players) {
    const pid = normalizeDiscordUserId(p.id);
    if (pid && !allSubmittedMembers.some(m => m.id === pid)) {
      allSubmittedMembers.push({
        id: pid,
        label: p.displayName || p.username || pid,
        isCaptain: pid === captainId
      });
    }
  }

  for (const submitted of allSubmittedMembers) {
    for (const existingTeam of existingTeams) {
      const existingMemberIds = getTeamMemberIds(existingTeam);
      if (existingMemberIds.has(submitted.id)) {
        const existingSlotDesc = existingTeam.isWaitlist
          ? `Waitlist #${existingTeam.slotNumber}`
          : `Slot #${existingTeam.slotNumber}${existingTeam.group ? ` (${existingTeam.group})` : ''}`;
        const existingRole = normalizeDiscordUserId(existingTeam.captain?.id) === submitted.id ? 'captain' : 'player';
        return {
          valid: false,
          code: 'CROSS_TEAM_DUPLICATE',
          error: `Tagcheck Failed! Member **@${submitted.label}** (\`${submitted.id}\`) is already registered as ${existingRole} in **${existingTeam.teamName}** (${existingSlotDesc}). A member can belong to only one team until their existing registration is deleted.`
        };
      }
    }
  }

  const isWaitlist = confirmedTeams.length >= config.totalSlots;
  return {
    valid: true,
    isWaitlist
  };
}

export function buildSuccessEmbed(
  team: TeamRegistration,
  config: TournamentConfig,
  remainingSlots: number
): DiscordEmbed {
  const isWaitlist = team.isWaitlist;
  const playerList = team.players
    .map((p, idx) => `> \`${idx + 1}.\` <@${p.id}> - ${p.displayName}`)
    .join('\n');

  const slotDisplay = isWaitlist
    ? `\`#WL-${team.slotNumber}\``
    : team.group
    ? `\`Slot #${team.slotNumber}\` (${team.group})`
    : `\`Slot #${team.slotNumber}\``;

  const teamRoleLabel = team.teamRoleName || team.teamName;
  const teamCategoryLabel = team.teamCategoryName || team.teamName;
  const teamVcLabel = team.teamVoiceChannelName || team.teamName;

  return {
    title: isWaitlist ? '⏳ Team Added to Waiting List' : '✅ Tournament Registration Confirmed!',
    description: isWaitlist
      ? `**Team ${team.teamName}** has been allocated **Waitlist #${team.slotNumber}** because all regular slots are currently filled.`
      : `Congratulations! **${team.teamName}** has officially secured **Slot #${team.slotNumber}** ${team.group ? `(${team.group}) ` : ''}for **${config.title}**!`,
    color: isWaitlist ? '#F0B75A' : '#31D69A',
    author: {
      name: 'FFA | Glacier Cup Manager™',
      icon_url: '/assets/glacier-cup-logo.png'
    },
    fields: [
      { name: 'Team Name', value: `\`${team.teamName}\``, inline: true },
      { name: isWaitlist ? 'Waitlist Position' : 'Allocated Slot', value: slotDisplay, inline: true },
      { name: 'Remaining Slots', value: `\`${remainingSlots}/${config.totalSlots}\``, inline: true },
      { name: 'Region', value: `\`${team.region || 'India'}\``, inline: true },
      { name: 'Primary WhatsApp', value: team.whatsappNumber1 ? `\`${team.whatsappNumber1}\`` : '`Not provided`', inline: true },
      { name: 'Backup WhatsApp', value: team.whatsappNumber2 ? `\`${team.whatsappNumber2}\`` : '`Not provided`', inline: true },
      { name: 'Roster Tags', value: playerList, inline: false },
      {
        name: 'Team Role & Tourney Role',
        value: `\`@${teamRoleLabel}\` *(Tagged Players)* • \`@${config.verifiedRoleName || config.roleName}\``,
        inline: true
      },
      {
        name: 'Team Category & Private VC',
        value: `📁 \`${teamCategoryLabel}\` → 🔊 \`${teamVcLabel}\` *(Private)*`,
        inline: true
      },
      { name: 'Private Room', value: `Check \`#${config.idpChannel}\` with your @${config.verifiedRoleName || 'Verified Team'} role.`, inline: false }
    ],
    footer: {
      text: `FFA | Glacier Cup Manager™ • Registered by @${team.captain.displayName} • Team Category, Role & Private VC Created`
    },
    timestamp: new Date().toISOString(),
    voiceConnectTeamId: config.autoCreateTeamVoice !== false ? team.id : undefined,
    voiceConnectChannelName: config.autoCreateTeamVoice !== false ? teamVcLabel : undefined
  };
}

export function buildFailureEmbed(
  error: string,
  code: string,
  config: TournamentConfig,
  autoDeleteSeconds: number = 5
): DiscordEmbed {
  return {
    title: '❌ Registration Rejected',
    description: error,
    color: '#FF626C',
    author: {
      name: 'FFA | Glacier Cup Manager™ | Tagcheck Verification',
      icon_url: '/assets/glacier-cup-logo.png'
    },
    fields: [
      { name: 'Error Code', value: `\`${code}\``, inline: true },
      { name: 'Required Format', value: `\`${config.format}\` (Min ${config.requiredTags} Tags)`, inline: true },
      { name: 'Auto Deletion', value: `This alert and your message will auto-delete in ${autoDeleteSeconds}s.`, inline: false }
    ],
    footer: {
      text: 'FFA | Glacier Cup Manager™ EasyTag System • Refer to #rules-format for sample layout'
    },
    timestamp: new Date().toISOString()
  };
}

export function getGroupLetter(groupIndex: number): string {
  let label = '';
  let n = Math.max(0, groupIndex);
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function getSlotGroupName(slotNumber: number, config: Pick<TournamentConfig, 'totalSlots' | 'groupsCount' | 'teamsPerGroup'>): string {
  const totalSlots = Math.max(1, config.totalSlots || 20);
  const teamsPerGroup =
    config.teamsPerGroup && config.teamsPerGroup > 0
      ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
      : Math.ceil(totalSlots / Math.max(1, config.groupsCount || 1));
  const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));
  if (groupsCount <= 1) return 'Group A';
  const groupIdx = Math.min(groupsCount - 1, Math.max(0, Math.floor((slotNumber - 1) / teamsPerGroup)));
  return `Group ${getGroupLetter(groupIdx)}`;
}

export function formatTeamsGroupedByGroup(
  confirmedTeams: TeamRegistration[],
  config: TournamentConfig
): string {
  const confirmed = [...confirmedTeams].sort((a, b) => a.slotNumber - b.slotNumber);
  const totalSlots = Math.max(1, config.totalSlots || 20);
  const teamsPerGroup =
    config.teamsPerGroup && config.teamsPerGroup > 0
      ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
      : Math.ceil(totalSlots / Math.max(1, config.groupsCount || 1));
  const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));

  if (confirmed.length === 0) {
    return '**Group A**\n*No teams registered yet.*';
  }

  const sections: string[] = [];
  for (let g = 0; g < groupsCount; g++) {
    const groupLetter = getGroupLetter(g);
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

  return sections.length > 0 ? sections.join('\n\n') : '**Group A**\n*No teams registered yet.*';
}

export function buildSlotListEmbed(
  teams: TeamRegistration[],
  config: TournamentConfig
): DiscordEmbed {
  if (!config.title || config.totalSlots <= 0) {
    return {
      title: '🏆 No Active Tournament Created',
      description: 'No tournament has been created yet. Run `/setup` or `/create tournament` to configure slots, required tags, teams per group, and registration channels.',
      color: '#6685FF',
      footer: {
        text: 'FFA | Glacier Cup Manager™ • Waiting for tournament creation'
      },
      timestamp: new Date().toISOString()
    };
  }

  const sorted = sortTeamsConsistently(teams);
  const confirmed = sorted.filter(t => !t.isWaitlist);
  const waitlist = sorted.filter(t => t.isWaitlist);
  const teamsPerGroup =
    config.teamsPerGroup && config.teamsPerGroup > 0
      ? Math.min(config.totalSlots, Math.max(1, config.teamsPerGroup))
      : Math.ceil(config.totalSlots / Math.max(1, config.groupsCount || 1));
  const groupsCount = Math.max(1, Math.ceil(config.totalSlots / teamsPerGroup));

  let slotEntries = formatTeamsGroupedByGroup(confirmed, config);
  if (slotEntries.length > 3400) {
    slotEntries = slotEntries.slice(0, 3400) + '\n*...additional slots truncated for display...*';
  }

  let waitlistEntries = '';
  if (waitlist.length > 0) {
    waitlistEntries = waitlist
      .map(w => `\`WL #${w.slotNumber}\` **${w.teamName}** (<@${w.captain.id}>)`)
      .join('\n')
      .slice(0, 1000);
  } else {
    waitlistEntries = '*No teams on waiting list.*';
  }

  const filledCount = confirmed.length;
  const isFull = filledCount >= config.totalSlots;
  const gamePrefix = config.game ? `**Game:** ${config.game} | ` : '';
  const statusDisplay =
    config.status === 'open'
      ? isFull
        ? '🔴 FULL (Waitlist Open)'
        : '🟢 REGISTRATIONS OPEN'
      : config.status === 'paused'
      ? '⏸️ PAUSED'
      : '🔒 CLOSED (Run /start-registration to open)';

  return {
    title: `🏆 ${config.title} — Official Slot List`,
    description: `${gamePrefix}**Format:** ${config.format} (${config.requiredTags} Tags Required) | **Status:** ${statusDisplay}\n**Confirmed Teams:** ${filledCount}/${config.totalSlots} | **Teams Per Group:** ${teamsPerGroup} (${groupsCount} Group${groupsCount > 1 ? 's' : ''})\n\n${slotEntries}`,
    color: '#6685FF',
    fields: [
      {
        name: `⏳ Waiting List (${waitlist.length}/${config.waitlistSlots})`,
        value: waitlistEntries,
        inline: false
      }
    ],
    footer: {
      text: `Auto-updated by FFA | Glacier Cup Manager™ • Total Teams Registered: ${teams.length}`
    },
    timestamp: new Date().toISOString()
  };
}

export function buildIdpEmbed(
  creds: RoomCredentials,
  tournamentName: string
): DiscordEmbed {
  return {
    title: `🔑 Custom Match Room Details — ${creds.serverType}`,
    description: `Match room credentials for **${tournamentName}** have been published. Join the lobby immediately!`,
    color: '#31D69A',
    author: {
      name: 'FFA | Glacier Cup Manager™ | Room ID & Password Dispatcher',
      icon_url: '/assets/glacier-cup-logo.png'
    },
    fields: [
      { name: '🆔 Room ID', value: `\`${creds.roomId}\``, inline: true },
      { name: '🔒 Room Password', value: `\`${creds.roomPass}\``, inline: true },
      { name: '🗺️ Map', value: `\`${creds.mapName}\``, inline: true },
      { name: '⏰ Start Time', value: `\`${creds.matchTime}\``, inline: true },
      { name: '⚠️ Important Rules', value: '• Join only your allotted slot number in the lobby.\n• Outside players or untagged subs will be kicked.\n• Stream sniping results in tournament disqualification.', inline: false }
    ],
    footer: {
      text: 'FFA | Glacier Cup Manager™ Room Management • Strictly for Confirmed Scrims Role'
    },
    timestamp: creds.sentAt || new Date().toISOString()
  };
}
