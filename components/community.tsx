'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, ChevronRight, Info, Pin, Send, ShieldCheck, Smile, Sun, X } from 'lucide-react';
import { initialMessages, type Message } from '@/lib/mock-data';
import { useLocalState } from '@/lib/local-state';
import { Sheet } from './ui';
export function Community() {
  const [saved, setSaved] = useLocalState<Message[]>('dsb-messages', []);
  const [name] = useLocalState('dsb-name', 'Torcedor Solar');
  const [guest] = useLocalState('dsb-guest', false);
  const [text, setText] = useState('');
  const [emojis, setEmojis] = useState(false);
  const [info, setInfo] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [saved.length]);
  function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    const displayName = guest ? 'Visitante' : name;
    setSaved([...saved, { id: crypto.randomUUID(), name: displayName, initials: displayName.slice(0, 2).toUpperCase(), color: 'purple', text: text.trim(), time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), own: true }]);
    setText(''); setEmojis(false); input.current?.focus();
  }
  return <div className="page-enter community-page"><h1 className="sr-only">Chat da comunidade</h1><div className="community-grid"><section className="card chat-card"><header className="chat-header"><span className="chat-group-icon"><Sun size={26} /></span><div><h2>Torcida Solar ☀️</h2><p><span className="tiny-dot" /> Comunidade DSB</p></div><button className="icon-button" aria-label="Informações do grupo" onClick={() => setInfo(true)}><Info size={21} /></button></header><button className="pinned-message" onClick={() => setInfo(true)}><Pin size={16} /><span><b>Mensagem fixada</b> Respeito é a nossa principal regra. Boa torcida!</span><ChevronRight size={17} /></button><div className="chat-messages" role="log" aria-label="Mensagens da comunidade" aria-live="polite"><span className="chat-day">CONVERSA DE DEMONSTRAÇÃO</span><div className="chat-security"><ShieldCheck size={13} /> As mensagens que você enviar ficam apenas neste dispositivo.</div>{[...initialMessages, ...saved].map(message => <div className={`message-row ${message.own ? 'own' : ''}`} key={message.id}>{!message.own && <span className={`chat-avatar color-${message.color}`}>{message.initials}</span>}<div className="message-bubble"><div className="message-author"><b className={`text-${message.color}`}>{message.own ? 'Você' : message.name}</b>{message.team && <span>{message.team}</span>}</div><p>{message.text}</p><span className="message-time">{message.time}{message.own && <CheckCheck size={14} />}</span></div></div>)}<div ref={bottom} /></div><form className="chat-compose" onSubmit={send}>{emojis && <div className="emoji-picker">{['☀️', '🚤', '💜', '👏', '🔥', '🏆', '💪', '🌊'].map(emoji => <button type="button" key={emoji} onClick={() => { setText(t => t + emoji); input.current?.focus(); }}>{emoji}</button>)}</div>}<button type="button" className="icon-button" aria-label={emojis ? 'Fechar emojis' : 'Escolher emoji'} onClick={() => setEmojis(!emojis)}>{emojis ? <X size={22} /> : <Smile size={22} />}</button><input ref={input} value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="Mensagem…" aria-label="Sua mensagem" /><button type="submit" className="send-button" disabled={!text.trim()} aria-label="Enviar mensagem"><Send size={20} /></button></form></section></div><Sheet open={info} onClose={() => setInfo(false)} title="Bem-vindo à Torcida Solar"><span className="soft-icon gold"><Sun size={28} /></span><h3 className="detail-title">A melhor energia é a que a gente compartilha.</h3><p className="detail-copy">Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p><ul className="rules-list"><li>Respeite as pessoas e todas as equipes.</li><li>Mantenha a conversa relacionada ao evento.</li><li>Evite spam e a divulgação de informações pessoais.</li><li>Torça muito e compartilhe conhecimento!</li></ul><p className="sheet-footnote">Nesta versão, as conversas são demonstrativas. Suas mensagens são salvas neste navegador e não são enviadas para outras pessoas.</p></Sheet></div>;
}
