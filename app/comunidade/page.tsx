import { Suspense } from 'react';
import { Chats } from '@/components/chat/chats';
export const metadata = { title: 'Conversas' };
// A conversa aberta vem do endereço (?c=), lido só no navegador: por isso o Suspense.
export default function Page() { return <Suspense><Chats /></Suspense>; }
