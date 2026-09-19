'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Info, Pin, Send, Smile, Sun, X } from 'lucide-react';
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
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [saved.length]);
  function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    const displayName = guest ? 'Visitante' : name;
    setSaved([...saved, { id: crypto.randomUUID(), name: displayName, initials: displayName.slice(0, 2).toUpperCase(), color: 'purple', text: text.trim(), time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), own: true }]);
    setText(''); setEmojis(false); input.current?.focus();
  }
  return <section className="chat fill" aria-label="Chat da comunidade">
    <header className="chat-header">
      <span className="chat-icon"><Sun size={20} /></span>
      <div><h1>Torcida Solar</h1><p><span className="dot" /> Comunidade DSB</p></div>
      <button className="icon-button" aria-label="Informações do grupo" onClick={() => setInfo(true)}><Info size={20} /></button>
    </header>
    <button className="chat-pinned" onClick={() => setInfo(true)}><Pin size={14} /><span><b>Fixada:</b> Respeito é a nossa principal regra. Boa torcida!</span></button>
    <div className="chat-messages" role="log" aria-label="Mensagens da comunidade" aria-live="polite">
      <p className="chat-notice">Conversa de demonstração · suas mensagens ficam só neste dispositivo</p>
      {[...initialMessages, ...saved].map(message => <div className={`message ${message.own ? 'own' : ''}`} key={message.id}>
        {!message.own && <span className={`avatar small color-${message.color}`}>{message.initials}</span>}
        <div className="bubble">
          {!message.own && <div className="bubble-author"><b className={`text-${message.color}`}>{message.name}</b>{message.team && <span>{message.team}</span>}</div>}
          <p>{message.text}</p>
          <span className="bubble-time">{message.time}{message.own && <CheckCheck size={13} />}</span>
        </div>
      </div>)}
      <div ref={bottom} />
    </div>
    <form className="chat-compose" onSubmit={send}>
      {emojis && <div className="emoji-picker">{['☀️', '🚤', '💜', '👏', '🔥', '🏆', '💪', '🌊'].map(emoji => <button type="button" key={emoji} onClick={() => { setText(t => t + emoji); input.current?.focus(); }}>{emoji}</button>)}</div>}
      <button type="button" className="icon-button" aria-label={emojis ? 'Fechar emojis' : 'Escolher emoji'} onClick={() => setEmojis(!emojis)}>{emojis ? <X size={20} /> : <Smile size={20} />}</button>
      <input ref={input} value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="Mensagem…" aria-label="Sua mensagem" />
      <button type="submit" className="send-button" disabled={!text.trim()} aria-label="Enviar mensagem"><Send size={18} /></button>
    </form>
    <Sheet open={info} onClose={() => setInfo(false)} title="Bem-vindo à Torcida Solar">
      <div className="prose">
        <p>Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
        <ul>
          <li>Respeite as pessoas e todas as equipes.</li>
          <li>Mantenha a conversa relacionada ao evento.</li>
          <li>Evite spam e a divulgação de informações pessoais.</li>
          <li>Torça muito e compartilhe conhecimento!</li>
        </ul>
        <p className="footnote">Nesta versão, as conversas são demonstrativas. Suas mensagens são salvas neste navegador e não são enviadas para outras pessoas.</p>
      </div>
    </Sheet>
  </section>;
}
