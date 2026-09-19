import { type PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';
import { credentials } from './api';

type Session = { loading: boolean; linked: boolean; refresh(): Promise<void> };
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState({ loading: true, linked: false });
  const refresh = async () => {
    const credential = await credentials.getCredential();
    setState({ loading: false, linked: Boolean(credential) });
  };
  useEffect(() => {
    void refresh();
    return credentials.subscribe(() => void refresh());
  }, []);
  return (
    <SessionContext.Provider value={{ ...state, refresh }}>{children}</SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider no está disponible.');
  return value;
}
