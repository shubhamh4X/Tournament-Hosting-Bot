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
    <div className="space-y-10 w-full">
      <div className="p-5 sm:p-6 rounded-[24px] esports-card flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="eyebrow-label">
            Rulebook &amp; Verification Parameters
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Tournament Engine Configuration
            </h2>
            <span
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase border ${
                formData.status === 'open'
                  ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25'
                  : formData.status === 'paused'
                  ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25'
                  : 'bg-[#EF4444]/10 text-[#F87171] border-[#EF4444]/25'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  formData.status === 'open'
                    ? 'bg-[#10B981] shadow-[0_0_8px_#10B981]'
                    : formData.status === 'paused'
                    ? 'bg-[#F59E0B]'
                    : 'bg-[#EF4444]'
                }`}
              />
              {formData.status}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
            Configure tag-basis verification rules, slot allocations, EasyTag automation, and Discord channel bindings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white/[0.03] rounded-2xl border border-white/[0.08] self-start lg:self-auto">
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
              className={`h-9 px-4 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer ${
                formData.status === st
                  ? st === 'open'
                    ? 'bg-[#10B981] text-[#04130D] font-bold shadow-[0_4px_16px_rgba(16,185,129,0.35)]'
                    : st === 'paused'
                    ? 'bg-[#F59E0B] text-[#170E02] font-bold shadow-[0_4px_16px_rgba(245,158,11,0.35)]'
                    : 'bg-[#EF4444] text-white font-bold shadow-[0_4px_16px_rgba(239,68,68,0.35)]'
                  : 'text-white/55 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              {st === 'open' ? 'Open (/start-registration)' : st === 'paused' ? 'Paused (/pause-registration)' : 'Closed (/stop-registration)'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="p-5 sm:p-6 rounded-[24px] esports-card space-y-6">
          <div className="flex items-center gap-3.5 border-b border-white/[0.07] pb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#38BDF8] shrink-0">
              <Award className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Event Metadata
              </div>
              <h3 className="font-display text-lg sm:text-xl font-bold text-white">
                Tournament &amp; Scrim Identity
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Tournament Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Glacier Cup Season 1"
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Game / Category (Optional)
              </label>
              <input
                type="text"
                value={formData.game}
                onChange={e => setFormData({ ...formData, game: e.target.value })}
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                placeholder="Optional game or event category"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Team Format
              </label>
              <div className="grid grid-cols-4 gap-2.5">
                {(['Squad', 'Trio', 'Duo', 'Solo'] as const).map(fmt => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleFormatChange(fmt)}
                    className={`h-11 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      formData.format === fmt
                        ? 'btn-glacier-primary border-transparent text-white'
                        : 'bg-white/[0.02] border-white/[0.08] text-white/55 hover:text-white'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Teams in Each Group (<span className="font-mono text-[#38BDF8]">{Math.max(1, Math.ceil((formData.totalSlots || 20) / Math.max(1, formData.teamsPerGroup || formData.totalSlots || 20)))} Group(s)</span>)
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
                  className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
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
                    className={`h-11 px-3 text-xs font-mono font-semibold rounded-xl border transition-all cursor-pointer shrink-0 ${
                      (formData.teamsPerGroup || formData.totalSlots) === tpg
                        ? 'btn-glacier-primary border-transparent text-white'
                        : 'bg-white/[0.02] border-white/[0.08] text-white/55 hover:text-white'
                    }`}
                  >
                    {tpg}/Grp
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Verified Team Role Name (Grants #id-pass)
              </label>
              <input
                type="text"
                value={formData.verifiedRoleName || 'Verified Team'}
                onChange={e => setFormData({ ...formData, verifiedRoleName: e.target.value })}
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                placeholder="Verified Team"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Tournament Category Name
              </label>
              <input
                type="text"
                value={formData.categoryName || `🏆 ┃ ${formData.title.toUpperCase()}`}
                onChange={e => setFormData({ ...formData, categoryName: e.target.value })}
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                placeholder="🏆 ┃ TOURNAMENTS"
              />
            </div>
          </div>
        </section>

        <section className="p-5 sm:p-6 rounded-[24px] esports-card space-y-6">
          <div className="flex items-center gap-3.5 border-b border-white/[0.07] pb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#38BDF8] shrink-0">
              <Tag className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Verification Logic
              </div>
              <h3 className="font-display text-lg sm:text-xl font-bold text-white">
                Tagcheck Engine Rules (<code className="text-[#38BDF8] font-mono text-base">/tagcheck</code>)
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl esports-card-sub">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-white">
                  Minimum Required Tags
                </label>
                <span className="px-3 py-1 rounded-lg bg-white/[0.04] border border-white/10 font-mono tabular-nums text-xs font-bold text-[#38BDF8]">
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
                className="w-full accent-[#38BDF8] cursor-pointer"
              />
              <p className="text-xs text-white/50 mt-2">
                Registration messages with fewer mentions will be rejected automatically.
              </p>
            </div>

            <div className="p-6 rounded-2xl esports-card-sub">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-white">
                  Maximum Allowed Tags (Including Subs)
                </label>
                <span className="px-3 py-1 rounded-lg bg-white/[0.04] border border-white/10 font-mono tabular-nums text-xs font-bold text-[#38BDF8]">
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
                className="w-full accent-[#38BDF8] cursor-pointer"
              />
              <p className="text-xs text-white/50 mt-2">
                Prevents mass tagging or registering oversize rosters.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-start justify-between gap-4 p-5 rounded-2xl esports-card-sub cursor-pointer">
              <div>
                <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
                  <Zap className="w-4 h-4 text-[#F59E0B]" />
                  <span>EasyTag Feature (<code className="font-mono text-[#38BDF8]">!eztag</code>)</span>
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
                  Automatically converts pasted 18-digit Discord user IDs into pingable mentions, solving issues with complex fonts and symbols in usernames.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.easyTagEnabled}
                onChange={e => setFormData({ ...formData, easyTagEnabled: e.target.checked })}
                className="mt-1 w-4 h-4 rounded accent-[#38BDF8] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-5 rounded-2xl esports-card-sub cursor-pointer">
              <div>
                <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
                  <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                  <span>Cross-Team Anti-Duplicate Tag Check</span>
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
                  Rejects registration if any tagged player is already registered in an earlier confirmed slot or waiting list.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.prohibitDuplicateTags}
                onChange={e => setFormData({ ...formData, prohibitDuplicateTags: e.target.checked })}
                className="mt-1 w-4 h-4 rounded accent-[#38BDF8] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-5 rounded-2xl esports-card-sub cursor-pointer">
              <div>
                <div className="font-display font-bold text-sm text-white">
                  Prohibit Self-Duplication in Roster
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
                  Prevents a captain from tagging themselves or another member multiple times to fake a full squad.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.prohibitSelfDuplication}
                onChange={e => setFormData({ ...formData, prohibitSelfDuplication: e.target.checked })}
                className="mt-1 w-4 h-4 rounded accent-[#38BDF8] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-5 rounded-2xl esports-card-sub cursor-pointer">
              <div>
                <div className="font-display font-bold text-sm text-white">
                  Disallow Discord Bot Mentions
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
                  Prevents participants from tagging bots to fulfill the required tag count.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.disallowBots}
                onChange={e => setFormData({ ...formData, disallowBots: e.target.checked })}
                className="mt-1 w-4 h-4 rounded accent-[#38BDF8] cursor-pointer shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-5 rounded-2xl esports-card-sub cursor-pointer md:col-span-2">
              <div>
                <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
                  <span>Auto-Create Team Category, Role &amp; Private Voice Channel</span>
                </div>
                <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
                  After each team registration, automatically creates a new Discord category and role named after the team, creates their private voice channel under that category, and grants the team role to all players tagged during registration so only they can join.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.autoCreateTeamVoice !== false}
                onChange={e => setFormData({ ...formData, autoCreateTeamVoice: e.target.checked })}
                className="mt-1 w-4 h-4 rounded accent-[#38BDF8] cursor-pointer shrink-0"
              />
            </label>
          </div>
        </section>

        <section className="p-5 sm:p-6 rounded-[24px] esports-card space-y-6">
          <div className="flex items-center gap-3.5 border-b border-white/[0.07] pb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#38BDF8] shrink-0">
              <Users className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Capacity &amp; Cleanup
              </div>
              <h3 className="font-display text-lg sm:text-xl font-bold text-white">
                Slot Allocation &amp; Channel Timers
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
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
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
              />
              <span className="text-[11px] font-mono tabular-nums text-white/45 mt-2 block">
                Current occupied: <span className="text-[#38BDF8]">{confirmedCount}</span>/{formData.totalSlots}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Waiting List Slots
              </label>
              <input
                type="number"
                min="0"
                max="50"
                value={formData.waitlistSlots}
                onChange={e => setFormData({ ...formData, waitlistSlots: parseInt(e.target.value, 10) || 5 })}
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
              />
              <span className="text-[11px] font-mono tabular-nums text-white/45 mt-2 block">
                Current waitlist: <span className="text-white/90">{waitlistCount}</span>/{formData.waitlistSlots}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Auto-Delete Failed Message (Seconds)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={formData.autoDeleteSeconds}
                  onChange={e => setFormData({ ...formData, autoDeleteSeconds: parseInt(e.target.value, 10) || 5 })}
                  className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
                />
                <span className="text-xs text-white/45 font-mono whitespace-nowrap">sec</span>
              </div>
              <span className="text-[11px] text-white/45 mt-2 block">
                Cleans up invalid spam from #registration
              </span>
            </div>
          </div>
        </section>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-4">
            <button
              type="submit"
              className="btn-glacier-primary h-12 px-7 rounded-2xl font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Configuration</span>
            </button>

            {savedSuccess && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[#10B981]">
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
                className="h-12 px-5 rounded-2xl bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#F87171] border border-[#EF4444]/25 font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset All Slots &amp; Registrations</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 p-3 bg-white/[0.03] border border-[#EF4444]/40 rounded-2xl">
                <span className="text-xs text-white font-medium px-2">
                  Are you sure? This clears all {registeredTeams.length} registered teams.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onResetTeams();
                    setShowResetConfirm(false);
                  }}
                  className="h-8 px-3.5 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-bold cursor-pointer"
                >
                  Yes, Clear All
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="h-8 px-3.5 rounded-xl bg-white/[0.05] border border-white/10 text-white/70 text-xs hover:text-white cursor-pointer"
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

