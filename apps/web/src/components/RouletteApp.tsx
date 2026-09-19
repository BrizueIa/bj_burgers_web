import { useEffect, useRef, useState } from 'react';
import { Gift, LoaderCircle, RotateCw, X } from 'lucide-react';
import { spinRedeemResponseSchema, type SpinRedeemResponse } from '@bj/contracts';

const segments = ['10%', '😢', '15%', '🎁', '😢', '🍟', '10%', '⭐', '😢', '20%', '🥤', '😢'];

export default function RouletteApp({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Ingresa el código que recibiste con tu pedido.');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpinRedeemResponse | null>(null);
  const [rotation, setRotation] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (result) dialogRef.current?.showModal();
  }, [result]);

  function finishSpin(parsed: SpinRedeemResponse) {
    setRotation(
      (current) =>
        current + 1800 + (360 - (parsed.targetSegment % segments.length) * (360 / segments.length)),
    );
    window.setTimeout(
      () => {
        setResult(parsed);
        setBusy(false);
        setStatus(
          parsed.mode === 'demo'
            ? 'Prueba terminada. El resultado quedó registrado como no canjeable.'
            : `Giro registrado. Te quedan ${parsed.remainingSpins} giro(s).`,
        );
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 4200,
    );
  }

  async function redeem(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    setStatus('Validando y registrando tu giro…');
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(`${apiBaseUrl}/spins/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ code: code.trim().toUpperCase(), idempotencyKey }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.message === 'string' ? body.message : 'No pudimos validar el código.',
        );
      const parsed = spinRedeemResponseSchema.parse(body);
      finishSpin(parsed);
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : 'No pudimos completar el canje.');
    }
  }

  async function demoSpin() {
    setBusy(true);
    setResult(null);
    setStatus('Preparando una tirada de prueba segura…');
    try {
      const response = await fetch(`${apiBaseUrl}/spins/demo`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.message === 'string' ? body.message : 'No pudimos iniciar la prueba.',
        );
      finishSpin(spinRedeemResponseSchema.parse(body));
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : 'No pudimos completar la prueba.');
    }
  }

  const verificationUrl = result
    ? `${apiBaseUrl.replace(/\/api\/v1\/?$/, '')}${result.verificationPath}`
    : '';

  return (
    <section className="roulette-app" data-hydrated={hydrated || undefined}>
      <div className="code-panel">
        <p className="eyebrow">Canje seguro</p>
        <h2>Ingresa tu código</h2>
        <p>El código se consume en el servidor antes de revelar el premio.</p>
        <form onSubmit={redeem}>
          <label htmlFor="spin-code">Código</label>
          <input
            id="spin-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            minLength={4}
            maxLength={64}
            autoComplete="off"
            required
            placeholder="BJ-XXXX"
          />
          <button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <RotateCw aria-hidden="true" />
            )}{' '}
            {busy ? 'Girando…' : 'Girar ruleta'}
          </button>
        </form>
        <div className="demo-spin-panel">
          <span>¿Quieres ver cómo funciona?</span>
          <button type="button" className="demo-spin-button" disabled={busy} onClick={demoSpin}>
            Probar sin código
          </button>
          <small>La prueba no consume código y nunca genera un premio canjeable.</small>
        </div>
        <p className="roulette-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
      <div className="wheel-panel">
        <div className="wheel-pointer" aria-hidden="true" />
        <div
          className="wheel"
          style={{ transform: `rotate(${rotation}deg)` }}
          role="img"
          aria-label="Ruleta de premios de B&J Burgers"
        >
          {segments.map((segment, index) => (
            <span
              key={`${segment}-${index}`}
              style={{
                transform: `rotate(${index * (360 / segments.length)}deg) translateY(calc(-1 * var(--label-radius)))`,
              }}
            >
              {segment}
            </span>
          ))}
          <div className="wheel-center">
            <Gift aria-hidden="true" />
          </div>
        </div>
        <p className="wheel-alternative">
          El resultado del giro también se anunciará como texto en un diálogo accesible.
        </p>
      </div>
      <dialog
        className={`result-dialog ${result?.mode === 'demo' ? 'demo-result' : ''}`}
        ref={dialogRef}
        onClose={() => setResult(null)}
      >
        {result && (
          <div>
            {result.mode === 'demo' && (
              <div className="demo-watermark" aria-hidden="true">
                PRUEBA · NO CANJEABLE
              </div>
            )}
            <button
              className="icon-button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Cerrar"
            >
              <X />
            </button>
            <span className="result-emoji" aria-hidden="true">
              {result.prize.emoji}
            </span>
            <p className="eyebrow">
              {result.mode === 'demo' ? 'Simulación registrada' : 'Resultado registrado'}
            </p>
            <h2>¡{result.prize.label}!</h2>
            {result.mode === 'demo' ? (
              <p className="demo-warning">
                Este resultado es una <strong>prueba sin valor</strong>. No genera premio ni puede
                canjearse.
              </p>
            ) : (
              <p>
                Te quedan <strong>{result.remainingSpins}</strong> giro(s) disponibles.
              </p>
            )}
            <p className="verification-proof">
              Identificador: <code>{result.redemptionId}</code>
              <a href={verificationUrl} target="_blank" rel="noreferrer">
                Verificar en servidor
              </a>
            </p>
            <button className="button primary" onClick={() => dialogRef.current?.close()}>
              Entendido
            </button>
          </div>
        )}
      </dialog>
    </section>
  );
}
