import { describe, expect, it } from 'vitest';
import { digestCode, normalizeCode } from './security.js';

describe('códigos de ruleta', () => {
  it('normaliza espacios y caracteres no permitidos', () => {
    expect(normalizeCode(' bj 12-34! ')).toBe('BJ12-34');
  });

  it('produce un digest estable sin exponer el código', () => {
    const secret = 'una-clave-de-prueba-de-mas-de-treinta-y-dos-caracteres';
    expect(digestCode('bj-1234', secret)).toBe(digestCode(' BJ-1234 ', secret));
    expect(digestCode('BJ-1234', secret)).not.toContain('BJ-1234');
  });
});
