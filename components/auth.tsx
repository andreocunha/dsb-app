'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, errorMessage } from '@/lib/supabase';
import { isNativeApp, listenNativeLogin, nativeSignIn } from '@/lib/native-auth';
import { Sheet } from './ui';

export type Profile = { id: string; name: string; avatar_url: string | null };
type Provider = 'google' | 'apple';
type AuthValue = {
  userId: string | null;
  profile: Profile | null;
  /** Abre o login explicando por que ele é necessário. */
  requireLogin: (reason?: string) => void;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
};
const AuthContext = createContext<AuthValue>({ userId: null, profile: null, requireLogin: () => {}, signOut: async () => {}, reloadProfile: async () => {} });
export const useAuth = () => useContext(AuthContext);

const fetchProfile = async (id: string) =>
  (await supabase.from('profiles').select('id, name, avatar_url').eq('id', id).maybeSingle()).data;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Profile | null>(null);
  const [loginReason, setLoginReason] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Provider | null>(null);

  useEffect(() => listenNativeLogin(() => setLoginReason(null)), []);

  useEffect(() => {
    // getClaims valida o JWT localmente com as chaves públicas do projeto (JWKS), sem ida ao servidor.
    void supabase.auth.getClaims().then(({ data }) => setUserId(data?.claims.sub ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const reloadProfile = useCallback(async () => {
    if (userId) setLoaded(await fetchProfile(userId));
  }, [userId]);
  useEffect(() => { if (userId) void fetchProfile(userId).then(setLoaded); }, [userId]);
  const profile = loaded && loaded.id === userId ? loaded : null;

  async function signIn(provider: Provider) {
    setError('');
    setBusy(provider);
    try {
      // No app das lojas o login é pela tela nativa; no navegador, pelo fluxo web.
      if (isNativeApp()) { await nativeSignIn(provider); setLoginReason(null); return; }
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.href } });
      if (error) throw error;
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(null); }
  }

  const value: AuthValue = {
    userId,
    profile,
    requireLogin: reason => { setError(''); setLoginReason(reason ?? 'Entre para participar do chat e do fantasy.'); },
    signOut: async () => { await supabase.auth.signOut(); },
    reloadProfile,
  };

  return <AuthContext.Provider value={value}>
    {children}
    <Sheet open={loginReason !== null} onClose={() => setLoginReason(null)} title="Entrar no DSB">
      <div className="login">
        <p>{loginReason}</p>
        <button className="login-button" disabled={busy !== null} onClick={() => void signIn('google')}><GoogleIcon /> {busy === 'google' ? 'Entrando…' : 'Continuar com Google'}</button>
        <button className="login-button apple" disabled={busy !== null} onClick={() => void signIn('apple')}><AppleIcon /> {busy === 'apple' ? 'Entrando…' : 'Continuar com Apple'}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="footnote">Navegar pelo app continua livre. A conta só é usada para o chat e o fantasy.</p>
      </div>
    </Sheet>
  </AuthContext.Provider>;
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" /></svg>;
}
function AppleIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.37 12.63c-.03-2.6 2.13-3.86 2.23-3.92-1.22-1.78-3.11-2.02-3.78-2.05-1.6-.16-3.13.95-3.95.95-.82 0-2.07-.93-3.4-.9-1.75.03-3.37 1.02-4.27 2.58-1.83 3.17-.47 7.85 1.3 10.42.87 1.26 1.9 2.67 3.25 2.62 1.31-.05 1.8-.84 3.38-.84 1.57 0 2.02.84 3.4.81 1.4-.02 2.29-1.28 3.14-2.55.99-1.46 1.4-2.88 1.42-2.95-.03-.01-2.72-1.04-2.75-4.14zM13.78 5c.72-.88 1.21-2.09 1.07-3.3-1.04.04-2.3.69-3.04 1.56-.66.77-1.25 2-1.09 3.18 1.16.09 2.34-.59 3.06-1.44z" /></svg>;
}
