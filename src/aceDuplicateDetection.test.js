import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import { buildAceItem, newAceDraft, findAceDuplicates } from './acePace.js';

test('Supabase duplicate filters contain valid JSON and PostgreSQL finds only the identical PACE set', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table items(id text primary key, ace_details jsonb);');
    const candidate = buildAceItem({ ...newAceDraft(), subject: 'Word Building', confirmed: true });
    const partial = { ...candidate.ace_details, numbers: candidate.ace_details.numbers.slice(1) };
    const written = { ...candidate.ace_details, writing: 'Some writing' };
    for (const [id, details] of [['matching', candidate.ace_details], ['partial', partial], ['written', written]]) {
      await db.query('insert into items values($1, $2::jsonb)', [id, JSON.stringify(details)]);
    }
    let requests = 0;
    const client = createClient('https://inventory.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async input => {
        requests++;
        const filter = new URL(String(input)).searchParams.get('ace_details');
        assert.ok(filter?.startsWith('eq.'));
        try {
          // Exercise the actual Supabase URL and PostgreSQL JSON parser together.
          // Passing an object directly to eq() used to send eq.[object Object] here.
          const result = await db.query('select id from items where ace_details=$1::jsonb', [filter.slice(3)]);
          return new Response(JSON.stringify(result.rows), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
          return new Response(JSON.stringify({ code: error.code, message: error.message }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
      } },
    });
    const { data, error } = await findAceDuplicates(client, candidate);
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: 'matching' }]);
    assert.equal(requests, 1);
  } finally { await db.close(); }
});
