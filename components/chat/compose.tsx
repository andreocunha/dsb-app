'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, Check, FileText, Image as ImageIcon, Keyboard, MapPin, Mic, Paperclip, SendHorizontal, Smile, X } from 'lucide-react';
import { mentionQuery } from '@/lib/chat-format';
import { shortName } from '@/lib/names';
import { canRecord, type Recording } from '@/lib/voice';
import { EmojiPicker } from './emoji-picker';
import { MentionList, suggest } from './mentions';
import { Quote } from './message';
import { useWide } from './use-wide';
import { LockHint, RecordingBar, useVoiceRecorder } from './voice-recorder';
import { toReply, type Message, type Person } from './types';

export type ComposeContext = { kind: 'reply' | 'edit'; message: Message } | null;

const MAX_LINES = 6;
const noop = () => () => {};
const hasKeyboard = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Barra de digitar: pílula com emoji, texto e anexos no celular; barra inteira no desktop (WhatsApp Web).
 * people: no grupo, quem aparece na lista ao digitar @. mentionAll: o @all entra no topo da lista.
 * onLocation: "Localização" nos anexos.
 */
export function Compose({ text, setText, context, userId, people, mentionAll = false, onMention, inputRef, onCancelContext, onSubmit, onFile, onLocation, onTyping, onVoice, onRecording, onError }: {
  text: string; setText: (text: string) => void; context: ComposeContext; userId: string | null; people?: Person[]; mentionAll?: boolean; onMention?: (person: Person) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>; onCancelContext: () => void; onSubmit: () => void;
  onFile: (file: File) => void; onLocation?: () => void; onTyping: () => void;
  onVoice: (recording: Recording) => void; onRecording: () => void; onError: (message: string) => void;
}) {
  const [emojis, setEmojis] = useState(false);
  const [attach, setAttach] = useState(false);
  const docs = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const editing = context?.kind === 'edit';
  const empty = !text.trim();
  const wide = useWide();
  const wrap = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder({ onSend: onVoice, onActivity: onRecording, onError });
  // Campo vazio: no lugar da seta de enviar fica o microfone (como no WhatsApp).
  const micSupported = useSyncExternalStore(noop, canRecord, () => false);
  const showMic = empty && !editing && micSupported;
  const recording = voice.mode !== 'idle';
  // Menção: o @ no cursor abre a lista; Esc fecha até começar outro @.
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const listId = useId();
  const mention = people && caret !== null ? mentionQuery(text, caret) : null;
  const matches = mention && mention.start !== dismissed ? suggest(people!, mention.query, userId, mentionAll) : [];
  const mentioning = matches.length > 0;
  const current = Math.min(active, matches.length - 1);

  useEffect(() => {
    if (!attach) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAttach(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attach]);

  // No desktop o painel de emojis flutua sobre a conversa: fecha com Esc ou clicando fora da barra.
  useEffect(() => {
    if (!emojis || !wide) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEmojis(false); inputRef.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setEmojis(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [emojis, wide, inputRef]);

  // Cresce com o texto até 6 linhas, depois rola.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + 18)}px`;
  }, [text, inputRef]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (empty) return;
    onSubmit();
    if (!wide) setEmojis(false);
  }

  function insert(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.setSelectionRange(start + emoji.length, start + emoji.length);
      if (wide) el.focus();
    });
  }

  function pickMention(person: Person) {
    const el = inputRef.current;
    if (!mention || caret === null) return;
    const tag = `@${shortName(person.name)} `;
    const next = text.slice(0, mention.start) + tag + text.slice(caret);
    const at = mention.start + tag.length;
    setText(next);
    setCaret(at);
    setActive(0);
    onMention?.(person);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at, at); });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentioning) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((current + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pickMention(matches[current]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(mention!.start); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && hasKeyboard()) submit(e);
  }

  function toggleEmojis() {
    // No celular o painel ocupa o lugar do teclado; o ícone vira um teclado para voltar a digitar.
    if (emojis) { setEmojis(false); if (!wide) inputRef.current?.focus(); return; }
    if (!wide) inputRef.current?.blur();
    setAttach(false);
    setEmojis(true);
  }

  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setAttach(false);
    if (file) onFile(file);
  }

  function onPaste(e: React.ClipboardEvent) {
    const file = e.clipboardData.files[0];
    if (!file) return;
    e.preventDefault();
    onFile(file);
  }

  return <div ref={wrap} className={`compose-wrap ${emojis ? 'with-emojis' : ''}`}>
    <form className={`compose ${recording ? `is-recording ${voice.mode}` : ''}`} onSubmit={submit}>
      {recording ? <div className="compose-field recording-field"><RecordingBar voice={voice} /></div> : <div className="compose-field">
        {context && <div className="compose-context">
          <Quote reply={toReply(context.message)} userId={userId} conversationId={context.message.conversation_id} label={editing ? 'Editar mensagem' : undefined} />
          <button type="button" className="icon-button" onClick={onCancelContext} aria-label={editing ? 'Cancelar edição' : 'Cancelar resposta'}><X size={20} /></button>
        </div>}
        <button type="button" className="compose-icon" onClick={toggleEmojis} aria-label={emojis ? 'Fechar emojis' : 'Emojis'} aria-expanded={emojis}>
          {emojis && !wide ? <Keyboard size={22} /> : <Smile size={24} />}
        </button>
        {!editing && <button type="button" className="compose-icon compose-attach" onClick={() => { setEmojis(false); setAttach(!attach); }} aria-label="Anexar" aria-expanded={attach}>
          <Paperclip size={22} />
        </button>}
        <textarea ref={inputRef} rows={1} value={text} maxLength={2000} placeholder={wide ? 'Digite uma mensagem' : 'Mensagem'} aria-label="Sua mensagem"
          role={people ? 'combobox' : undefined} aria-autocomplete={people ? 'list' : undefined} aria-expanded={people ? mentioning : undefined}
          aria-controls={mentioning ? listId : undefined} aria-activedescendant={mentioning ? `${listId}-${current}` : undefined}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); setActive(0); if (e.target.value.trim()) onTyping(); }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onBlur={() => setCaret(null)}
          onFocus={() => { if (!wide) setEmojis(false); }}
          onPaste={onPaste}
          onKeyDown={onKeyDown} />
        {empty && !editing && <button type="button" className="compose-icon compose-camera only-mobile" onClick={() => camera.current?.click()} aria-label="Câmera"><Camera size={22} /></button>}
      </div>}
      {voice.mode === 'locked'
        ? <button type="button" className="send-button recording-send" onClick={() => void voice.finish()} aria-label="Enviar mensagem de voz"><SendHorizontal size={22} /></button>
        : showMic || voice.mode === 'hold'
        ? (wide
          ? <button type="button" className="send-button mic" onClick={() => void voice.begin('locked')} aria-label="Gravar mensagem de voz" title="Mensagem de voz"><Mic size={24} /></button>
          : <button type="button" className={`send-button mic ${voice.mode === 'hold' ? 'holding' : ''}`} {...voice.holdHandlers} onContextMenu={e => e.preventDefault()} aria-label="Segure para gravar uma mensagem de voz">
              {voice.mode === 'hold' && <LockHint dragY={voice.drag.y} />}
              <Mic size={24} />
            </button>)
        : <button type="submit" className={`send-button ${empty ? 'idle' : ''}`} aria-label={editing ? 'Salvar edição' : 'Enviar mensagem'} aria-disabled={empty}>
          {editing ? <Check size={22} /> : <SendHorizontal size={22} />}
        </button>}
    </form>

    {mentioning && !recording && <MentionList id={listId} people={matches} active={current} onPick={pickMention} onHover={setActive} />}
    {attach && <>
      <button type="button" className="attach-backdrop" aria-label="Fechar anexos" onClick={() => setAttach(false)} />
      <div className="attach-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => docs.current?.click()}><span style={{ background: '#7f66ff' }}><FileText size={20} /></span>Documento</button>
        <button type="button" role="menuitem" onClick={() => media.current?.click()}><span style={{ background: '#007bfc' }}><ImageIcon size={20} /></span>Fotos e vídeos</button>
        <button type="button" role="menuitem" onClick={() => camera.current?.click()}><span style={{ background: '#ff2e74' }}><Camera size={20} /></span>Câmera</button>
        {onLocation && <button type="button" role="menuitem" onClick={() => { setAttach(false); onLocation(); }}><span style={{ background: '#1fa855' }}><MapPin size={20} /></span>Localização</button>}
      </div>
    </>}
    <input ref={docs} type="file" hidden onChange={picked} />
    <input ref={media} type="file" hidden accept="image/*,video/*" onChange={picked} />
    <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={picked} />

    {emojis && <EmojiPicker onPick={insert} autoFocus={wide} />}
  </div>;
}

