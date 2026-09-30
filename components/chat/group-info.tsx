'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { shortName } from '@/lib/names';
import { registerOverlay } from '@/lib/overlays';
import { supabase } from '@/lib/supabase';
import { Avatar } from '../ui';

/**
 * Dados do grupo: tela cheia no celular, painel à direita no desktop (como no WhatsApp Web).
 * Traz as regras do chat e quem a pessoa bloqueou.
 */
export function GroupInfo({ open, online, blocked, onUnblock, onClose, focusBlocked }: {
  open: boolean; online: number; blocked: string[]; onUnblock: (id: string) => void; onClose: () => void; focusBlocked: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>(focusBlocked ? '#bloqueados' : '.group-close')?.focus();
    if (focusBlocked) panel?.querySelector('#bloqueados')?.scrollIntoView({ block: 'start' });
    const solta = registerOverlay(() => fechar.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    window.addEventListener('keydown', onKey);
    return () => { solta(); window.removeEventListener('keydown', onKey); };
  }, [open, focusBlocked]);
  if (!open) return null;

  return <aside ref={ref} className="group-info" aria-label="Dados do grupo">
    <header className="group-info-header">
      <button className="icon-button group-close" onClick={onClose} aria-label="Fechar dados do grupo">
        <ArrowLeft size={22} className="only-mobile" /><X size={22} className="only-desktop" />
      </button>
      <h2>Dados do grupo</h2>
    </header>
    <div className="group-info-body">
      <section className="group-card group-hero">
        <img src="/images/logo.png" alt="" />
        <h1>Torcida Solar</h1>
        <p>Grupo · {online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} no app agora` : 'Comunidade DSB'}</p>
      </section>
      <section className="group-card">
        <h3>Descrição</h3>
        <p>Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
      </section>
      <section className="group-card">
        <h3>Regras do chat</h3>
        <ul>
          <li>Respeite as pessoas e todas as equipes.</li>
          <li>Mantenha a conversa relacionada ao evento.</li>
          <li>Evite spam e a divulgação de informações pessoais.</li>
          <li>Segure uma mensagem (ou passe o mouse e use a setinha) para responder, reagir, denunciar ou bloquear quem estiver incomodando.</li>
        </ul>
        <p>Não há tolerância com ofensa nem com discurso de ódio. Denúncias são analisadas em até 24 horas: a mensagem sai do ar e a conta responsável é banida do chat.</p>
      </section>
      <section className="group-card" id="bloqueados" tabIndex={-1}>
        <h3>Pessoas bloqueadas</h3>
        {blocked.length ? <Blocked ids={blocked} onUnblock={onUnblock} /> : <p>Ninguém bloqueado. Quem você bloquear aparece aqui, para desbloquear quando quiser.</p>}
      </section>
      <p className="group-footnote">Ao entrar você aceitou os <a className="text-link" href="/termos/">termos de uso</a>.</p>
    </div>
  </aside>;
}

function Blocked({ ids, onUnblock }: { ids: string[]; onUnblock: (id: string) => void }) {
  const [people, setPeople] = useState<{ id: string; name: string; avatar_url: string | null }[]>([]);
  const key = ids.join();
  useEffect(() => {
    void supabase.from('profiles').select('id, name, avatar_url').in('id', key.split(',')).then(({ data }) => setPeople(data ?? []));
  }, [key]);
  return <ul className="reactors">
    {ids.map(id => {
      const person = people.find(p => p.id === id);
      const name = person ? shortName(person.name) : 'Carregando…';
      return <li key={id}><div>
        <Avatar id={id} name={person?.name ?? '?'} url={person?.avatar_url ?? null} />
        <span>{name}</span>
        <button className="button" onClick={() => onUnblock(id)} aria-label={`Desbloquear ${name}`}>Desbloquear</button>
      </div></li>;
    })}
  </ul>;
}
