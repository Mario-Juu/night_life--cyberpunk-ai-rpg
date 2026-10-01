import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, MessageSquare, Newspaper, Send, Smartphone, X } from 'lucide-react';
import type { GameState, NewsSource, Npc } from '@shared/types/game';
import { formatGameTime } from '@shared/rules/world';
import { unreadNews } from '@shared/engine/fronts';
import { Empty, SuggestionStrip, cn } from '../../ui';
import { NEWS_THREAD, markNewsSeen, selectThread, sendPhoneMessage } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

function initials(name: string) {
  return name
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function trustLabel(t: number) {
  if (t >= 60) return 'Leal';
  if (t >= 25) return 'Confia';
  if (t > -25) return 'Neutro';
  if (t > -60) return 'Desconfiado';
  return 'Hostil';
}

function ContactList({ game }: { game: GameState }) {
  // Animais não usam o Agent (mesmo que um save antigo tenha uma conversa com eles).
  const contacts = game.npcs.filter(n => n.kind !== 'animal' && (n.isContact || game.phone.some(t => t.npcId === n.id)));
  const sorted = [...contacts].sort((a, b) => {
    const ta = game.phone.find(t => t.npcId === a.id);
    const tb = game.phone.find(t => t.npcId === b.id);
    return (tb?.unread ?? 0) - (ta?.unread ?? 0) || (tb?.messages.length ?? 0) - (ta?.messages.length ?? 0);
  });
  const news = game.news ?? [];
  const lastNews = news.at(-1);
  const newsUnread = unreadNews(game);
  return (
    <ul className="divide-y divide-line-soft">
      <li>
        <button type="button" onClick={() => useUiStore.getState().setActiveThread(NEWS_THREAD)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
          <span className="w-10 h-10 shrink-0 grid place-items-center border border-neon-yellow/50 text-neon-yellow">
            <Newspaper className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg truncate">NCNet</span>
              {lastNews && <span className="tabular text-[10px] text-dim shrink-0">{formatGameTime(lastNews.at).time}</span>}
            </span>
            <span className={cn('block text-xs truncate', newsUnread ? 'text-fg' : 'text-muted')}>{lastNews ? lastNews.headline : 'Manchetes e boatos de Night City'}</span>
          </span>
          {newsUnread ? <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-neon-yellow text-surface-0 text-[10px] font-bold grid place-items-center">{newsUnread}</span> : null}
        </button>
      </li>
      {!sorted.length && (
        <li>
          <Empty icon={<Smartphone className="w-8 h-8" />} title="Agenda vazia" />
        </li>
      )}
      {sorted.map(npc => {
        const thread = game.phone.find(t => t.npcId === npc.id);
        const last = thread?.messages.at(-1);
        return (
          <li key={npc.id}>
            <button type="button" onClick={() => selectThread(npc.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
              <span className={cn('w-10 h-10 shrink-0 grid place-items-center font-display text-xs border', npc.status === 'dead' ? 'border-line text-dim' : 'border-neon-cyan/50 text-neon-cyan')}>
                {initials(npc.name)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg truncate">{npc.name}</span>
                  {last && <span className="tabular text-[10px] text-dim shrink-0">{last.time}</span>}
                </span>
                <span className={cn('block text-xs truncate', thread?.unread ? 'text-fg' : 'text-muted')}>
                  {last ? `${last.from === 'player' ? 'Você: ' : ''}${last.text}` : `${npc.role} · iniciar conversa`}
                </span>
              </span>
              {thread?.unread ? <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-neon-magenta text-surface-0 text-[10px] font-bold grid place-items-center">{thread.unread}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ThreadView({ game, npc }: { game: GameState; npc: Npc }) {
  const thread = game.phone.find(t => t.npcId === npc.id);
  const typing = useUiStore(s => s.phoneTyping === npc.id);
  const busy = useUiStore(s => s.gmBusy);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const messages = thread?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, typing]);

  const send = (value: string) => {
    const clean = value.trim();
    if (!clean || busy || npc.status === 'dead') return;
    setText('');
    void sendPhoneMessage(npc.id, clean);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2.5">
        {messages.length === 0 && <p className="text-center text-xs text-dim py-6">Nenhuma mensagem ainda. Diga algo.</p>}
        {messages.map(m => (
          <div key={m.id} className={cn('flex', m.from === 'player' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[82%] px-3 py-2 text-sm leading-snug', m.from === 'player' ? 'bg-neon-cyan/15 border border-neon-cyan/40 text-fg' : 'bg-surface-3 border border-line text-fg')}>
              <p className="whitespace-pre-line">{m.text}</p>
              <p className="tabular text-[9px] text-dim text-right mt-1">{m.time}</p>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex gap-1 px-3 py-2 w-fit bg-surface-3 border border-line" role="status" aria-label="Digitando">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse-soft" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-3 pt-2 pb-3 space-y-2 safe-bottom">
        {thread && !typing && <SuggestionStrip items={thread.suggestedReplies} onPick={send} disabled={busy} label="Respostas rápidas" />}
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={800}
            disabled={npc.status === 'dead'}
            placeholder={npc.status === 'dead' ? 'Número desativado' : busy ? 'Aguarde…' : 'Mensagem'}
            aria-label={`Mensagem para ${npc.name}`}
            className="cp-input flex-1 text-sm"
            data-autofocus
          />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar" className="w-10 grid place-items-center border border-neon-cyan text-neon-cyan disabled:opacity-30 hover:bg-neon-cyan/10">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

const SOURCE_TONE: Record<NewsSource, string> = {
  '54 News': 'border-neon-cyan/50 text-neon-cyan',
  NCNet: 'border-neon-yellow/50 text-neon-yellow',
  Rumor: 'border-neon-magenta/50 text-neon-magenta',
};

/** Feed NCNet: manchetes e boatos das frentes do mundo (mais novas primeiro). */
function NewsView({ game }: { game: GameState }) {
  const news = game.news ?? [];
  useEffect(() => {
    markNewsSeen();
  }, [news.length]);
  if (!news.length) return <Empty icon={<Newspaper className="w-8 h-8" />} title="Nada no feed" />;
  return (
    <ul className="divide-y divide-line-soft">
      {[...news].reverse().map(n => (
        <li key={n.id} className="px-4 py-3 space-y-1">
          <p className="flex items-center gap-2">
            <span className={cn('border px-1 py-px text-[9px] font-display uppercase tracking-wider', SOURCE_TONE[n.source])}>{n.source === 'Rumor' ? 'Boato' : n.source}</span>
            <span className="tabular text-[10px] text-dim">
              {formatGameTime(n.at).weekday} {formatGameTime(n.at).time}
            </span>
          </p>
          <p className="text-sm text-fg leading-snug">{n.headline}</p>
          <p className="text-xs text-muted leading-snug">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Comunicador (Agent). Usado no drawer (desktop) e na aba do mobile. */
export function PhoneView({ game, onClose }: { game: GameState; onClose?: () => void }) {
  const activeThread = useUiStore(s => s.activeThread);
  const newsOpen = activeThread === NEWS_THREAD;
  const npc = activeThread && !newsOpen ? game.npcs.find(n => n.id === activeThread) : undefined;

  // Mensagens que chegam com a conversa aberta já contam como lidas.
  const unreadOpen = npc ? game.phone.find(t => t.npcId === npc.id)?.unread ?? 0 : 0;
  useEffect(() => {
    if (npc && unreadOpen > 0) selectThread(npc.id);
  }, [npc, unreadOpen]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex items-center gap-2 px-3 h-14 border-b border-line shrink-0">
        {npc || newsOpen ? (
          <button type="button" onClick={() => selectThread(null)} aria-label="Voltar aos contatos" className="p-1.5 text-muted hover:text-neon-cyan">
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : (
          <MessageSquare className="w-5 h-5 text-neon-cyan ml-1.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-display text-xs uppercase tracking-wider text-fg truncate">{npc ? npc.name : newsOpen ? 'NCNet' : 'Agent · Mensagens'}</p>
          <p className="text-[10px] text-muted truncate">{npc ? `${npc.role} · ${trustLabel(npc.trust)}` : newsOpen ? 'Manchetes e boatos' : 'Zetatech Agent v4.2'}</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar telefone" className="p-1.5 text-muted hover:text-fg">
            <X className="w-5 h-5" />
          </button>
        )}
      </header>
      {npc ? (
        <ThreadView game={game} npc={npc} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">{newsOpen ? <NewsView game={game} /> : <ContactList game={game} />}</div>
      )}
    </div>
  );
}
