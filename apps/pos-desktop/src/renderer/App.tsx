import { useEffect, useState } from 'react';
import { api, errorText } from './api';
import { t, Lang } from './i18n';
import type { Operator, StoreSettings } from '../shared/types';
import { SaleScreen } from './screens/Sale';
import { ItemsScreen } from './screens/Items';
import { ImportScreen } from './screens/Import';
import { ReportsScreen } from './screens/Reports';
import { SettingsScreen } from './screens/Settings';

type Screen = 'sale' | 'items' | 'import' | 'reports' | 'settings';
export const MANAGER_LEVEL = 5;

export function App() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [screen, setScreen] = useState<Screen>('sale');
  const [error, setError] = useState('');
  const [itemDraftUpc, setItemDraftUpc] = useState<string | null>(null);

  useEffect(() => { api.getSettings().then(setSettings).catch(e => setError(errorText(e))); }, []);

  if (error) return <div className="fatal">{error}</div>;
  if (!settings) return <div className="fatal">Loading…</div>;
  const lang = settings.language as Lang;
  if (!operator) return <LoginScreen lang={lang} storeName={settings.storeName} onLogin={setOperator} />;

  const isManager = operator.level >= MANAGER_LEVEL;
  const tabs: Screen[] = isManager ? ['sale', 'items', 'import', 'reports', 'settings'] : ['sale', 'reports'];
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{settings.storeName}</div>
        <nav>
          {tabs.map(s => (
            <button key={s} className={screen === s ? 'tab active' : 'tab'} onClick={() => setScreen(s)}>{t(s === 'sale' ? 'sale' : s, lang)}</button>
          ))}
        </nav>
        <div className="who">T{settings.terminal} · {operator.name}
          <button className="tab" onClick={() => { void api.audit(operator.id, 'LOGOUT', null); setOperator(null); setScreen('sale'); }}>{t('logout', lang)}</button>
        </div>
      </header>
      <main className="content">
        {screen === 'sale' && <SaleScreen settings={settings} operator={operator} lang={lang}
          onAddItem={upc => { if (isManager) { setItemDraftUpc(upc); setScreen('items'); } }} />}
        {screen === 'items' && <ItemsScreen operator={operator} lang={lang} draftUpc={itemDraftUpc} onDraftUsed={() => setItemDraftUpc(null)} />}
        {screen === 'import' && <ImportScreen operator={operator} lang={lang} />}
        {screen === 'reports' && <ReportsScreen settings={settings} lang={lang} />}
        {screen === 'settings' && <SettingsScreen settings={settings} operator={operator} lang={lang} onSaved={setSettings} />}
      </main>
    </div>
  );
}

function LoginScreen({ lang, storeName, onLogin }: { lang: Lang; storeName: string; onLogin: (o: Operator) => void }) {
  const [num, setNum] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    setMsg('');
    try {
      const op = await api.login(num, pin);
      if (op) onLogin(op); else { setMsg('Invalid operator or PIN'); setPin(''); }
    } catch (e) { setMsg(errorText(e)); }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <h1>New POS System</h1>
        <p className="muted">{storeName}</p>
        <label>{t('operator', lang)}<input autoFocus inputMode="numeric" value={num} onChange={e => setNum(e.target.value.replace(/\D/g, ''))} /></label>
        <label>{t('pin', lang)}<input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        {msg && <div className="msg error">{msg}</div>}
        <button className="btn primary big" type="submit">{t('login', lang)}</button>
        <p className="hint">Demo: operator 6 / PIN 1234 (manager) · operator 1 / PIN 1111 (cashier). Change PINs in Settings.</p>
      </form>
    </div>
  );
}
