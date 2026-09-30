'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, SendHorizontal, X } from 'lucide-react';
import { formatSize } from '@/lib/media';
import { registerOverlay } from '@/lib/overlays';

export type Pick = { file: File; url: string };

/** Tela cheia antes de mandar foto, vídeo ou documento, com legenda (como no WhatsApp). */
export function MediaSend({ pick, onClose, onSend }: { pick: Pick | null; onClose: () => void; onSend: (caption: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [caption, setCaption] = useState('');
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!pick || !dialog) return;
    dialog.showModal();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog.close(); solta(); };
  }, [pick]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    onSend(caption);
    setCaption('');
  }

  const type = pick?.file.type ?? '';
  return <dialog ref={ref} className="media-send" onCancel={e => { e.preventDefault(); onClose(); }} aria-label="Enviar arquivo">
    {pick && <>
      <div className="media-send-bar">
        <button type="button" className="icon-button" onClick={() => { setCaption(''); onClose(); }} aria-label="Cancelar"><X size={24} /></button>
        <span>{pick.file.name}</span>
      </div>
      <div className="media-send-preview">
        {type.startsWith('image/') ? <img src={pick.url} alt="" />
          : type.startsWith('video/') ? <video src={pick.url} controls playsInline />
          : <div className="media-send-doc"><FileText size={72} strokeWidth={1.2} /><strong>{pick.file.name}</strong><small>{formatSize(pick.file.size) || 'Sem prévia disponível'}</small></div>}
      </div>
      <form className="media-send-compose" onSubmit={send}>
        <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={2000} placeholder="Adicione uma legenda…" aria-label="Legenda" autoFocus />
        <button type="submit" className="send-button" aria-label="Enviar"><SendHorizontal size={22} /></button>
      </form>
    </>}
  </dialog>;
}
