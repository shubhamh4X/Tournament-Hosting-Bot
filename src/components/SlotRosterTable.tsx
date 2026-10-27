import React, { useState } from 'react';
import { TeamRegistration, TournamentConfig } from '../types/tournament';
import { formatTeamsAsCsv, sortTeamsConsistently, getGroupLetter } from '../utils/tagParser';
import { TeamRegistrationModal } from './TeamRegistrationModal';
import {
  Download,
  Copy,
  Trash2,
  Search,
  Users,
  Volume2,
  UserPlus,
  Phone,
  Globe2
} from 'lucide-react';

interface SlotRosterTableProps {
  teams: TeamRegistration[];
  config: TournamentConfig;
  onKickTeam: (teamId: string) => void;
  onClearAll: () => void;
  onRefreshTeams?: () => void;
  onConnectTeamVoice?: (team: TeamRegistration) => void;
}

export const SlotRosterTable: React.FC<SlotRosterTableProps> = ({
  teams,
  config,
  onKickTeam,
  onRefreshTeams,
  onConnectTeamVoice
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedDiscord, setCopiedDiscord] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);

  const sortedTeams = sortTeamsConsistently(teams);
  const confirmed = sortedTeams.filter(t => !t.isWaitlist);
  const waitlist = sortedTeams.filter(t => t.isWaitlist);
  const groupsCount = config.groupsCount || 1;

  const filteredTeams = sortedTeams.filter(t => {
    const matchesSearch =
      t.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.captain.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.region && t.region.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.whatsappNumber1 && t.whatsappNumber1.includes(searchQuery)) ||
      t.players.some(p => p.displayName.toLowerCase().includes(searchQuery.toLowerCase()));

    if (activeTab === 'confirmed') return matchesSearch && !t.isWaitlist;
    if (activeTab === 'waitlist') return matchesSearch && t.isWaitlist;
    if (activeTab.startsWith('group-')) {
      const targetGroup = activeTab.replace('group-', 'Group ');
      return matchesSearch && !t.isWaitlist && (t.group === targetGroup || (!t.group && targetGroup === 'Group A'));
    }
    return matchesSearch;
  });

  const handleExportCSV = () => {
    const csv = formatTeamsAsCsv(sortedTeams, true);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${(config.title || 'glacier_cup').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_slots.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyDiscordFormat = () => {
    const gamePrefix = config.game ? `**Game:** ${config.game} | ` : '';
    let discordText = `**🏆 ${config.title || 'Glacier Cup'} — Official Slot List**\n`;
    discordText += `${gamePrefix}**Format:** ${config.format} (Min ${config.requiredTags} Tags)\n`;
    discordText += `**Confirmed Teams (${confirmed.length}/${config.totalSlots}):**\n`;

    if (groupsCount > 1) {
      const slotsPerGroup =
        config.teamsPerGroup && config.teamsPerGroup > 0
          ? Math.min(config.totalSlots, Math.max(1, config.teamsPerGroup))
          : Math.ceil(config.totalSlots / groupsCount);
      for (let g = 0; g < groupsCount; g++) {
        const groupLetter = getGroupLetter(g);
        const startSlot = (g * slotsPerGroup) + 1;
        const endSlot = Math.min((g + 1) * slotsPerGroup, config.totalSlots);
        if (startSlot > config.totalSlots) break;

        discordText += `\n**━━━ 👥 Group ${groupLetter} (Slots ${startSlot}–${endSlot}) ━━━**\n`;
        for (let i = startSlot; i <= endSlot; i++) {
          const team = confirmed.find(t => t.slotNumber === i);
          if (team) {
            discordText += `\`[${i < 10 ? '0' + i : i}]\` **${team.teamName}** — <@${team.captain.id}>\n`;
          } else {
            discordText += `\`[${i < 10 ? '0' + i : i}]\` *— Reserved / Open Slot —*\n`;
          }
        }
      }
    } else {
      for (let i = 1; i <= config.totalSlots; i++) {
        const team = confirmed.find(t => t.slotNumber === i);
        if (team) {
          discordText += `\`[${i < 10 ? '0' + i : i}]\` **${team.teamName}** — <@${team.captain.id}>\n`;
        } else {
          discordText += `\`[${i < 10 ? '0' + i : i}]\` *— Open Slot —*\n`;
        }
      }
    }

    if (waitlist.length > 0) {
      discordText += `\n**⏳ Waiting List (${waitlist.length}/${config.waitlistSlots}):**\n`;
      waitlist.forEach(w => {
        discordText += `\`WL #${w.slotNumber}\` **${w.teamName}** (<@${w.captain.id}>)\n`;
      });
    }

    navigator.clipboard.writeText(discordText);
    setCopiedDiscord(true);
    setTimeout(() => setCopiedDiscord(false), 2000);
  };

  return (
    <div className="space-y-5 w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A]">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#F3F5F9] tracking-tight">
              Live Tournament Slot Roster
            </h2>
            <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded bg-[#191D25] text-[#A7C7FF] border border-[#292F3A]">
              {confirmed.length}/{config.totalSlots} Slots Occupied
            </span>
          </div>
          <p className="text-xs text-[#929BAA] mt-1">
            Real-time slots verified by FFA | Glacier Cup Manager™ Tagcheck. Kicking a confirmed team automatically promotes the top waitlist team.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="h-9 px-3.5 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register Team</span>
          </button>

          <button
            onClick={handleCopyDiscordFormat}
            className="h-9 px-3.5 rounded-md bg-[#191D25] hover:bg-[#222731] text-[#F3F5F9] border border-[#292F3A] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5 text-[#6685FF]" />
            <span>{copiedDiscord ? 'Copied to Clipboard!' : 'Copy Discord Format'}</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="h-9 px-3.5 rounded-md bg-[#191D25] hover:bg-[#222731] text-[#F3F5F9] border border-[#292F3A] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#31D69A]" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#101217] rounded-md border border-[#292F3A]">
          <button
            onClick={() => setActiveTab('all')}
            className={`h-7 px-3 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A]'
                : 'text-[#929BAA] hover:text-[#F3F5F9]'
            }`}
          >
            All Teams (<span className="font-mono tabular-nums">{teams.length}</span>)
          </button>

          {groupsCount > 1 ? (
            Array.from({ length: groupsCount }, (_, i) => {
              const gLetter = getGroupLetter(i);
              const gName = `Group ${gLetter}`;
              const gCount = confirmed.filter(t => t.group === gName || (!t.group && i === 0)).length;
              return (
                <button
                  key={gName}
                  onClick={() => setActiveTab(`group-${gLetter}`)}
                  className={`h-7 px-2.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === `group-${gLetter}`
                      ? 'bg-[#6685FF] text-[#F3F5F9]'
                      : 'text-[#929BAA] hover:text-[#F3F5F9]'
                  }`}
                >
                  Group {gLetter} (<span className="font-mono tabular-nums">{gCount}</span>)
                </button>
              );
            })
          ) : (
            <button
              onClick={() => setActiveTab('confirmed')}
              className={`h-7 px-3 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'confirmed'
                  ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A]'
                  : 'text-[#929BAA] hover:text-[#F3F5F9]'
              }`}
            >
              Confirmed Slots (<span className="font-mono tabular-nums">{confirmed.length}</span>)
            </button>
          )}

          <button
            onClick={() => setActiveTab('waitlist')}
            className={`h-7 px-3 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'waitlist'
                ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A]'
                : 'text-[#929BAA] hover:text-[#F3F5F9]'
            }`}
          >
            Waiting List (<span className="font-mono tabular-nums">{waitlist.length}</span>)
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-[#707A89] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search team or player..."
            className="w-full h-9 pl-8 pr-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[#292F3A] bg-[#14171D] overflow-hidden">
        {filteredTeams.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-lg bg-[#191D25] border border-[#292F3A] flex items-center justify-center mx-auto mb-3 text-[#707A89]">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-display text-sm font-bold text-[#F3F5F9]">
              No Teams Found
            </h3>
            <p className="text-xs text-[#929BAA] mt-1 max-w-sm mx-auto leading-relaxed">
              {searchQuery
                ? 'No registered team matches your search query.'
                : 'No teams have registered yet. Teams can register in the Discord #registration channel or via the live bot.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#101217] text-[11px] font-semibold text-[#929BAA] border-b border-[#292F3A]">
                <tr>
                  <th className="py-3 px-4 w-24">Slot</th>
                  <th className="py-3 px-4 w-28">Group</th>
                  <th className="py-3 px-4 w-28">Region</th>
                  <th className="py-3 px-4">Team Name</th>
                  <th className="py-3 px-4">Captain</th>
                  <th className="py-3 px-4">Contact (WhatsApp)</th>
                  <th className="py-3 px-4">Verified Roster Tags</th>
                  <th className="py-3 px-4">Team Role & Private VC</th>
                  <th className="py-3 px-4 w-28">Registered</th>
                  <th className="py-3 px-4 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292F3A]">
                {filteredTeams.map(team => (
                  <tr
                    key={team.id}
                    className="hover:bg-[#191D25]/70 transition-colors group"
                  >
                    <td className="py-3 px-4 whitespace-nowrap">
                      {team.isWaitlist ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-semibold bg-[#F0B75A]/10 text-[#F0B75A] border border-[#F0B75A]/30">
                          WL #{team.slotNumber}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-semibold bg-[#6685FF]/15 text-[#A7C7FF] border border-[#6685FF]/30">
                          Slot #{team.slotNumber < 10 ? `0${team.slotNumber}` : team.slotNumber}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                      {team.isWaitlist ? (
                        <span className="text-[#707A89]">—</span>
                      ) : (
                        <span className="text-[#929BAA] font-medium">
                          {team.group || 'Group A'}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#101319] border border-[#292F3A] text-[#F3F5F9]">
                        {team.region === 'Pakistan' ? '🇵🇰 Pakistan' : team.region === 'Bangladesh' ? '🇧🇩 Bangladesh' : '🇮🇳 India'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-[#F3F5F9] whitespace-nowrap">
                      {team.teamName}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <img
                          src={team.captain.avatar}
                          alt=""
                          className="w-5 h-5 rounded-full bg-[#191D25] border border-[#292F3A] shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <span className="text-xs font-medium text-[#F3F5F9]">
                          @{team.captain.displayName}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                        <span className="text-[#31D69A] flex items-center gap-1 font-medium">
                          <Phone className="w-2.5 h-2.5 shrink-0" />
                          {team.whatsappNumber1 || '—'}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5 max-w-md">
                        {team.players.map(player => (
                          <span
                            key={player.id}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#101319] text-[#929BAA] border border-[#292F3A]"
                            title={`ID: ${player.id}`}
                          >
                            @{player.displayName}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex flex-col gap-0.5 text-[11px] font-mono">
                          <span className="text-[#A7C7FF] font-semibold">
                            @{team.teamRoleName || team.teamName}
                          </span>
                          <span className="text-[#929BAA]">
                            📁 {team.teamCategoryName || team.teamName} · 🔊 {team.teamVoiceChannelName || team.teamName}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#248046]/15 border border-[#248046]/30 text-[#31D69A] text-[11px] font-mono shrink-0">
                          <Volume2 className="w-3 h-3" />
                          <span>VC Ready</span>
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-xs text-[#707A89] whitespace-nowrap font-mono tabular-nums">
                      {new Date(team.registeredAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => onKickTeam(team.id)}
                        className="h-7 px-2.5 rounded bg-[#FF626C]/10 hover:bg-[#FF626C]/20 text-[#FF626C] border border-[#FF626C]/30 text-[11px] font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer"
                        title="Disqualify/Kick Team (Frees slot and promotes next in waitlist)"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Disqualify</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TeamRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        config={config}
        existingTeams={teams}
        onSuccess={() => {
          if (onRefreshTeams) onRefreshTeams();
        }}
      />
    </div>
  );
};
