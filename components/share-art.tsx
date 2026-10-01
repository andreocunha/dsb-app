'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Download, Share2 } from 'lucide-react';
import { useRaces, type Race } from '@/lib/data';
import type { ResultsData } from '@/lib/results';
import { drawLineupPost, drawRacePost, drawStandingsStory } from '@/lib/share-art';
import { canSaveToGallery, isNativeApp, saveToGallery, shareNativeFile } from '@/lib/native-share';
import { Sheet } from './ui';

type Art = { url: string; file: File };
const noop = () => () => {};

/**
 * Gera a arte da tela atual: story da geral ou post da prova filtrada.
 * Antes do resultado, divulga as equipes inscritas ou a largada da prova.
 */
export function ShareArt({ open, onClose, race, data }: { open: boolean; onClose: () => void; race: Race | null; data: ResultsData }) {
  const { data: races } = useRaces();
  const hasResults = data.scores.some(s => !race || s.race_id === race.id);
  const [art, setArt] = useState<Art | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!open || !races) return;
    let alive = true, url = '';
    const name = !hasResults ? (race ? `dsb-prova-${race.number}-largada.png` : 'dsb-equipes.png')
      : race ? `dsb-prova-${race.number}.png` : 'dsb-classificacao.png';
    const draw = !hasResults ? drawLineupPost(data, races, race) : race ? drawRacePost(data, race) : drawStandingsStory(data, races);
    draw.then(blob => {
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setArt({ url, file: new File([blob], name, { type: 'image/png' }) });
    }, () => { if (alive) setFailed(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); setArt(null); setFailed(false); setSaving('idle'); };
  }, [open, race, data, races, hasResults]);

  const native = useSyncExternalStore(noop, isNativeApp, () => false);
  const canSave = useSyncExternalStore(noop, canSaveToGallery, () => false);
  const canShare = !!art && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [art.file] });
  async function share() {
    if (!art) return;
    try { await navigator.share({ files: [art.file], title: 'Desafio Solar Brasil' }); } catch { /* cancelado */ }
  }
  // No app, compartilhar abre a folha do sistema e salvar grava direto na galeria.
  async function shareNative() {
    if (!art) return;
    try { await shareNativeFile({ blob: art.file, name: art.file.name, title: 'Desafio Solar Brasil' }); } catch (error) { console.warn('Não foi possível compartilhar a imagem:', error); }
  }
  // O aviso geral do app fica por baixo desta janela, então o retorno aparece no próprio botão.
  async function saveNative() {
    if (!art || saving === 'saving') return;
    setSaving('saving');
    try { await saveToGallery({ blob: art.file, name: art.file.name }); setSaving('saved'); }
    catch (error) { console.warn('Não foi possível salvar a imagem:', error); setSaving('error'); }
  }

  return <Sheet open={open} onClose={onClose} title="Compartilhar imagem"
    subtitle={!hasResults ? (race ? `Post · anúncio da Prova ${race.number}, ${race.name}` : 'Post · equipes inscritas')
      : race ? `Post · resultado da Prova ${race.number}, ${race.name}` : 'Story · classificação geral'}>
    <div className="share-art">
      {art ? <img src={art.url} alt={race ? race.name : 'Resultados do Desafio Solar Brasil'} className={race || !hasResults ? 'post' : 'story'} />
        : <p className="panel-note">{failed ? 'Não foi possível gerar a imagem.' : 'Gerando a imagem…'}</p>}
      {native ? <div className="share-actions">
        {art && <button className="button primary" onClick={() => void shareNative()}><Share2 size={16} /> Compartilhar</button>}
        {art && canSave && <button className="button" disabled={saving === 'saving'} onClick={() => void saveNative()}>
          {saving === 'saved' ? <><Check size={16} /> Salva na galeria</> : <><Download size={16} /> {saving === 'saving' ? 'Salvando…' : 'Salvar na galeria'}</>}
        </button>}
      </div> : <div className="share-actions">
        {canShare && <button className="button primary" onClick={() => void share()}><Share2 size={16} /> Compartilhar</button>}
        {art && <a className={`button ${canShare ? '' : 'primary'}`} href={art.url} download={art.file.name}><Download size={16} /> Baixar</a>}
      </div>}
      {saving === 'error' && <p className="footnote">Não deu para salvar. Libere o acesso às fotos nas configurações do celular e tente de novo.</p>}
      <p className="footnote">{!hasResults ? 'Imagem 1080×1350. Depois da prova, a arte passa a mostrar o resultado.'
        : race ? 'Imagem 1080×1350 com os 8 primeiros da prova.' : 'Imagem 1080×1920 com o pódio e até o 10º lugar.'} Para outra prova, troque a seleção nos resultados.</p>
    </div>
  </Sheet>;
}
