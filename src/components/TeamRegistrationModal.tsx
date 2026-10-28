import React, { useState, useEffect } from 'react';
import { TournamentConfig, TeamRegistration, TournamentRegion } from '../types/tournament';
import {
  isValidWhatsAppNumber,
  sanitizeWhatsAppNumber,
  getRegionCountryCode,
  isValidTournamentRegion,
  VALID_TOURNAMENT_REGIONS,
  normalizeDiscordUserId,
  getTeamMemberIds
} from '../utils/tagParser';
import {
  X,
  Users,
  ShieldAlert,
  CheckCircle2,
  Phone,
  Globe2,
  Info,
  Loader2
} from 'lucide-react';

interface TeamRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TournamentConfig;
  existingTeams: TeamRegistration[];
  onSuccess: () => void;
}

export const TeamRegistrationModal: React.FC<TeamRegistrationModalProps> = ({
  isOpen,
  onClose,
  config,
  existingTeams,
  onSuccess
}) => {
  const reqTags = Math.max(1, config.requiredTags || 4);

  const [teamName, setTeamName] = useState<string>('');
  const [region, setRegion] = useState<TournamentRegion | ''>('');
  const [whatsappNumber1, setWhatsappNumber1] = useState<string>('');
  const [playerTags, setPlayerTags] = useState<string[]>(
    Array.from({ length: reqTags }, () => '')
  );

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setPlayerTags(prev => {
      if (prev.length === reqTags) return prev;
      return Array.from({ length: reqTags }, (_, i) => prev[i] || '');
    });
  }, [reqTags]);

  if (!isOpen) return null;

  const handleRegionChange = (nextRegion: TournamentRegion | '') => {
    setRegion(nextRegion);
    if (!nextRegion) return;
    const nextCode = getRegionCountryCode(nextRegion);
    setWhatsappNumber1(prev => {
      const stripped = prev
        .trim()
        .replace(/^\+(?:91|880|92)\s*/, '')
        .trim();
      return stripped ? `${nextCode} ${stripped}` : `${nextCode} `;
    });
  };

  const handlePlayerChange = (index: number, value: string) => {
    setPlayerTags(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const validateForm = (): boolean => {
    setValidationError(null);

    const cleanTeam = teamName.trim();
    if (!cleanTeam) {
      setValidationError('Team Name is required.');
      return false;
    }
    if (cleanTeam.length < 2) {
      setValidationError('Team Name must be at least 2 characters long.');
      return false;
    }
    const lower = cleanTeam.toLowerCase();
    if (lower === 'team name' || lower === 'your team' || lower === 'your team name') {
      setValidationError('Please provide your actual squad name (e.g. "Team Glacier").');
      return false;
    }

    const isDuplicateName = existingTeams.some(
      t => t.teamName.trim().toLowerCase() === lower
    );
    if (isDuplicateName) {
      setValidationError(`A team named "${cleanTeam}" is already registered. Please use a unique team name.`);
      return false;
    }

    if (!region || !isValidTournamentRegion(region)) {
      setValidationError('Please select a valid Region (India, Bangladesh, or Pakistan).');
      return false;
    }

    const cleanWa1 = whatsappNumber1.trim();
    const expectedCode = getRegionCountryCode(region);
    if (!cleanWa1 || cleanWa1 === expectedCode) {
      setValidationError(`WhatsApp Number is required (starting with ${expectedCode}).`);
      return false;
    }
    if (!isValidWhatsAppNumber(cleanWa1, region)) {
      setValidationError(`Invalid WhatsApp Number! Please enter a valid number with ${expectedCode} country code (e.g., ${expectedCode}9876543210).`);
      return false;
    }

    const filledPlayers = playerTags.slice(0, reqTags).map(p => p.trim()).filter(Boolean);
    if (filledPlayers.length !== reqTags) {
      setValidationError(`Exactly ${reqTags} players are required as configured in tournament setup (no extra or missing players).`);
      return false;
    }

    const normalizedIds = filledPlayers.map(p => normalizeDiscordUserId(p));
    if (normalizedIds.some(id => !id)) {
      setValidationError('Please enter a valid Discord User ID or mention for every player.');
      return false;
    }

    const uniquePlayers = new Set(normalizedIds);
    if (uniquePlayers.size !== normalizedIds.length) {
      setValidationError('Duplicate member IDs detected within the same team. Every player on a team must be a unique Discord member.');
      return false;
    }

    for (let i = 0; i < normalizedIds.length; i++) {
      const memberId = normalizedIds[i];
      const rawLabel = filledPlayers[i];
      for (const team of existingTeams) {
        const existingMemberIds = getTeamMemberIds(team);
        if (existingMemberIds.has(memberId)) {
          const slotDesc = team.isWaitlist ? `Waitlist #${team.slotNumber}` : `Slot #${team.slotNumber}`;
          const existingRole = normalizeDiscordUserId(team.captain?.id) === memberId ? 'captain' : 'player';
          setValidationError(
            `Member "${rawLabel}" is already registered as ${existingRole} in team "${team.teamName}" (${slotDesc}). Each Discord member can belong to only one team until their existing registration is deleted.`
          );
          return false;
        }
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateForm() || !region) {
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    const cleanTeam = teamName.trim();
    const sanitizedWa1 = sanitizeWhatsAppNumber(whatsappNumber1, region);
    const filledPlayers = playerTags.slice(0, reqTags).map(p => p.trim()).filter(Boolean);

    const playersList = filledPlayers.map((p, idx) => {
      const normalizedId = normalizeDiscordUserId(p);
      const cleanDisplay = p.replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '').trim();
      return {
        id: normalizedId,
        username: cleanDisplay.toLowerCase().replace(/[^a-z0-9_.-]/g, '') || `player${idx + 1}`,
        displayName: cleanDisplay || `Player ${idx + 1}`,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(normalizedId)}`
      };
    });

    const captainUser = playersList[0];

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: cleanTeam,
          whatsappNumber1: sanitizedWa1,
          region,
          captain: captainUser,
          players: playersList,
          messageId: `web-${Date.now()}`,
          channelId: config.regChannel || 'registration'
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(`Team "${cleanTeam}" registered in ${data.isWaitlist ? `Waitlist #${data.slotNumber}` : `Slot #${data.slotNumber}`}! Tagged players granted Voice Channel Role.`);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      } else {
        setValidationError(data.error || 'Registration failed. Please check the fields and try again.');
      }
    } catch (err: any) {
      setValidationError(err.message || 'Network error while connecting to tournament server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCode = region ? getRegionCountryCode(region) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl overflow-y-auto">
      <div className="rounded-[28px] bg-[#080A0F]/95 border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.85)] w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
        <div className="px-6 sm:px-8 py-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#38BDF8]">
              <Users className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Direct Squad Entry
              </div>
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                Register Your Team
              </h2>
              <p className="text-[11px] text-white/50">
                {config.title || 'Tournament'} · {reqTags} Required Players ({config.format})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5 text-xs">
          {validationError && (
            <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/25 text-[#F87171] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs font-medium leading-relaxed">
                {validationError}
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <div className="flex-1 text-xs font-medium">
                {successMessage}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-white/75 mb-2">
              Team Name <span className="text-[#F87171]">*</span>
            </label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g. Glacier Esports"
              disabled={isSubmitting}
              className="w-full h-11 px-3.5 rounded-xl esports-input placeholder-white/35"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/75 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Region</span>
                <span className="text-[#F87171]">*</span>
              </span>
              {currentCode && (
                <span className="text-[11px] text-white/45 font-mono">
                  Auto-sets {currentCode} country code
                </span>
              )}
            </label>
            <select
              value={region}
              onChange={e => handleRegionChange(e.target.value as TournamentRegion | '')}
              disabled={isSubmitting}
              className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-medium cursor-pointer"
              required
            >
              <option value="" disabled className="bg-[#090C12] text-white/50">
                Select Region...
              </option>
              {VALID_TOURNAMENT_REGIONS.map(reg => (
                <option key={reg} value={reg} className="bg-[#090C12] text-white">
                  {reg === 'India' ? '🇮🇳 India (+91)' : reg === 'Bangladesh' ? '🇧🇩 Bangladesh (+880)' : '🇵🇰 Pakistan (+92)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/75 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Captain WhatsApp Number</span>
                <span className="text-[#F87171]">*</span>
              </span>
              {currentCode && (
                <span className="text-[11px] text-white/45 font-mono">
                  Must start with {currentCode}
                </span>
              )}
            </label>
            <input
              type="tel"
              value={whatsappNumber1}
              onChange={e => setWhatsappNumber1(e.target.value)}
              placeholder={currentCode ? `${currentCode} XXXXXXXXXX` : 'Enter WhatsApp number with country code'}
              disabled={isSubmitting}
              className="w-full h-11 px-3.5 rounded-xl esports-input font-mono text-xs placeholder-white/35"
              required
            />
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center gap-3 text-xs text-white/55">
            <Info className="w-4 h-4 text-[#38BDF8] shrink-0" />
            <span>Contact number remains confidential to tournament staff. Upon submit, all {reqTags} tagged players receive the Team Voice Channel Role to join VC.</span>
          </div>

          <div className="space-y-3 pt-3 border-t border-white/[0.07]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Player Tags ({reqTags} Players Required)
              </span>
              <span className="text-[11px] font-mono text-[#38BDF8]">
                Exact {reqTags} tags
              </span>
            </div>

            <div className="space-y-2.5">
              {playerTags.slice(0, reqTags).map((tag, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="w-24 text-[11px] font-mono text-white/50 shrink-0">
                    {idx === 0 ? 'Player 1 (IGL):' : `Player ${idx + 1}:`}
                  </span>
                  <input
                    type="text"
                    value={tag}
                    onChange={e => handlePlayerChange(idx, e.target.value)}
                    placeholder={`@Player${idx + 1} or Discord ID`}
                    disabled={isSubmitting}
                    className="flex-1 h-10 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-5 border-t border-white/[0.07] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-glacier-secondary h-10 px-5 rounded-xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-glacier-primary h-10 px-6 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Registering Team...</span>
                </>
              ) : (
                <span>Register Team</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
