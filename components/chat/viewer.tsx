'use client';
import { useEffect, useRef } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { whenLabel } from '@/lib/chat-format';
import { registerOverlay } from '@/lib/overlays';
import { chatFileUrl } from '@/lib/supabase';
import { Avatar } from '../ui';
import { Formatted } from './message';
import { authorLabel, isVideo, type Message } from './types';

/** Visualizador de foto e vídeo: quem mandou e quando no topo, legenda embaixo. */
export function Viewer({ message, userId, onClose }: { message: Message | null; userId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!message) return;
    dialog?.showModal();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog?.close(); solta(); };
  }, [message]);
  const url = message?.file_path ? chatFileUrl(message.file_path) : '';
  return <dialog ref={ref} className="viewer" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label="Visualizar mídia">
    {message && <>
      <div className="viewer-bar">
        <button className="icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={22} /></button>
        <Avatar id={message.user_id} name={message.author_name} url={message.author_avatar} />
        <div className="viewer-who"><strong>{authorLabel(message, userId)}</strong><small>{whenLabel(message.created_at)}</small></div>
        <a className="icon-button" href={`${url}?download=${encodeURIComponent(message.file_name ?? '')}`} aria-label="Baixar"><Download size={20} /></a>
      </div>
      {isVideo(message)
        ? <video src={url} controls autoPlay playsInline poster={message.thumb_path ? chatFileUrl(message.thumb_path) : undefined} />
        : <img src={url} alt={message.file_name ?? ''} />}
      {message.body && <p className="viewer-caption"><Formatted text={message.body} /></p>}
    </>}
  </dialog>;
}
