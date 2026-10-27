import React, { useState, useEffect } from 'react';
import { TournamentConfig, TeamRegistration } from '../types/tournament';
import {
  ShieldCheck,
  Zap,
  Users,
  RotateCcw,
  Save,
  CheckCircle2,
  Tag,
  Award
} from 'lucide-react';

interface TourneyConfigPanelProps {
  config: TournamentConfig;
  onSaveConfig: (updated: Partial<TournamentConfig> & { explicitStatusCommand?: boolean }) => void;
  registeredTeams: TeamRegistration[];
  onResetTeams: () => void;
}

export const TourneyConfigPanel: React.FC<TourneyConfigPanelProps> = ({
  config,
  onSaveConfig,
  registeredTeams,
  onResetTeams
}) => {
  const [formData, setFormData] = useState<TournamentConfig>({ ...config });
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      ...config
    }));
  }, [config]);

  const handleFormatChange = (newFormat: 'Squad' | 'Trio' | 'Duo' | 'Solo' | 'Custom') => {
    let reqTags = 4;
    if (newFormat === 'Squad') {
      reqTags = 4;
    } else if (newFormat === 'Trio') {
      reqTags = 3;
    } else if (newFormat === 'Duo') {
      reqTags = 2;
    } else if (newFormat === 'Solo') {
      reqTags = 1;
    }
    setFormData(prev => ({
      ...prev,
      format: newFormat,
      requiredTags: reqTags,
      maxTags: reqTags
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const confirmedCount = registeredTeams.filter(t => !t.isWaitlist).length;
  const waitlistCount = registeredTeams.filter(t => t.isWaitlist).length;

  return (
    <div className="space-y-6 w-full">
      <div className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#F3F5F9] tracking-tight">
              FFA | Glacier Cup Manager™ Engine Configuration
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase border ${
                formData.status === 'open'
                  ? 'bg-[#31D69A]/10 text-[#31D69A] border-[#31D69A]/30'
                  : formData.status === 'paused'
                  ? 'bg-[#F0B75A]/10 text-[#F0B75A] border-[#F0B75A]/30'
                  : 'bg-[#FF626C]/10 text-[#FF626C] border-[#FF626C]/30'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  formData.status === 'open'
                    ? 'bg-[#31D69A]'
                    : formData.status === 'paused'
                    ? 'bg-[#F0B75A]'
                    : 'bg-[#FF626C]'
                }`}
              />
              {formData.status}
            </span>
          </div>
          <p className="text-xs text-[#929BAA] mt-1">
            Configure tag-basis verification rules, slot allocations, EasyTag automation, and channel bindings.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#101217] rounded-md border border-[#292F3A] self-start md:self-auto">
          {(['open', 'paused', 'closed'] as const).map(st => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setFormData(prev => ({ ...prev, status: st }));
                onSaveConfig({ status: st, explicitStatusCommand: true });
                if (st === 'open') {
                  fetch('/api/bot/start-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {});
                } else if (st === 'paused') {
                  fetch('/api/bot/pause-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {});
                } else if (st === 'closed') {
                  fetch('/api/bot/stop-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {});
                }
              }}
              className={`h-7 px-3 rounded text-xs font-semibold capitalize transition-colors cursor-pointer ${
                formData.status === st
                  ? st === 'open'
                    ? 'bg-[#31D69A] text-[#0A0B0E]'
                    : st === 'paused'
                    ? 'bg-[#F0B75A] text-[#0A0B0E]'
                    : 'bg-[#FF626C] text-[#0A0B0E]'
                  : 'text-[#929BAA] hover:text-[#F3F5F9]'
              }`}
            >
              {st === 'open' ? 'Open (/start-registration)' : st === 'paused' ? 'Paused (/pause-registration)' : 'Closed (/stop-registration)'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
          <div className="flex items-center gap-2.5 border-b border-[#292F3A] pb-3.5">
            <Award className="w-4 h-4 text-[#6685FF]" />
            <h3 className="font-display text-base font-bold text-[#F3F5F9]">
              Tournament & Scrim Identity
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Tournament Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Glacier Cup Season 1"
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Game / Category (Optional)
              </label>
              <input
                type="text"
                value={formData.game}
                onChange={e => setFormData({ ...formData, game: e.target.value })}
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                placeholder="Optional game or event category"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Team Format
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['Squad', 'Trio', 'Duo', 'Solo'] as const).map(fmt => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleFormatChange(fmt)}
                    className={`h-9 px-3 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                      formData.format === fmt
                        ? 'bg-[#6685FF] border-[#6685FF] text-[#F3F5F9]'
                        : 'bg-[#191D25] border-[#292F3A] text-[#929BAA] hover:text-[#F3F5F9]'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Teams in Each Group (<span className="font-mono text-[#A7C7FF]">{Math.max(1, Math.ceil((formData.totalSlots || 20) / Math.max(1, formData.teamsPerGroup || formData.totalSlots || 20)))} Group(s)</span>)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={formData.teamsPerGroup || formData.totalSlots || 20}
                  onChange={e => {
                    const tpg = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 20));
                    const total = Math.max(2, formData.totalSlots || 20);
                    setFormData({
                      ...formData,
                      teamsPerGroup: tpg,
                      groupsCount: Math.max(1, Math.ceil(total / tpg))
                    });
                  }}
                  className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
                />
                {[12, 16, 20, 25].map(tpg => (
                  <button
                    key={tpg}
                    type="button"
                    onClick={() => {
                      const total = Math.max(2, formData.totalSlots || 20);
                      setFormData({
                        ...formData,
                        teamsPerGroup: tpg,
                        groupsCount: Math.max(1, Math.ceil(total / tpg))
                      });
                    }}
                    className={`h-9 px-2.5 text-xs font-mono font-semibold rounded-md border transition-colors cursor-pointer shrink-0 ${
                      (formData.teamsPerGroup || formData.totalSlots) === tpg
                        ? 'bg-[#6685FF] border-[#6685FF] text-[#F3F5F9]'
                        : 'bg-[#191D25] border-[#292F3A] text-[#929BAA] hover:text-[#F3F5F9]'
                    }`}
                  >
                    {tpg}/Grp
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Verified Team Role Name (Grants #id-pass)
              </label>
              <input
                type="text"
                value={formData.verifiedRoleName || 'Verified Team'}
                onChange={e => setFormData({ ...formData, verifiedRoleName: e.target.value })}
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                placeholder="Verified Team"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Tournament Category Name
              </label>
              <input
                type="text"
                value={formData.categoryName || `🏆 ┃ ${formData.title.toUpperCase()}`}
                onChange={e => setFormData({ ...formData, categoryName: e.target.value })}
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                placeholder="🏆 ┃ TOURNAMENTS"
              />
            </div>
          </div>
        </section>

        <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[#292F3A] pb-3.5">
            <Tag className="w-4 h-4 text-[#6685FF]" />
            <h3 className="font-display text-base font-bold text-[#F3F5F9]">
              Tagcheck Engine Rules (<code className="text-[#A7C7FF] font-mono text-sm">/tagcheck</code>)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-4 rounded-lg bg-[#191D25] border border-[#292F3A]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-[#F3F5F9]">
                  Minimum Required Tags
                </label>
                <span className="px-2 py-0.5 rounded bg-[#101319] border border-[#292F3A] font-mono tabular-nums text-xs font-bold text-[#A7C7FF]">
                  {formData.requiredTags}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="6"
                value={formData.requiredTags}
                onChange={e =>
                  setFormData({ ...formData, requiredTags: parseInt(e.target.value, 10) })
                }
                className="w-full accent-[#6685FF] cursor-pointer"
              />
              <p className="text-[11px] text-[#707A89] mt-1.5">
                Registration messages with fewer mentions will be rejected automatically.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-[#191D25] border border-[#292F3A]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-[#F3F5F9]">
                  Maximum Allowed Tags (Including Subs)
                </label>
                <span className="px-2 py-0.5 rounded bg-[#101319] border border-[#292F3A] font-mono tabular-nums text-xs font-bold text-[#A7C7FF]">
                  {formData.maxTags}
                </span>
              </div>
              <input
                type="range"
                min={formData.requiredTags}
                max="8"
                value={formData.maxTags}
                onChange={e =>
                  setFormData({ ...formData, maxTags: parseInt(e.target.value, 10) })
                }
                className="w-full accent-[#6685FF] cursor-pointer"
              />
              <p className="text-[11px] text-[#707A89] mt-1.5">
                Prevents mass tagging or registering oversize rosters.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <label className="flex items-start justify-between gap-4 p-4 rounded-lg bg-[#191D25] border border-[#292F3A] cursor-pointer hover:border-[#6685FF]/40 transition-colors">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-xs text-[#F3F5F9]">
                  <Zap className="w-3.5 h-3.5 text-[#F0B75A]" />
                  <span>EasyTag Feature (<code className="font-mono text-[#A7C7FF]">!eztag</code>)</span>
                </div>
                <p className="text-xs text-[#929BAA] mt-1 leading-relaxed">
                  Automatically converts pasted 18-digit Discord user IDs into pingable mentions, solving issues with complex fonts and symbols in usernames.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.easyTagEnabled}
                onChange={e => setFormData({ ...formData, easyTagEnabled: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-[#6685FF] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-lg bg-[#191D25] border border-[#292F3A] cursor-pointer hover:border-[#6685FF]/40 transition-colors">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-xs text-[#F3F5F9]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#31D69A]" />
                  <span>Cross-Team Anti-Duplicate Tag Check</span>
                </div>
                <p className="text-xs text-[#929BAA] mt-1 leading-relaxed">
                  Rejects registration if any tagged player is already registered in an earlier confirmed slot or waiting list.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.prohibitDuplicateTags}
                onChange={e => setFormData({ ...formData, prohibitDuplicateTags: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-[#6685FF] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-lg bg-[#191D25] border border-[#292F3A] cursor-pointer hover:border-[#6685FF]/40 transition-colors">
              <div>
                <div className="font-semibold text-xs text-[#F3F5F9]">
                  Prohibit Self-Duplication in Roster
                </div>
                <p className="text-xs text-[#929BAA] mt-1 leading-relaxed">
                  Prevents a captain from tagging themselves or another member multiple times to fake a full squad.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.prohibitSelfDuplication}
                onChange={e => setFormData({ ...formData, prohibitSelfDuplication: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-[#6685FF] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-lg bg-[#191D25] border border-[#292F3A] cursor-pointer hover:border-[#6685FF]/40 transition-colors">
              <div>
                <div className="font-semibold text-xs text-[#F3F5F9]">
                  Disallow Discord Bot Mentions
                </div>
                <p className="text-xs text-[#929BAA] mt-1 leading-relaxed">
                  Prevents participants from tagging bots to fulfill the required tag count.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.disallowBots}
                onChange={e => setFormData({ ...formData, disallowBots: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-[#6685FF] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-lg bg-[#191D25] border border-[#292F3A] cursor-pointer hover:border-[#6685FF]/40 transition-colors md:col-span-2">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-xs text-[#F3F5F9]">
                  <span>Auto-Create Team Category, Role & Private Voice Channel</span>
                </div>
                <p className="text-xs text-[#929BAA] mt-1 leading-relaxed">
                  After each team registration, automatically creates a new Discord category and role named after the team, creates their private voice channel under that category, and grants the team role to all players tagged during registration so only they can join.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.autoCreateTeamVoice !== false}
                onChange={e => setFormData({ ...formData, autoCreateTeamVoice: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-[#6685FF] cursor-pointer shrink-0"
              />
            </label>
          </div>
        </section>

        <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
          <div className="flex items-center gap-2.5 border-b border-[#292F3A] pb-3.5">
            <Users className="w-4 h-4 text-[#6685FF]" />
            <h3 className="font-display text-base font-bold text-[#F3F5F9]">
              Slot Allocation & Channel Timers
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Total Confirmed Slots (2–500)
              </label>
              <input
                type="number"
                min="2"
                max="500"
                value={formData.totalSlots}
                onChange={e => {
                  const total = Math.max(2, Math.min(500, parseInt(e.target.value, 10) || 20));
                  const tpg = formData.teamsPerGroup && formData.teamsPerGroup > 0 ? formData.teamsPerGroup : total;
                  setFormData({
                    ...formData,
                    totalSlots: total,
                    groupsCount: Math.max(1, Math.ceil(total / tpg))
                  });
                }}
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
              />
              <span className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1.5 block">
                Current occupied: {confirmedCount}/{formData.totalSlots}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Waiting List Slots
              </label>
              <input
                type="number"
                min="0"
                max="50"
                value={formData.waitlistSlots}
                onChange={e => setFormData({ ...formData, waitlistSlots: parseInt(e.target.value, 10) || 5 })}
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
              />
              <span className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1.5 block">
                Current waitlist: {waitlistCount}/{formData.waitlistSlots}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Auto-Delete Failed Message (Seconds)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={formData.autoDeleteSeconds}
                  onChange={e => setFormData({ ...formData, autoDeleteSeconds: parseInt(e.target.value, 10) || 5 })}
                  className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
                />
                <span className="text-xs text-[#707A89] font-mono whitespace-nowrap">sec</span>
              </div>
              <span className="text-[11px] text-[#707A89] mt-1.5 block">
                Cleans up invalid spam from #registration
              </span>
            </div>
          </div>
        </section>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Configuration</span>
            </button>

            {savedSuccess && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#31D69A]">
                <CheckCircle2 className="w-4 h-4" />
                <span>Settings saved successfully!</span>
              </span>
            )}
          </div>

          <div>
            {!showResetConfirm ? (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="h-9 px-3.5 rounded-md bg-[#FF626C]/10 hover:bg-[#FF626C]/20 text-[#FF626C] border border-[#FF626C]/30 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset All Slots & Registrations</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 p-2 bg-[#14171D] border border-[#FF626C]/50 rounded-md">
                <span className="text-xs text-[#F3F5F9] font-medium px-1.5">
                  Are you sure? This clears all {registeredTeams.length} registered teams.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onResetTeams();
                    setShowResetConfirm(false);
                  }}
                  className="h-7 px-2.5 rounded bg-[#FF626C] hover:bg-[#E5535D] text-[#0A0B0E] text-xs font-bold cursor-pointer"
                >
                  Yes, Clear All
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="h-7 px-2.5 rounded bg-[#191D25] border border-[#292F3A] text-[#929BAA] text-xs hover:text-[#F3F5F9] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
