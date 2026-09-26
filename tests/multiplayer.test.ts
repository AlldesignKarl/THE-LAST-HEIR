import { describe, it, expect } from 'vitest';
import { parseServerId, appearanceFor, MAX_PLAYERS } from '../src/net/Multiplayer';

describe('multijugador', () => {
  it('extrae el id del servidor de enlaces y códigos', () => {
    expect(parseServerId('https://claude.ai/artifact/abc#s-k3v6q2rt7w')).toBe('k3v6q2rt7w');
    expect(parseServerId('#s-abcdef1234')).toBe('abcdef1234');
    expect(parseServerId('  ABCDEF1234 ')).toBe('abcdef1234');
    expect(parseServerId('https://claude.ai/artifact/abc')).toBeNull();
    expect(parseServerId('#s-ab')).toBeNull();
    expect(parseServerId('<script>')).toBeNull();
  });

  it('da a cada jugador un aspecto estable', () => {
    expect(appearanceFor('usuario-1')).toEqual(appearanceFor('usuario-1'));
    const a = appearanceFor('x');
    expect(a.build).toBeGreaterThanOrEqual(0.95);
    expect(a.build).toBeLessThanOrEqual(1.05);
  });

  it('limita a 5 jugadores', () => {
    expect(MAX_PLAYERS).toBe(5);
  });
});
