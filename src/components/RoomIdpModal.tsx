import React, { useState } from 'react';
import { RoomCredentials, TournamentConfig, TeamRegistration } from '../types/tournament';
import { KeyRound, Send, CheckCircle2, X } from 'lucide-react';

interface RoomIdpModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TournamentConfig;
  confirmedTeams: TeamRegistration[];
  onDispatch: (creds: RoomCredentials) => void;
  lastDispatch: RoomCredentials | null;
}

export const RoomIdpModal: React.FC<RoomIdpModalProps> = ({
  isOpen,
  onClose,
  confirmedTeams,
  onDispatch,
  lastDispatch
}) => {
  const [roomId, setRoomId] = useState<string>(lastDispatch?.roomId || '8492019');
  const [roomPass, setRoomPass] = useState<string>(lastDispatch?.roomPass || 'scrims99');
  const [mapName, setMapName] = useState<string>(lastDispatch?.mapName || 'Main Lobby');
  const [matchTime, setMatchTime] = useState<string>(lastDispatch?.matchTime || '08:00 PM IST');
  const [serverType, setServerType] = useState<string>(lastDispatch?.serverType || 'Custom Room #1');
  const [dispatched, setDispatched] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onDispatch({
      roomId: roomId.trim(),
      roomPass: roomPass.trim(),
      mapName: mapName.trim(),
      matchTime: matchTime.trim(),
      serverType: serverType.trim(),
      sentAt: new Date().toISOString()
    });
    setDispatched(true);
    setTimeout(() => {
      setDispatched(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="relative w-full max-w-lg rounded-xl bg-[#14171D] border border-[#292F3A] p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#292F3A] pb-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#6685FF]/15 border border-[#6685FF]/30 text-[#A7C7FF] flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-[#6685FF]" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[#F3F5F9] tracking-tight">
                Dispatch Match Room ID & Password
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#929BAA] hover:text-[#F3F5F9] p-1.5 rounded-md hover:bg-[#191D25] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#929BAA] leading-relaxed">
          Executes the <code className="text-[#A7C7FF] font-mono bg-[#191D25] border border-[#292F3A] px-1.5 py-0.2 rounded">/idpass</code> command, publishing lobby credentials to <span className="text-[#F3F5F9] font-mono">#id-pass</span> and notifying confirmed slot holders.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                placeholder="e.g. 7839201"
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] font-mono text-sm placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Password
              </label>
              <input
                type="text"
                value={roomPass}
                onChange={e => setRoomPass(e.target.value)}
                placeholder="e.g. tourney99"
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] font-mono text-sm placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Map
              </label>
              <input
                type="text"
                value={mapName}
                onChange={e => setMapName(e.target.value)}
                placeholder="e.g. Map 1, Custom Lobby..."
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                Match Start Time
              </label>
              <input
                type="text"
                value={matchTime}
                onChange={e => setMatchTime(e.target.value)}
                placeholder="08:00 PM IST"
                className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
              Custom Lobby Label
            </label>
            <input
              type="text"
              value={serverType}
              onChange={e => setServerType(e.target.value)}
              placeholder="Custom Room #1 - Tier 1 Scrims"
              className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
            />
          </div>

          <div className="px-3.5 py-2.5 rounded-lg bg-[#191D25] border border-[#292F3A] text-xs text-[#929BAA] flex items-center justify-between">
            <span>Recipients: Confirmed Teams</span>
            <span className="font-mono tabular-nums font-semibold text-[#A7C7FF]">
              {confirmedTeams.length} Captains
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#292F3A]">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-md bg-[#191D25] hover:bg-[#1F242E] text-[#F3F5F9] border border-[#292F3A] text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={dispatched}
              className="h-9 px-4 rounded-md bg-[#6685FF] hover:bg-[#5776F5] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
            >
              {dispatched ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Dispatched!</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish to #id-pass</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
