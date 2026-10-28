import React, { useState, useEffect } from 'react';
import {
  Send,
  Plus,
  Trash2,
  Layers,
  Palette,
  Image as ImageIcon,
  Type,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Hash,
  RefreshCw,
  Eye,
  FileText
} from 'lucide-react';
import { TournamentConfig } from '../types/tournament';

interface RulesEmbedField {
  id: string;
  name: string;
  value: string;
  inline: boolean;
}

interface RulesEmbedData {
  content: string;
  authorName: string;
  authorIconUrl: string;
  authorUrl: string;
  title: string;
  titleUrl: string;
  description: string;
  color: string;
  thumbnailUrl: string;
  imageUrl: string;
  footerText: string;
  footerIconUrl: string;
  includeTimestamp: boolean;
  fields: RulesEmbedField[];
}

interface TargetChannelOption {
  id: string;
  name: string;
  guildId: string;
  guildName: string;
  isRulesChannel: boolean;
}

interface RulesEmbedStudioProps {
  config: TournamentConfig;
  onRulesPublished?: (rulesText: string) => void;
}

const COLOR_PRESETS = [
  { name: 'Glacier Cyan', hex: '#38BDF8' },
  { name: 'Discord Blurple', hex: '#5865F2' },
  { name: 'Verified Green', hex: '#57F287' },
  { name: 'Esports Gold', hex: '#F59E0B' },
  { name: 'Warning Red', hex: '#ED4245' },
  { name: 'Obsidian Dark', hex: '#2B2D31' }
];

