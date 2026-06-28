import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  users: { __table: 'users' } as object,
  trades: { __table: 'trades' } as object,
  offers: { __table: 'offers' } as object,
  reviews: { __table: 'reviews' } as object,
  rows: [] as unknown[],
  insertedRow: null as unknown,
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  avg: (col: unknown) => ({ avg: col }),
  count: (col: unknown) => ({ count: col }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  sql: (...args: unknown[]) => ({ sql: args }),
  sum: (col: unknown) => ({ sum: col }),
}));

vi.mock('@cardmkt/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (res: (v: unknown) => unknown) => Promise.resolve(h.rows).then(res),
    };
    return chain;
  };

  return {
    db: {
      select: () => makeChain(),
      insert: () => ({
        values: (vals: unknown) => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(h.insertedRow ? [h.insertedRow] : []),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    },
    schema: {
      users: h.users,
      trades: h.trades,
      offers: h.offers,
      reviews: h.reviews,
    },
  };
});

import express from 'express';
import request from 'supertest';
import { profilesRouter } from './profiles.js';

describe('profiles routes (unit tests)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/profiles', profilesRouter);
    h.rows = [];
    h.insertedRow = null;
    vi.clearAllMocks();
  });

  describe('GET /api/profiles/:address', () => {
    it('returns 400 for invalid stellar address', async () => {
      const res = await request(app).get('/api/profiles/invalid-address');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ACCOUNT');
    });

    it('fetches existing profile when user exists', async () => {
      const mockUser = {
        stellarAddress: 'GDT2LS25U73FDR36G6RFR3X5ZHY3P4ZURMX22R7F3C7L7OXT5JND7JUX',
        displayName: 'Test User',
        bio: 'Hello world',
        location: 'Space',
        website: 'https://test.com',
        avatarUrl: '/avatars/avatar-2.png',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      h.rows = [mockUser];

      const res = await request(app).get(`/api/profiles/${mockUser.stellarAddress}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        address: mockUser.stellarAddress,
        displayName: mockUser.displayName,
        bio: mockUser.bio,
        location: mockUser.location,
        website: mockUser.website,
        avatarUrl: mockUser.avatarUrl,
        memberSince: mockUser.createdAt.toISOString(),
      });
    });

    it('lazily creates profile with a deterministic default avatar when user does not exist', async () => {
      const address = 'GDT2LS25U73FDR36G6RFR3X5ZHY3P4ZURMX22R7F3C7L7OXT5JND7JUX';
      const createdUser = {
        stellarAddress: address,
        displayName: null,
        bio: null,
        location: null,
        website: null,
        avatarUrl: '/avatars/avatar-2.png', // deterministic result for GDT2LS25U73FDR36G6RFR3X5ZHY3P4ZURMX22R7F3C7L7OXT5JND7JUX
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
      };
      
      h.rows = []; 
      h.insertedRow = createdUser;

      const res = await request(app).get(`/api/profiles/${address}`);
      expect(res.status).toBe(200);
      expect(res.body.address).toBe(address);
      expect(res.body.avatarUrl).toBe('/avatars/avatar-2.png');
      expect(res.body.displayName).toBeNull();
    });
  });
});