export const RulesEmbedStudio: React.FC<RulesEmbedStudioProps> = ({
  config,
  onRulesPublished
}) => {
  const [embed, setEmbed] = useState<RulesEmbedData>(() => ({
    content: '@everyone 📢 **OFFICIAL TOURNAMENT RULES & MATCH FORMAT**',
    authorName: `${config.title || 'Glacier Cup'} Operations`,
    authorIconUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    authorUrl: '',
    title: `🏆 ${config.title || 'Glacier Cup'} — Official Tournament Rulebook & Scoring`,
    titleUrl: '',
    description:
      config.customRules && config.customRules.trim().length > 0
        ? config.customRules
        : `Welcome to the official **${config.title || 'Tournament'}**!\n\nAll registered teams must review and strictly abide by the rules outlined below. Failure to comply will lead to slot disqualification.`,
    color: '#38BDF8',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: `${config.title || 'FFA-Manager'} • Enforced by Tournament Staff`,
    footerIconUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    includeTimestamp: true,
    fields: [
      {
        id: '1',
        name: '🎮 1. Format & Team Eligibility',
        value: `• Required Tags: **${config.requiredTags || 4} Player Tags** per team\n• All tagged players receive the **@Verified Team** role\n• Emulators and ringers strictly prohibited`,
        inline: false
      },
      {
        id: '2',
        name: '🔑 2. Room ID & Password Distribution',
        value: `• Credentials sent privately to **#${config.idpChannel || 'tournament-idp'}**\n• Teams must join 10 minutes prior to kickoff\n• Sharing credentials outside your roster will result in a permanent blacklist`,
        inline: false
      },
      {
        id: '3',
        name: '📊 3. Official Scoring Matrix',
        value: '`1st Place:` 10 pts\n`2nd Place:` 6 pts\n`3rd Place:` 5 pts\n`4th Place:` 4 pts\n`5th Place:` 3 pts',
        inline: true
      },
      {
        id: '4',
        name: '🎯 4. Kill / Finish Points',
        value: '`Each Kill:` +1 pt\n`Tie-Breaker:` Total Kills > Placement\n`Disqualification:` -5 pts penalty',
        inline: true
      }
    ]
  }));

  const [availableChannels, setAvailableChannels] = useState<TargetChannelOption[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [customChannelInput, setCustomChannelInput] = useState<string>('');
  const [useCustomChannel, setUseCustomChannel] = useState<boolean>(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);

  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetchChannels = async () => {
    setIsLoadingChannels(true);
    try {
      const res = await fetch('/api/bot/channels');
      const data = await res.json();
      if (data && Array.isArray(data.channels)) {
        setAvailableChannels(data.channels);
        const rulesCh = data.channels.find((c: TargetChannelOption) => c.isRulesChannel);
        if (rulesCh && !selectedChannelId) {
          setSelectedChannelId(rulesCh.id);
        } else if (data.channels.length > 0 && !selectedChannelId) {
          setSelectedChannelId(data.channels[0].id);
        }
      }
    } catch {
      // offline / fallback
    } finally {
      setIsLoadingChannels(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleAddField = () => {
    if (embed.fields.length >= 25) return;
    setEmbed(prev => ({
      ...prev,
      fields: [
        ...prev.fields,
        {
          id: Math.random().toString(36).substring(2, 9),
          name: 'New Section / Rule',
          value: 'Rule description goes here...',
          inline: false
        }
      ]
    }));
  };

  const handleRemoveField = (id: string) => {
    setEmbed(prev => ({
      ...prev,
      fields: prev.fields.filter(f => f.id !== id)
    }));
  };

  const handleUpdateField = (id: string, key: 'name' | 'value' | 'inline', val: any) => {
    setEmbed(prev => ({
      ...prev,
      fields: prev.fields.map(f => (f.id === id ? { ...f, [key]: val } : f))
    }));
  };

  const handleSendEmbed = async () => {
    setIsSending(true);
    setSendSuccess(null);
    setSendError(null);

    const targetChannel = useCustomChannel ? customChannelInput.trim() : selectedChannelId;

    try {
      const res = await fetch('/api/bot/send-custom-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: targetChannel || undefined,
          content: embed.content || undefined,
          tournamentId: config.id || undefined,
          embed: {
            title: embed.title,
            description: embed.description,
            url: embed.titleUrl || undefined,
            color: embed.color,
            author: embed.authorName
              ? {
                  name: embed.authorName,
                  icon_url: embed.authorIconUrl || undefined,
                  url: embed.authorUrl || undefined
                }
              : undefined,
            thumbnail: embed.thumbnailUrl ? { url: embed.thumbnailUrl } : undefined,
            image: embed.imageUrl ? { url: embed.imageUrl } : undefined,
            footer: embed.footerText
              ? {
                  text: embed.footerText,
                  icon_url: embed.footerIconUrl || undefined
                }
              : undefined,
            timestamp: embed.includeTimestamp ? new Date().toISOString() : undefined,
            fields: embed.fields.map(f => ({
              name: f.name,
              value: f.value,
              inline: f.inline
            }))
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        setSendSuccess(
          `Embed successfully dispatched by bot to #${data.channelName || 'rules'} (Message ID: ${data.messageId || 'sent'})!`
        );
        if (onRulesPublished) {
          onRulesPublished(embed.description);
        }
      } else {
        setSendError(data.error || 'Failed to dispatch embed. Verify bot is in the server with Send Messages and Embed Links permissions.');
      }
    } catch (err: any) {
      setSendError(`Network error while communicating with bot server: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Split Grid: Editor (Left) & Discord Preview (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* ============================================================== */}
        {/* LEFT COLUMN: BUILDER CONTROLS */}
        {/* ============================================================== */}
        <div className="xl:col-span-7 space-y-6">
          {/* Target Channel Box */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
                <Hash className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Destination Channel</span>
              </div>
              <button
                type="button"
                onClick={fetchChannels}
                disabled={isLoadingChannels}
                className="text-[11px] text-[#38BDF8] hover:text-[#7DD3FC] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingChannels ? 'animate-spin' : ''}`} />
                <span>Refresh Channels</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1.5">
                  Select Discord Channel
                </label>
                <select
                  disabled={useCustomChannel}
                  value={selectedChannelId}
                  onChange={e => setSelectedChannelId(e.target.value)}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#38BDF8] disabled:opacity-40"
                >
                  {availableChannels.length === 0 && (
                    <option value="">Default #tournament-rules (Auto-detected)</option>
                  )}
                  {availableChannels.map(ch => (
                    <option key={ch.id} value={ch.id}>
                      #{ch.name} {ch.isRulesChannel ? '★ (Rules)' : ''} ({ch.guildName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-white/60">
                    Or Channel ID
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-white/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useCustomChannel}
                      onChange={e => setUseCustomChannel(e.target.checked)}
                      className="rounded bg-black border-white/20 text-[#38BDF8] focus:ring-0"
                    />
                    <span>Custom ID</span>
                  </label>
                </div>
                <input
                  type="text"
                  disabled={!useCustomChannel}
                  placeholder="e.g. 123456789012345678"
                  value={customChannelInput}
                  onChange={e => setCustomChannelInput(e.target.value)}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8] disabled:opacity-40"
                />
              </div>
            </div>
          </div>

          {/* Plain Message Content (Above Embed) */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Type className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Message Content (Outside Embed)</span>
              </label>
              <span className="text-[11px] text-white/40">Optional text, pings or mentions</span>
            </div>
            <input
              type="text"
              placeholder="@everyone 📢 OFFICIAL RULES & FORMAT ANNOUNCEMENT"
              value={embed.content}
              onChange={e => setEmbed(prev => ({ ...prev, content: e.target.value }))}
              className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
            />
          </div>

          {/* Embed Core Body (Title, Color, Description) */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Embed Title &amp; Description</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-white/60 mb-1.5">
                  Embed Title
                </label>
                <input
                  type="text"
                  placeholder="🏆 TOURNAMENT RULES & REGULATIONS"
                  value={embed.title}
                  onChange={e => setEmbed(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1.5">
                  Title URL
                </label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={embed.titleUrl}
                  onChange={e => setEmbed(prev => ({ ...prev, titleUrl: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>
            </div>

            {/* Description Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-white/60">
                  Embed Description (Markdown Supported)
                </label>
                <span className="text-[10px] text-white/40 tabular-nums">
                  {embed.description.length}/4096 characters
                </span>
              </div>
              <textarea
                rows={6}
                placeholder="Enter rich rules text, guidelines, bullet points, and codeblocks..."
                value={embed.description}
                onChange={e => setEmbed(prev => ({ ...prev, description: e.target.value }))}
                className="w-full bg-[#111318] border border-white/[0.1] rounded-xl p-3.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8] font-mono leading-relaxed resize-y"
              />
            </div>

            {/* Color Selector */}
            <div className="space-y-2 pt-2 border-t border-white/[0.05]">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-white/60 flex items-center gap-1.5">
                  <Palette className="w-3 h-3 text-[#38BDF8]" />
                  <span>Left Border Accent Color</span>
                </label>
                <span className="text-[11px] font-mono text-white/50">{embed.color}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={embed.color}
                  onChange={e => setEmbed(prev => ({ ...prev, color: e.target.value }))}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 p-0"
                />
                {COLOR_PRESETS.map(preset => (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setEmbed(prev => ({ ...prev, color: preset.hex }))}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 border transition-all cursor-pointer ${
                      embed.color.toLowerCase() === preset.hex.toLowerCase()
                        ? 'border-white/40 text-white shadow-xs'
                        : 'border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: preset.hex }}
                    />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Embed Fields (Dynamic List) */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Embed Fields ({embed.fields.length}/25)</span>
              </div>
              <button
                type="button"
                onClick={handleAddField}
                disabled={embed.fields.length >= 25}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#38BDF8]/15 text-[#38BDF8] hover:bg-[#38BDF8]/25 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>Add Field</span>
              </button>
            </div>

            {embed.fields.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/40 border border-dashed border-white/[0.08] rounded-xl">
                No custom fields added yet. Click &quot;Add Field&quot; to add structured scoring or rule sections.
              </div>
            ) : (
              <div className="space-y-3">
                {embed.fields.map((field, idx) => (
                  <div
                    key={field.id}
                    className="p-3.5 rounded-xl bg-white/[0.015] border border-white/[0.07] space-y-3 relative group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] text-white/30 font-mono">#{idx + 1}</span>
                        <input
                          type="text"
                          placeholder="Field Name (e.g. 1. Tie Breakers)"
                          value={field.name}
                          onChange={e => handleUpdateField(field.id, 'name', e.target.value)}
                          className="w-full bg-[#111318] border border-white/[0.08] rounded-lg px-2.5 py-1 text-xs text-white font-semibold placeholder-white/30 focus:outline-none focus:border-[#38BDF8]"
                        />
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={field.inline}
                            onChange={e => handleUpdateField(field.id, 'inline', e.target.checked)}
                            className="rounded bg-black border-white/20 text-[#38BDF8] focus:ring-0"
                          />
                          <span>Inline</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => handleRemoveField(field.id)}
                          className="p-1 text-white/40 hover:text-[#EF4444] transition-colors cursor-pointer rounded"
                          title="Remove Field"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      placeholder="Field Value (markdown supported, bullet points, etc.)"
                      value={field.value}
                      onChange={e => handleUpdateField(field.id, 'value', e.target.value)}
                      className="w-full bg-[#111318] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-[#38BDF8] font-mono leading-relaxed resize-y"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Author, Images & Footer */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Author, Media &amp; Footer Metadata</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Author Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Glacier Cup Staff"
                  value={embed.authorName}
                  onChange={e => setEmbed(prev => ({ ...prev, authorName: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Author Icon URL
                </label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={embed.authorIconUrl}
                  onChange={e => setEmbed(prev => ({ ...prev, authorIconUrl: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Thumbnail URL (Top-Right)
                </label>
                <input
                  type="text"
                  placeholder="https://... (small image)"
                  value={embed.thumbnailUrl}
                  onChange={e => setEmbed(prev => ({ ...prev, thumbnailUrl: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Large Banner Image URL
                </label>
                <input
                  type="text"
                  placeholder="https://... (full width banner)"
                  value={embed.imageUrl}
                  onChange={e => setEmbed(prev => ({ ...prev, imageUrl: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Footer Text
                </label>
                <input
                  type="text"
                  placeholder="e.g. FFA-Manager • Tournament Ops"
                  value={embed.footerText}
                  onChange={e => setEmbed(prev => ({ ...prev, footerText: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/60 mb-1">
                  Footer Icon URL
                </label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={embed.footerIconUrl}
                  onChange={e => setEmbed(prev => ({ ...prev, footerIconUrl: e.target.value }))}
                  className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-[#38BDF8]"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={embed.includeTimestamp}
                  onChange={e => setEmbed(prev => ({ ...prev, includeTimestamp: e.target.checked }))}
                  className="rounded bg-black border-white/20 text-[#38BDF8] focus:ring-0"
                />
                <span>Include Live Timestamp in Embed Footer</span>
              </label>
            </div>
          </div>

          {/* Action Row: Send Button & Status */}
          <div className="p-5 rounded-2xl bg-[#0EA5E9]/5 border border-[#38BDF8]/20 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-white">Publish Directly via Discord Bot</div>
                <div className="text-[11px] text-white/60">
                  Sends this exact formatted embed into your selected rules channel
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendEmbed}
                disabled={isSending}
                className="btn-glacier-primary h-11 px-6 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Dispatching Embed...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send Embed to #rules</span>
                  </>
                )}
              </button>
            </div>

            {sendSuccess && (
              <div className="p-3 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 text-[#6EE7B7] text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#10B981]" />
                <span>{sendSuccess}</span>
              </div>
            )}

            {sendError && (
              <div className="p-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#EF4444]" />
                <span>{sendError}</span>
              </div>
            )}
          </div>
        </div>

        {/* ============================================================== */}
        {/* RIGHT COLUMN: DISCORD LIVE SIMULATOR */}
        {/* ============================================================== */}
        <div className="xl:col-span-5 space-y-3 xl:sticky xl:top-24">
          <div className="flex items-center justify-between px-1">
            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Discord Live Mockup</span>
            </div>
            <span className="text-[10px] text-white/40">Pixel-accurate Discord render</span>
          </div>

          {/* Discord App Mock Container */}
          <div className="rounded-2xl bg-[#313338] border border-white/[0.08] p-4 text-[#DBDEE1] font-sans shadow-2xl">
            {/* Discord Message Row */}
            <div className="flex items-start gap-3.5">
              {/* Bot Avatar */}
              <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-xs shrink-0 select-none overflow-hidden">
                <span className="tracking-tighter">FFA</span>
              </div>

              {/* Message Content Body */}
              <div className="flex-1 min-w-0 space-y-1">
                {/* Username & Bot Badge Header */}
                <div className="flex items-center gap-2 leading-none">
                  <span className="text-sm font-semibold text-white hover:underline cursor-pointer">
                    FFA-Manager
                  </span>
                  <span className="bg-[#5865F2] text-[10px] text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider leading-none">
                    BOT
                  </span>
                  <span className="text-[11px] text-[#949BA4]">
                    Today at 12:00 PM
                  </span>
                </div>

                {/* Optional Message Content Text */}
                {embed.content && (
                  <div className="text-sm text-[#DBDEE1] leading-relaxed whitespace-pre-wrap select-text pt-0.5">
                    {embed.content}
                  </div>
                )}

                {/* DISCORD EMBED CARD */}
                <div
                  className="rounded-lg bg-[#2B2D31] p-4 mt-2 space-y-3 relative max-w-xl border-l-[4px]"
                  style={{ borderLeftColor: embed.color || '#38BDF8' }}
                >
                  {/* Top-Right Thumbnail if present */}
                  {embed.thumbnailUrl && (
                    <div className="float-right ml-3 mb-2 w-16 h-16 rounded-md overflow-hidden bg-black/20 shrink-0">
                      <img
                        src={embed.thumbnailUrl}
                        alt="Thumbnail"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={e => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* Author Row */}
                  {embed.authorName && (
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      {embed.authorIconUrl && (
                        <img
                          src={embed.authorIconUrl}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <span>{embed.authorName}</span>
                    </div>
                  )}

                  {/* Title */}
                  {embed.title && (
                    <div className="text-base font-bold text-white hover:underline cursor-pointer leading-snug">
                      {embed.title}
                    </div>
                  )}

                  {/* Description */}
                  {embed.description && (
                    <div className="text-xs text-[#DBDEE1] leading-relaxed whitespace-pre-wrap font-sans">
                      {embed.description}
                    </div>
                  )}

                  {/* Fields Grid */}
                  {embed.fields && embed.fields.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {embed.fields.map(field => (
                        <div
                          key={field.id}
                          className={`${
                            field.inline ? 'sm:col-span-1' : 'sm:col-span-2'
                          } space-y-1`}
                        >
                          <div className="text-xs font-bold text-white">
                            {field.name}
                          </div>
                          <div className="text-xs text-[#DBDEE1] whitespace-pre-wrap leading-relaxed font-sans">
                            {field.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Large Banner Image */}
                  {embed.imageUrl && (
                    <div className="rounded-lg overflow-hidden bg-black/30 mt-2 max-h-64">
                      <img
                        src={embed.imageUrl}
                        alt="Embed banner"
                        className="w-full h-auto object-cover"
                        referrerPolicy="no-referrer"
                        onError={e => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* Footer Row */}
                  {(embed.footerText || embed.includeTimestamp) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-[#949BA4] pt-1">
                      {embed.footerIconUrl && (
                        <img
                          src={embed.footerIconUrl}
                          alt=""
                          className="w-4 h-4 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      {embed.footerText && <span>{embed.footerText}</span>}
                      {embed.footerText && embed.includeTimestamp && <span>•</span>}
                      {embed.includeTimestamp && <span>Today at 12:00 PM</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-white/50 flex items-center justify-between">
            <span>Powered by FFA Glacier Tournament Bot</span>
            <span className="font-mono text-[#38BDF8]">/rules &amp; /rules-format</span>
          </div>
        </div>
      </div>
    </div>
  );
};
